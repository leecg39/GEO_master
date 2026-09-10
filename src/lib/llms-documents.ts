import { z } from "zod";
import {
  assertExpectedUpdatedAt,
  collectionQuerySchema,
  cursorPage,
  decodeCursor,
  expectFound,
  resourceIdSchema,
  transactionalMutation,
} from "./crud";
import { getDatabase } from "./db";
import { aiFilePathSchema, generateLlmsTxt, validateLlmsTxt, verifyRemoteLlmsTxt } from "./llms-txt";
import { AppError } from "./errors";
import { requireActiveProject } from "./projects";

const documentStatuses = ["draft", "validated", "deployed"] as const;
const MAX_DOCUMENT_BYTES = 100 * 1024;

const resourceSchema = z.object({
  title: z.string().trim().min(1).max(200),
  url: z.string().url().max(2048),
  description: z.string().trim().max(500).optional().default(""),
});

export const llmsDocumentCreateSchema = z.object({
  title: z.string().trim().min(1).max(120),
  website: z.string().url().max(2048),
  brandName: z.string().trim().min(1).max(200),
  summary: z.string().trim().max(500).optional().default(""),
  targetPath: aiFilePathSchema.optional().default("/llms.txt"),
  language: z.enum(["ko", "en"]).optional().default("ko"),
  details: z.string().trim().max(2000).optional().default(""),
  resources: z.array(resourceSchema).min(1).max(100),
  document: z.string().max(MAX_DOCUMENT_BYTES).optional().default(""),
}).strict();

export const llmsDocumentUpdateSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  website: z.string().url().max(2048).optional(),
  brandName: z.string().trim().min(1).max(200).optional(),
  summary: z.string().trim().max(500).optional(),
  targetPath: aiFilePathSchema.optional(),
  language: z.enum(["ko", "en"]).optional(),
  details: z.string().trim().max(2000).optional(),
  resources: z.array(resourceSchema).min(1).max(100).optional(),
  document: z.string().max(MAX_DOCUMENT_BYTES).optional(),
  status: z.enum(documentStatuses).optional(),
  expectedUpdatedAt: z.string().min(1).max(64),
}).strict().refine(
  (value) => ["title", "website", "brandName", "summary", "details", "resources", "document", "status", "targetPath", "language"]
    .some((key) => value[key as keyof typeof value] !== undefined),
  { message: "수정할 문서 필드를 하나 이상 입력해 주세요." },
);

export const llmsDocumentDeleteSchema = z.object({
  expectedUpdatedAt: z.string().min(1).max(64),
}).strict();

export const llmsDocumentListQuerySchema = collectionQuerySchema.extend({
  status: z.enum(documentStatuses).optional(),
}).strict();

interface DocumentRow {
  target_path: string;
  language: string;
  remote_document: string | null;
  remote_match: number | null;
  id: number;
  project_id: number | null;
  title: string;
  website: string;
  brand_name: string;
  summary: string;
  details: string;
  resources: string;
  document: string;
  validation: string;
  status: string;
  remote_url: string | null;
  remote_content_type: string | null;
  remote_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

function parseResources(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? resourceSchema.array().parse(parsed) : [];
  } catch {
    return [];
  }
}

function parseValidation(value: string) {
  try { return JSON.parse(value) as ReturnType<typeof validateLlmsTxt>; }
  catch { return validateLlmsTxt(""); }
}

function publicDocument(row: DocumentRow) {
  return {
    targetPath: row.target_path,
    language: row.language,
    remoteDocument: row.remote_document,
    remoteMatch: row.remote_match === null ? null : Boolean(row.remote_match),
    id: row.id,
    projectId: row.project_id!,
    title: row.title,
    website: row.website,
    brandName: row.brand_name,
    summary: row.summary,
    details: row.details,
    resources: parseResources(row.resources),
    document: row.document,
    validation: parseValidation(row.validation),
    status: row.status,
    remoteUrl: row.remote_url,
    remoteContentType: row.remote_content_type,
    remoteCheckedAt: row.remote_checked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function ownedRow(id: number) {
  const row = expectFound(
    getDatabase().sqlite.prepare("SELECT * FROM llms_documents WHERE id = ?").get(id) as DocumentRow | undefined,
    "llms.txt 문서를 찾을 수 없습니다.",
    "LLMS_DOCUMENT_NOT_FOUND",
  );
  requireActiveProject(row.project_id);
  return row;
}

function escapedLike(value: string) {
  return `%${value.replace(/[\\%_]/g, "\\$&")}%`;
}

function nextTimestamp(previous: string) {
  const previousTime = Date.parse(previous);
  return new Date(Number.isFinite(previousTime) && previousTime >= Date.now() ? previousTime + 1 : Date.now()).toISOString();
}

function generatedDocument(input: z.infer<typeof llmsDocumentCreateSchema> | {
  brandName: string; summary: string; website: string; details: string; resources: z.infer<typeof resourceSchema>[];
}) {
  return generateLlmsTxt({
    brandName: input.brandName,
    summary: input.summary,
    website: input.website,
    details: input.details,
    sections: [{ heading: "핵심 문서", links: input.resources }],
  });
}

export function listLlmsDocuments(input: unknown) {
  const query = llmsDocumentListQuerySchema.parse(input);
  const active = requireActiveProject();
  const where = ["project_id = ?"];
  const parameters: Array<string | number> = [active.id];
  if (query.q) {
    const pattern = escapedLike(query.q);
    where.push("(title LIKE ? ESCAPE '\\' OR website LIKE ? ESCAPE '\\' OR brand_name LIKE ? ESCAPE '\\')");
    parameters.push(pattern, pattern, pattern);
  }
  if (query.status) { where.push("status = ?"); parameters.push(query.status); }
  if (query.cursor) {
    const cursor = decodeCursor(query.cursor);
    where.push("(updated_at < ? OR (updated_at = ? AND id < ?))");
    parameters.push(cursor.timestamp, cursor.timestamp, cursor.id);
  }
  const rows = getDatabase().sqlite.prepare(`
    SELECT * FROM llms_documents WHERE ${where.join(" AND ")}
    ORDER BY updated_at DESC, id DESC LIMIT ?
  `).all(...parameters, query.limit + 1) as DocumentRow[];
  return cursorPage(rows.map(publicDocument), query.limit, (item) => ({ timestamp: item.updatedAt, id: item.id }));
}

export function getLlmsDocument(idInput: unknown) {
  return publicDocument(ownedRow(resourceIdSchema.parse(idInput)));
}

export function createLlmsDocument(input: unknown) {
  const parsed = llmsDocumentCreateSchema.parse(input);
  const active = requireActiveProject();
  const generated = parsed.document.trim()
    ? { document: parsed.document, validation: validateLlmsTxt(parsed.document, parsed.website) }
    : generatedDocument(parsed);
  const { sqlite } = getDatabase();
  return transactionalMutation(sqlite, () => {
    const now = new Date().toISOString();
    const result = sqlite.prepare(`
      INSERT INTO llms_documents (
        project_id, title, website, brand_name, summary, details, resources, document,
        validation, status, created_at, updated_at, target_path, language
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      active.id, parsed.title, parsed.website, parsed.brandName, parsed.summary, parsed.details,
      JSON.stringify(parsed.resources), generated.document, JSON.stringify(generated.validation),
      generated.validation.valid ? "validated" : "draft", now, now, parsed.targetPath, parsed.language,
    );
    sqlite.prepare("INSERT INTO llms_document_revisions (document_id, document, target_path, language, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(Number(result.lastInsertRowid), generated.document, parsed.targetPath, parsed.language, now);
    return publicDocument(ownedRow(Number(result.lastInsertRowid)));
  });
}

export function updateLlmsDocument(idInput: unknown, input: unknown) {
  const id = resourceIdSchema.parse(idInput);
  const parsed = llmsDocumentUpdateSchema.parse(input);
  const { sqlite } = getDatabase();
  return transactionalMutation(sqlite, () => {
    const row = ownedRow(id);
    assertExpectedUpdatedAt(row.updated_at, parsed.expectedUpdatedAt);
    if (parsed.status === "deployed") throw new AppError("게시 확인 상태는 공개 파일 재검증을 통해서만 설정됩니다.", 422, "REMOTE_VERIFICATION_REQUIRED");
    const next = {
      title: parsed.title ?? row.title,
      website: parsed.website ?? row.website,
      brandName: parsed.brandName ?? row.brand_name,
      summary: parsed.summary ?? row.summary,
      details: parsed.details ?? row.details,
      resources: parsed.resources ?? parseResources(row.resources),
      document: parsed.document ?? row.document,
      status: parsed.status ?? row.status,
      targetPath: parsed.targetPath ?? row.target_path,
      language: parsed.language ?? row.language,
    };
    const validation = validateLlmsTxt(next.document, next.website);
    const updatedAt = nextTimestamp(row.updated_at);
    sqlite.prepare(`
      UPDATE llms_documents SET title = ?, website = ?, brand_name = ?, summary = ?, details = ?,
        resources = ?, document = ?, validation = ?, status = ?, updated_at = ?, target_path = ?, language = ?,
        remote_match = NULL, remote_checked_at = NULL WHERE id = ?
    `).run(
      next.title, next.website, next.brandName, next.summary, next.details,
      JSON.stringify(next.resources), next.document, JSON.stringify(validation),
      validation.valid ? "validated" : "draft", updatedAt, next.targetPath, next.language, id,
    );
    sqlite.prepare("INSERT INTO llms_document_revisions (document_id, document, target_path, language, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, next.document, next.targetPath, next.language, updatedAt);
    return publicDocument(ownedRow(id));
  });
}

export function deleteLlmsDocument(idInput: unknown, input: unknown) {
  const id = resourceIdSchema.parse(idInput);
  const parsed = llmsDocumentDeleteSchema.parse(input);
  const { sqlite } = getDatabase();
  return transactionalMutation(sqlite, () => {
    const row = ownedRow(id);
    assertExpectedUpdatedAt(row.updated_at, parsed.expectedUpdatedAt);
    sqlite.prepare("DELETE FROM llms_documents WHERE id = ?").run(id);
  });
}

export function duplicateLlmsDocument(idInput: unknown) {
  const source = publicDocument(ownedRow(resourceIdSchema.parse(idInput)));
  return createLlmsDocument({
    title: `${source.title} 복사본`.slice(0, 120),
    website: source.website,
    brandName: source.brandName,
    summary: source.summary,
    details: source.details,
    resources: source.resources,
    document: source.document,
    targetPath: source.targetPath,
    language: source.language,
  });
}

export function validateStoredLlmsDocument(idInput: unknown, input: unknown) {
  const id = resourceIdSchema.parse(idInput);
  const parsed = llmsDocumentDeleteSchema.parse(input);
  const { sqlite } = getDatabase();
  return transactionalMutation(sqlite, () => {
    const row = ownedRow(id);
    assertExpectedUpdatedAt(row.updated_at, parsed.expectedUpdatedAt);
    const validation = validateLlmsTxt(row.document, row.website);
    const updatedAt = nextTimestamp(row.updated_at);
    sqlite.prepare("UPDATE llms_documents SET validation = ?, status = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(validation), validation.valid ? "validated" : "draft", updatedAt, id);
    return publicDocument(ownedRow(id));
  });
}

export async function verifyStoredLlmsDocument(idInput: unknown, input: unknown) {
  const id = resourceIdSchema.parse(idInput);
  const parsed = llmsDocumentDeleteSchema.parse(input);
  const row = ownedRow(id);
  assertExpectedUpdatedAt(row.updated_at, parsed.expectedUpdatedAt);
  const remote = await verifyRemoteLlmsTxt(row.website, row.target_path, row.document);
  const { sqlite } = getDatabase();
  return transactionalMutation(sqlite, () => {
    const current = ownedRow(id);
    assertExpectedUpdatedAt(current.updated_at, parsed.expectedUpdatedAt);
    const updatedAt = nextTimestamp(current.updated_at);
    sqlite.prepare(`
      UPDATE llms_documents SET remote_document = ?, validation = ?, status = ?, remote_url = ?,
        remote_content_type = ?, remote_checked_at = ?, updated_at = ?, remote_match = ? WHERE id = ?
    `).run(
      remote.document, JSON.stringify(remote.validation),
      remote.verified ? "deployed" : "draft",
      remote.url, remote.contentType, updatedAt, updatedAt, remote.matches ? 1 : 0, id,
    );
    return publicDocument(ownedRow(id));
  });
}

export function listLlmsDocumentRevisions(idInput: unknown) {
  const row = ownedRow(resourceIdSchema.parse(idInput));
  return getDatabase().sqlite.prepare("SELECT id, document, target_path AS targetPath, language, created_at AS createdAt FROM llms_document_revisions WHERE document_id = ? ORDER BY id DESC LIMIT 30").all(row.id);
}
