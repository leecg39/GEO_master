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
import { AppError } from "./errors";
import { requireActiveProject } from "./projects";

const kinds = ["audit", "share"] as const;
const formats = ["json", "csv", "pdf"] as const;

const configSchema = z.object({
  includeSections: z.array(z.string().trim().min(1).max(80)).max(40).optional().default([]),
}).strict();

export const reportPresetCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(kinds),
  auditId: resourceIdSchema.optional().nullable(),
  runId: resourceIdSchema.optional().nullable(),
  config: configSchema.optional().default({ includeSections: [] }),
  defaultFormat: z.enum(formats).optional().default("pdf"),
}).strict().superRefine((value, context) => {
  if (value.kind === "audit" && !value.auditId) {
    context.addIssue({ code: "custom", path: ["auditId"], message: "진단 리포트는 원본 진단 ID가 필요합니다." });
  }
  if (value.kind === "share" && !value.runId) {
    context.addIssue({ code: "custom", path: ["runId"], message: "측정 리포트는 원본 측정 ID가 필요합니다." });
  }
});

export const reportPresetUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  kind: z.enum(kinds).optional(),
  auditId: resourceIdSchema.nullable().optional(),
  runId: resourceIdSchema.nullable().optional(),
  config: configSchema.optional(),
  defaultFormat: z.enum(formats).optional(),
  expectedUpdatedAt: z.string().min(1).max(64),
}).strict().refine(
  (value) => value.name !== undefined || value.kind !== undefined || value.auditId !== undefined
    || value.runId !== undefined || value.config !== undefined || value.defaultFormat !== undefined,
  { message: "수정할 프리셋 필드를 하나 이상 입력해 주세요." },
);

export const reportPresetDeleteSchema = z.object({
  expectedUpdatedAt: z.string().min(1).max(64),
}).strict();

export const reportPresetListQuerySchema = collectionQuerySchema.extend({
  kind: z.enum(kinds).optional(),
}).strict();

interface PresetRow {
  id: number;
  project_id: number | null;
  name: string;
  kind: string;
  audit_id: number | null;
  run_id: number | null;
  config: string;
  default_format: string;
  created_at: string;
  updated_at: string;
}

function parseConfig(value: string) {
  try { return configSchema.parse(JSON.parse(value)); }
  catch { return { includeSections: [] as string[] }; }
}

function sourceExists(kind: string, auditId: number | null, runId: number | null) {
  const { sqlite } = getDatabase();
  if (kind === "audit") {
    if (!auditId) return false;
    return Boolean(sqlite.prepare("SELECT id FROM audits WHERE id = ?").get(auditId));
  }
  if (!runId) return false;
  return Boolean(sqlite.prepare("SELECT id FROM measure_runs WHERE id = ?").get(runId));
}

function publicPreset(row: PresetRow) {
  return {
    id: row.id,
    projectId: row.project_id!,
    name: row.name,
    kind: row.kind as (typeof kinds)[number],
    auditId: row.audit_id,
    runId: row.run_id,
    config: parseConfig(row.config),
    defaultFormat: row.default_format as (typeof formats)[number],
    orphan: !sourceExists(row.kind, row.audit_id, row.run_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function ownedRow(id: number) {
  const row = expectFound(
    getDatabase().sqlite.prepare("SELECT * FROM report_presets WHERE id = ?").get(id) as PresetRow | undefined,
    "리포트 프리셋을 찾을 수 없습니다.",
    "REPORT_PRESET_NOT_FOUND",
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

function assertSource(kind: string, auditId: number | null | undefined, runId: number | null | undefined) {
  const { sqlite } = getDatabase();
  const active = requireActiveProject();
  if (kind === "audit") {
    if (!auditId) throw new AppError("진단 리포트는 원본 진단 ID가 필요합니다.", 422, "AUDIT_SOURCE_REQUIRED");
    const audit = sqlite.prepare("SELECT id, project_id FROM audits WHERE id = ?").get(auditId) as { id: number; project_id: number | null } | undefined;
    if (!audit) throw new AppError("선택한 진단 이력이 없습니다.", 404, "AUDIT_NOT_FOUND");
    if (audit.project_id !== active.id) throw new AppError("활성 프로젝트의 진단이 아닙니다.", 409, "PROJECT_SCOPE_MISMATCH");
    return;
  }
  if (!runId) throw new AppError("측정 리포트는 원본 측정 ID가 필요합니다.", 422, "RUN_SOURCE_REQUIRED");
  const run = sqlite.prepare("SELECT id, project_id FROM measure_runs WHERE id = ?").get(runId) as { id: number; project_id: number | null } | undefined;
  if (!run) throw new AppError("선택한 측정 이력이 없습니다.", 404, "MEASURE_RUN_NOT_FOUND");
  if (run.project_id !== active.id) throw new AppError("활성 프로젝트의 측정이 아닙니다.", 409, "PROJECT_SCOPE_MISMATCH");
}

export function listReportPresets(input: unknown) {
  const query = reportPresetListQuerySchema.parse(input);
  const active = requireActiveProject();
  const where = ["project_id = ?"];
  const parameters: Array<string | number> = [active.id];
  if (query.q) {
    where.push("name LIKE ? ESCAPE '\\'");
    parameters.push(escapedLike(query.q));
  }
  if (query.kind) { where.push("kind = ?"); parameters.push(query.kind); }
  if (query.cursor) {
    const cursor = decodeCursor(query.cursor);
    where.push("(updated_at < ? OR (updated_at = ? AND id < ?))");
    parameters.push(cursor.timestamp, cursor.timestamp, cursor.id);
  }
  const rows = getDatabase().sqlite.prepare(`
    SELECT * FROM report_presets WHERE ${where.join(" AND ")}
    ORDER BY updated_at DESC, id DESC LIMIT ?
  `).all(...parameters, query.limit + 1) as PresetRow[];
  return cursorPage(rows.map(publicPreset), query.limit, (item) => ({ timestamp: item.updatedAt, id: item.id }));
}

export function getReportPreset(idInput: unknown) {
  return publicPreset(ownedRow(resourceIdSchema.parse(idInput)));
}

export function createReportPreset(input: unknown) {
  const parsed = reportPresetCreateSchema.parse(input);
  const active = requireActiveProject();
  assertSource(parsed.kind, parsed.auditId, parsed.runId);
  const { sqlite } = getDatabase();
  return transactionalMutation(sqlite, () => {
    const now = new Date().toISOString();
    const result = sqlite.prepare(`
      INSERT INTO report_presets (project_id, name, kind, audit_id, run_id, config, default_format, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      active.id, parsed.name, parsed.kind, parsed.kind === "audit" ? parsed.auditId ?? null : null,
      parsed.kind === "share" ? parsed.runId ?? null : null, JSON.stringify(parsed.config),
      parsed.defaultFormat, now, now,
    );
    return publicPreset(ownedRow(Number(result.lastInsertRowid)));
  });
}

export function updateReportPreset(idInput: unknown, input: unknown) {
  const id = resourceIdSchema.parse(idInput);
  const parsed = reportPresetUpdateSchema.parse(input);
  const { sqlite } = getDatabase();
  return transactionalMutation(sqlite, () => {
    const row = ownedRow(id);
    assertExpectedUpdatedAt(row.updated_at, parsed.expectedUpdatedAt);
    const kind = parsed.kind ?? row.kind;
    const auditId = parsed.auditId === undefined ? row.audit_id : parsed.auditId;
    const runId = parsed.runId === undefined ? row.run_id : parsed.runId;
    assertSource(kind, auditId, runId);
    const updatedAt = nextTimestamp(row.updated_at);
    sqlite.prepare(`
      UPDATE report_presets SET name = ?, kind = ?, audit_id = ?, run_id = ?, config = ?, default_format = ?, updated_at = ?
      WHERE id = ?
    `).run(
      parsed.name ?? row.name, kind, kind === "audit" ? auditId : null, kind === "share" ? runId : null,
      JSON.stringify(parsed.config ?? parseConfig(row.config)), parsed.defaultFormat ?? row.default_format,
      updatedAt, id,
    );
    return publicPreset(ownedRow(id));
  });
}

export function deleteReportPreset(idInput: unknown, input: unknown) {
  const id = resourceIdSchema.parse(idInput);
  const parsed = reportPresetDeleteSchema.parse(input);
  const { sqlite } = getDatabase();
  return transactionalMutation(sqlite, () => {
    const row = ownedRow(id);
    assertExpectedUpdatedAt(row.updated_at, parsed.expectedUpdatedAt);
    sqlite.prepare("DELETE FROM report_presets WHERE id = ?").run(id);
  });
}

export function duplicateReportPreset(idInput: unknown) {
  const source = publicPreset(ownedRow(resourceIdSchema.parse(idInput)));
  if (source.orphan) throw new AppError("원본이 삭제된 프리셋은 복제할 수 없습니다. 원본을 다시 선택해 주세요.", 409, "PRESET_SOURCE_MISSING");
  return createReportPreset({
    name: `${source.name} 복사본`.slice(0, 120),
    kind: source.kind,
    auditId: source.auditId,
    runId: source.runId,
    config: source.config,
    defaultFormat: source.defaultFormat,
  });
}
