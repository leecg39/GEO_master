import { createHash } from "node:crypto";
import { z } from "zod";
import {
  assertDeleteAllowed,
  assertExpectedUpdatedAt,
  collectionQuerySchema,
  cursorPage,
  decodeCursor,
  expectFound,
  idempotencyKeySchema,
  resourceIdSchema,
  transactionalMutation,
} from "./crud";
import { getDatabase } from "./db";
import { AppError } from "./errors";
import { requireActiveProject } from "./projects";

const MAX_INPUT_BYTES = 2_000_000;
const MAX_OUTPUT_BYTES = 8_000_000;
const MAX_METADATA_BYTES = 100_000;

export const contentStatuses = ["generated", "draft", "review", "approved", "archived", "failed"] as const;
export const contentRevisionOrigins = ["generated", "edited", "restored"] as const;

const contentToolSchema = z.string().trim().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/);
const contentStatusSchema = z.enum(contentStatuses);
const revisionOriginSchema = z.enum(contentRevisionOrigins);

function serializedJsonSchema(maxBytes: number, label: string) {
  return z.unknown().refine((value) => value !== undefined, { message: `${label} 값이 필요합니다.` }).superRefine((value, context) => {
    try {
      const encoded = JSON.stringify(value);
      if (encoded === undefined) {
        context.addIssue({ code: "custom", message: `${label}은 JSON으로 저장할 수 있어야 합니다.` });
      } else if (Buffer.byteLength(encoded, "utf8") > maxBytes) {
        context.addIssue({ code: "custom", message: `${label}이 저장 크기 제한을 초과했습니다.` });
      }
    } catch {
      context.addIssue({ code: "custom", message: `${label}은 JSON으로 저장할 수 있어야 합니다.` });
    }
  });
}

const inputPayloadSchema = serializedJsonSchema(MAX_INPUT_BYTES, "콘텐츠 입력");
const outputPayloadSchema = serializedJsonSchema(MAX_OUTPUT_BYTES, "콘텐츠 출력");
const metadataSchema = z.record(z.string().min(1).max(120), z.unknown()).superRefine((value, context) => {
  if (Object.keys(value).some((key) => key.startsWith("_"))) {
    context.addIssue({ code: "custom", message: "밑줄로 시작하는 metadata 키는 내부용으로 예약되어 있습니다." });
  }
  try {
    if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_METADATA_BYTES) {
      context.addIssue({ code: "custom", message: "콘텐츠 metadata가 저장 크기 제한을 초과했습니다." });
    }
  } catch {
    context.addIssue({ code: "custom", message: "콘텐츠 metadata는 JSON으로 저장할 수 있어야 합니다." });
  }
});

export const contentListQuerySchema = collectionQuerySchema.extend({
  tool: contentToolSchema.optional(),
  status: contentStatusSchema.optional(),
  pinned: z.enum(["true", "false"]).optional(),
}).strict();

export const contentUpdateSchema = z.object({
  title: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(5_000).optional(),
  status: contentStatusSchema.optional(),
  pinned: z.boolean().optional(),
  metadata: metadataSchema.optional(),
  expectedUpdatedAt: z.string().min(1).max(64),
}).strict().refine(
  (value) => value.title !== undefined || value.notes !== undefined || value.status !== undefined
    || value.pinned !== undefined || value.metadata !== undefined,
  { message: "수정할 콘텐츠 메타데이터를 하나 이상 입력해 주세요." },
);

export const contentRevisionCreateSchema = z.object({
  input: inputPayloadSchema.optional(),
  output: outputPayloadSchema.optional(),
  origin: revisionOriginSchema.optional().default("edited"),
  expectedUpdatedAt: z.string().min(1).max(64),
}).strict().refine((value) => value.input !== undefined || value.output !== undefined, {
  message: "새 revision의 입력 또는 출력을 하나 이상 입력해 주세요.",
});

export const contentDeleteSchema = z.object({
  expectedUpdatedAt: z.string().min(1).max(64),
  cascadeConfirmed: z.boolean().default(false),
}).strict();

const storedContentSchema = z.object({
  tool: contentToolSchema,
  title: z.string().trim().max(120).optional().default(""),
  notes: z.string().trim().max(5_000).optional().default(""),
  status: contentStatusSchema.optional().default("generated"),
  pinned: z.boolean().optional().default(false),
  provider: z.string().trim().min(1).max(64).nullable().optional().default(null),
  clientRequestId: idempotencyKeySchema.nullable().optional().default(null),
  input: inputPayloadSchema,
  output: outputPayloadSchema,
  metadata: metadataSchema.optional().default({}),
  origin: revisionOriginSchema.optional().default("generated"),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();

interface ContentBaseRow {
  id: number;
  project_id: number | null;
  tool: string;
  title: string;
  notes: string;
  status: string;
  pinned: number;
  provider: string | null;
  client_request_id: string | null;
  metadata: string;
  created_at: string;
  updated_at: string;
  revision_count: number;
  current_revision: number;
}

interface ContentRow extends ContentBaseRow {
  input: string;
  output: string;
}

interface ContentRevisionRow {
  id: number;
  content_id: number;
  revision: number;
  input: string;
  output: string;
  origin: string;
  created_at: string;
}

export interface ContentSummaryResource {
  id: number;
  projectId: number;
  tool: string;
  title: string;
  notes: string;
  status: string;
  pinned: boolean;
  provider: string | null;
  clientRequestId: string | null;
  metadata: Record<string, unknown>;
  revisionCount: number;
  currentRevision: number;
  createdAt: string;
  updatedAt: string;
}

export interface ContentResource extends ContentSummaryResource {
  input: unknown;
  output: unknown;
}

export interface ContentRevisionResource {
  id: number;
  contentId: number;
  revision: number;
  input: unknown;
  output: unknown;
  origin: string;
  createdAt: string;
}

function parseJson(value: string): unknown {
  try { return JSON.parse(value) as unknown; } catch { return null; }
}

function parseMetadata(value: string, includePrivate = false) {
  const parsed = parseJson(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const metadata = { ...(parsed as Record<string, unknown>) };
  if (!includePrivate) {
    for (const key of Object.keys(metadata)) if (key.startsWith("_")) delete metadata[key];
  }
  return metadata;
}

function stringifyJson(value: unknown) {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new AppError("JSON으로 저장할 수 없는 콘텐츠입니다.", 422, "INVALID_CONTENT_JSON");
  return encoded;
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalJson(item)]));
  }
  return value;
}

export function contentRequestHash(value: unknown) {
  return createHash("sha256").update(stringifyJson(canonicalJson(value))).digest("hex");
}

function contentSelect(includePayload: boolean) {
  return `
    SELECT c.id, c.project_id, c.tool, c.title, c.notes, c.status, c.pinned, c.provider,
      c.client_request_id, ${includePayload ? "c.input, c.output," : ""} c.metadata, c.created_at, c.updated_at,
      (SELECT COUNT(*) FROM content_revisions r WHERE r.content_id = c.id) AS revision_count,
      COALESCE((SELECT MAX(r.revision) FROM content_revisions r WHERE r.content_id = c.id), 0) AS current_revision
    FROM contents c
  `;
}

function findContentRow(id: number) {
  return getDatabase().sqlite.prepare(`${contentSelect(true)} WHERE c.id = ?`).get(id) as ContentRow | undefined;
}

function findContentRowByRequest(clientRequestId: string) {
  return getDatabase().sqlite.prepare(`${contentSelect(true)} WHERE c.client_request_id = ?`).get(clientRequestId) as ContentRow | undefined;
}

function publicSummary(row: ContentBaseRow): ContentSummaryResource {
  return {
    id: row.id,
    projectId: row.project_id!,
    tool: row.tool,
    title: row.title,
    notes: row.notes,
    status: row.status,
    pinned: Boolean(row.pinned),
    provider: row.provider,
    clientRequestId: row.client_request_id,
    metadata: parseMetadata(row.metadata),
    revisionCount: row.revision_count,
    currentRevision: row.current_revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function publicContent(row: ContentRow): ContentResource {
  return { ...publicSummary(row), input: parseJson(row.input), output: parseJson(row.output) };
}

function publicRevision(row: ContentRevisionRow): ContentRevisionResource {
  return {
    id: row.id,
    contentId: row.content_id,
    revision: row.revision,
    input: parseJson(row.input),
    output: parseJson(row.output),
    origin: row.origin,
    createdAt: row.created_at,
  };
}

function ownedContentRow(id: number) {
  const row = expectFound(findContentRow(id), "콘텐츠를 찾을 수 없습니다.", "CONTENT_NOT_FOUND");
  const active = requireActiveProject();
  if (row.project_id !== active.id) {
    throw new AppError("활성 프로젝트의 콘텐츠가 아닙니다.", 409, "PROJECT_SCOPE_MISMATCH");
  }
  return row;
}

function escapedLike(value: string) {
  return `%${value.replace(/[\\%_]/g, "\\$&")}%`;
}

function nextTimestamp(previous: string) {
  const previousTime = Date.parse(previous);
  return new Date(Number.isFinite(previousTime) && previousTime >= Date.now() ? previousTime + 1 : Date.now()).toISOString();
}

export function listContents(input: unknown) {
  const query = contentListQuerySchema.parse(input);
  const active = requireActiveProject();
  const where = ["c.project_id = ?"];
  const parameters: Array<string | number> = [active.id];
  if (query.q) {
    const pattern = escapedLike(query.q);
    where.push("(c.title LIKE ? ESCAPE '\\' OR c.notes LIKE ? ESCAPE '\\' OR c.tool LIKE ? ESCAPE '\\' OR c.provider LIKE ? ESCAPE '\\')");
    parameters.push(pattern, pattern, pattern, pattern);
  }
  if (query.tool) { where.push("c.tool = ?"); parameters.push(query.tool); }
  if (query.status) { where.push("c.status = ?"); parameters.push(query.status); }
  if (query.pinned !== undefined) { where.push("c.pinned = ?"); parameters.push(query.pinned === "true" ? 1 : 0); }
  if (query.cursor) {
    const cursor = decodeCursor(query.cursor);
    where.push("(c.created_at < ? OR (c.created_at = ? AND c.id < ?))");
    parameters.push(cursor.timestamp, cursor.timestamp, cursor.id);
  }
  const rows = getDatabase().sqlite.prepare(`
    ${contentSelect(false)} WHERE ${where.join(" AND ")}
    ORDER BY c.created_at DESC, c.id DESC LIMIT ?
  `).all(...parameters, query.limit + 1) as ContentBaseRow[];
  return cursorPage(rows.map(publicSummary), query.limit, (content) => ({ timestamp: content.createdAt, id: content.id }));
}

export function getContent(idInput: unknown) {
  return publicContent(ownedContentRow(resourceIdSchema.parse(idInput)));
}

export function findContentByRequest(clientRequestIdInput: unknown, requestHash?: string) {
  const clientRequestId = idempotencyKeySchema.parse(clientRequestIdInput);
  const row = findContentRowByRequest(clientRequestId);
  if (!row) return null;
  const active = requireActiveProject();
  const actualHash = parseMetadata(row.metadata, true)._requestHash;
  if (row.project_id !== active.id || (requestHash !== undefined && actualHash !== requestHash)) {
    throw new AppError("같은 요청 ID가 다른 콘텐츠 입력에 이미 사용되었습니다.", 409, "IDEMPOTENCY_KEY_REUSED");
  }
  return publicContent(row);
}

export function storeGeneratedContent(input: unknown) {
  const parsed = storedContentSchema.parse(input);
  const active = requireActiveProject();
  const requestHash = parsed.clientRequestId
    ? parsed.requestHash ?? contentRequestHash({
      tool: parsed.tool,
      title: parsed.title,
      notes: parsed.notes,
      provider: parsed.provider,
      input: parsed.input,
      metadata: parsed.metadata,
    })
    : undefined;
  if (parsed.clientRequestId) {
    const existing = findContentRowByRequest(parsed.clientRequestId);
    if (existing) {
      const actualHash = parseMetadata(existing.metadata, true)._requestHash;
      if (existing.project_id !== active.id || actualHash !== requestHash) {
        throw new AppError("같은 요청 ID가 다른 콘텐츠 입력에 이미 사용되었습니다.", 409, "IDEMPOTENCY_KEY_REUSED");
      }
      return publicContent(existing);
    }
  }

  const { sqlite } = getDatabase();
  return transactionalMutation(sqlite, () => {
    const now = new Date().toISOString();
    const inputJson = stringifyJson(parsed.input);
    const outputJson = stringifyJson(parsed.output);
    const metadataJson = stringifyJson({ ...parsed.metadata, ...(requestHash ? { _requestHash: requestHash } : {}) });
    const result = sqlite.prepare(`
      INSERT INTO contents (
        project_id, tool, title, notes, status, pinned, provider, client_request_id,
        input, output, metadata, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      active.id, parsed.tool, parsed.title, parsed.notes, parsed.status, parsed.pinned ? 1 : 0,
      parsed.provider, parsed.clientRequestId, inputJson, outputJson, metadataJson, now, now,
    );
    const id = Number(result.lastInsertRowid);
    sqlite.prepare(`
      INSERT INTO content_revisions (content_id, revision, input, output, origin, created_at)
      VALUES (?, 1, ?, ?, ?, ?)
    `).run(id, inputJson, outputJson, parsed.origin, now);
    return publicContent(expectFound(findContentRow(id), "콘텐츠를 저장하지 못했습니다.", "CONTENT_CREATE_FAILED"));
  });
}

export function updateContent(idInput: unknown, input: unknown) {
  const id = resourceIdSchema.parse(idInput);
  const parsed = contentUpdateSchema.parse(input);
  const { sqlite } = getDatabase();
  return transactionalMutation(sqlite, () => {
    const row = ownedContentRow(id);
    assertExpectedUpdatedAt(row.updated_at, parsed.expectedUpdatedAt);
    const privateMetadata = Object.fromEntries(Object.entries(parseMetadata(row.metadata, true)).filter(([key]) => key.startsWith("_")));
    const metadata = parsed.metadata === undefined
      ? row.metadata
      : stringifyJson({ ...parsed.metadata, ...privateMetadata });
    const updatedAt = nextTimestamp(row.updated_at);
    sqlite.prepare(`
      UPDATE contents SET title = ?, notes = ?, status = ?, pinned = ?, metadata = ?, updated_at = ? WHERE id = ?
    `).run(
      parsed.title ?? row.title,
      parsed.notes ?? row.notes,
      parsed.status ?? row.status,
      parsed.pinned === undefined ? row.pinned : parsed.pinned ? 1 : 0,
      metadata,
      updatedAt,
      id,
    );
    return publicContent(expectFound(findContentRow(id), "콘텐츠를 찾을 수 없습니다.", "CONTENT_NOT_FOUND"));
  });
}

export function listContentRevisions(contentIdInput: unknown, input: unknown) {
  const contentId = resourceIdSchema.parse(contentIdInput);
  ownedContentRow(contentId);
  const query = collectionQuerySchema.parse(input);
  const where = ["content_id = ?"];
  const parameters: Array<string | number> = [contentId];
  if (query.q) {
    where.push("origin LIKE ? ESCAPE '\\'");
    parameters.push(escapedLike(query.q));
  }
  if (query.cursor) {
    const cursor = decodeCursor(query.cursor);
    where.push("(created_at < ? OR (created_at = ? AND id < ?))");
    parameters.push(cursor.timestamp, cursor.timestamp, cursor.id);
  }
  const rows = getDatabase().sqlite.prepare(`
    SELECT * FROM content_revisions WHERE ${where.join(" AND ")}
    ORDER BY created_at DESC, id DESC LIMIT ?
  `).all(...parameters, query.limit + 1) as ContentRevisionRow[];
  return cursorPage(rows.map(publicRevision), query.limit, (revision) => ({ timestamp: revision.createdAt, id: revision.id }));
}

export function createContentRevision(contentIdInput: unknown, input: unknown) {
  const contentId = resourceIdSchema.parse(contentIdInput);
  const parsed = contentRevisionCreateSchema.parse(input);
  const { sqlite } = getDatabase();
  return transactionalMutation(sqlite, () => {
    const row = ownedContentRow(contentId);
    assertExpectedUpdatedAt(row.updated_at, parsed.expectedUpdatedAt);
    const revision = row.current_revision + 1;
    const inputJson = parsed.input === undefined ? row.input : stringifyJson(parsed.input);
    const outputJson = parsed.output === undefined ? row.output : stringifyJson(parsed.output);
    const createdAt = nextTimestamp(row.updated_at);
    const result = sqlite.prepare(`
      INSERT INTO content_revisions (content_id, revision, input, output, origin, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(contentId, revision, inputJson, outputJson, parsed.origin, createdAt);
    sqlite.prepare("UPDATE contents SET input = ?, output = ?, updated_at = ? WHERE id = ?")
      .run(inputJson, outputJson, createdAt, contentId);
    const revisionRow = expectFound(
      sqlite.prepare("SELECT * FROM content_revisions WHERE id = ?").get(Number(result.lastInsertRowid)) as ContentRevisionRow | undefined,
      "콘텐츠 revision을 저장하지 못했습니다.",
      "CONTENT_REVISION_CREATE_FAILED",
    );
    return {
      content: publicContent(expectFound(findContentRow(contentId), "콘텐츠를 찾을 수 없습니다.", "CONTENT_NOT_FOUND")),
      revision: publicRevision(revisionRow),
    };
  });
}

export function deleteContent(idInput: unknown, input: unknown) {
  const id = resourceIdSchema.parse(idInput);
  const parsed = contentDeleteSchema.parse(input);
  const { sqlite } = getDatabase();
  return transactionalMutation(sqlite, () => {
    const row = ownedContentRow(id);
    assertExpectedUpdatedAt(row.updated_at, parsed.expectedUpdatedAt);
    assertDeleteAllowed({ contentRevisions: row.revision_count }, parsed.cascadeConfirmed, "CONTENT_HAS_REVISIONS");
    sqlite.prepare("DELETE FROM contents WHERE id = ?").run(id);
  });
}
