import { z } from "zod";
import {
  assertDeleteAllowed,
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

export const measureRunUpdateSchema = z.object({
  title: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(5_000).optional(),
  expectedUpdatedAt: z.string().min(1).max(64),
}).strict().refine((value) => value.title !== undefined || value.notes !== undefined, {
  message: "수정할 측정 메타데이터를 하나 이상 입력해 주세요.",
});

export const measureRunDeleteSchema = z.object({
  expectedUpdatedAt: z.string().min(1).max(64),
  cascadeConfirmed: z.boolean().default(false),
}).strict();

interface MeasureRunRow {
  id: number;
  project_id: number | null;
  title: string;
  notes: string;
  client_request_id: string | null;
  status: string;
  models: string;
  repetitions: number;
  total_queries: number;
  answer_share: number;
  genrank: number;
  funnel_stage: string;
  summary: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface MeasureResultRow {
  id: number;
  run_id: number;
  question_text: string;
  provider: string;
  model: string;
  repetition: number;
  response: string;
  brand_mentioned: number;
  sentiment: string;
  mention_rank: number | null;
  competitor_mentions: string;
  created_at: string;
}

export interface MeasureRunResource {
  id: number;
  projectId: number;
  title: string;
  notes: string;
  clientRequestId: string | null;
  status: string;
  models: Array<{ provider: string; model: string }>;
  repetitions: number;
  totalQueries: number;
  answerShare: number;
  genrank: number;
  funnelStage: string;
  summary: Record<string, unknown>;
  resultCount: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface MeasureResultResource {
  id: number;
  runId: number;
  questionText: string;
  provider: string;
  model: string;
  repetition: number;
  response: string;
  brandMentioned: boolean;
  sentiment: string;
  mentionRank: number | null;
  competitorMentions: string[];
  createdAt: string;
}

function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function findRunRow(id: number) {
  return getDatabase().sqlite.prepare("SELECT * FROM measure_runs WHERE id = ?").get(id) as MeasureRunRow | undefined;
}

function publicRun(row: MeasureRunRow): MeasureRunResource {
  const summary = parseJson<Record<string, unknown>>(row.summary, {});
  delete summary._requestHash;
  const resultCount = (getDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM measure_results WHERE run_id = ?").get(row.id) as { count: number }).count;
  return {
    id: row.id,
    projectId: row.project_id!,
    title: row.title,
    notes: row.notes,
    clientRequestId: row.client_request_id,
    status: row.status,
    models: parseJson<Array<{ provider: string; model: string }>>(row.models, []),
    repetitions: row.repetitions,
    totalQueries: row.total_queries,
    answerShare: row.answer_share,
    genrank: row.genrank,
    funnelStage: row.funnel_stage,
    summary,
    resultCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function publicResult(row: MeasureResultRow): MeasureResultResource {
  return {
    id: row.id,
    runId: row.run_id,
    questionText: row.question_text,
    provider: row.provider,
    model: row.model,
    repetition: row.repetition,
    response: row.response,
    brandMentioned: Boolean(row.brand_mentioned),
    sentiment: row.sentiment,
    mentionRank: row.mention_rank,
    competitorMentions: parseJson<string[]>(row.competitor_mentions, []),
    createdAt: row.created_at,
  };
}

function ownedRunRow(id: number) {
  const row = expectFound(findRunRow(id), "측정 실행 이력을 찾을 수 없습니다.", "MEASURE_RUN_NOT_FOUND");
  const active = requireActiveProject();
  if (row.project_id !== active.id) {
    throw new AppError("활성 프로젝트의 측정 실행이 아닙니다.", 409, "PROJECT_SCOPE_MISMATCH");
  }
  return row;
}

function escapedLike(value: string) {
  return `%${value.replace(/[\\%_]/g, "\\$&")}%`;
}

export function listMeasureRuns(input: unknown) {
  const query = collectionQuerySchema.parse(input);
  const active = requireActiveProject();
  const where = ["project_id = ?"];
  const parameters: Array<string | number> = [active.id];
  if (query.q) {
    const pattern = escapedLike(query.q);
    where.push("(title LIKE ? ESCAPE '\\' OR notes LIKE ? ESCAPE '\\' OR status LIKE ? ESCAPE '\\')");
    parameters.push(pattern, pattern, pattern);
  }
  if (query.cursor) {
    const cursor = decodeCursor(query.cursor);
    where.push("(created_at < ? OR (created_at = ? AND id < ?))");
    parameters.push(cursor.timestamp, cursor.timestamp, cursor.id);
  }
  const rows = getDatabase().sqlite.prepare(`
    SELECT * FROM measure_runs WHERE ${where.join(" AND ")}
    ORDER BY created_at DESC, id DESC LIMIT ?
  `).all(...parameters, query.limit + 1) as MeasureRunRow[];
  return cursorPage(rows.map(publicRun), query.limit, (run) => ({ timestamp: run.createdAt, id: run.id }));
}

export function getMeasureRun(idInput: unknown) {
  const id = resourceIdSchema.parse(idInput);
  return publicRun(ownedRunRow(id));
}

export function listMeasureResults(runIdInput: unknown, input: unknown) {
  const runId = resourceIdSchema.parse(runIdInput);
  ownedRunRow(runId);
  const query = collectionQuerySchema.parse(input);
  const where = ["run_id = ?"];
  const parameters: Array<string | number> = [runId];
  if (query.q) {
    const pattern = escapedLike(query.q);
    where.push("(question_text LIKE ? ESCAPE '\\' OR provider LIKE ? ESCAPE '\\' OR model LIKE ? ESCAPE '\\' OR response LIKE ? ESCAPE '\\')");
    parameters.push(pattern, pattern, pattern, pattern);
  }
  if (query.cursor) {
    const cursor = decodeCursor(query.cursor);
    where.push("(created_at < ? OR (created_at = ? AND id < ?))");
    parameters.push(cursor.timestamp, cursor.timestamp, cursor.id);
  }
  const rows = getDatabase().sqlite.prepare(`
    SELECT * FROM measure_results WHERE ${where.join(" AND ")}
    ORDER BY created_at DESC, id DESC LIMIT ?
  `).all(...parameters, query.limit + 1) as MeasureResultRow[];
  return cursorPage(rows.map(publicResult), query.limit, (result) => ({ timestamp: result.createdAt, id: result.id }));
}

export function updateMeasureRun(idInput: unknown, input: unknown) {
  const id = resourceIdSchema.parse(idInput);
  const parsed = measureRunUpdateSchema.parse(input);
  const { sqlite } = getDatabase();
  return transactionalMutation(sqlite, () => {
    const row = ownedRunRow(id);
    assertExpectedUpdatedAt(row.updated_at, parsed.expectedUpdatedAt);
    const previous = Date.parse(row.updated_at);
    const updatedAt = new Date(Number.isFinite(previous) && previous >= Date.now() ? previous + 1 : Date.now()).toISOString();
    sqlite.prepare("UPDATE measure_runs SET title = ?, notes = ?, updated_at = ? WHERE id = ?")
      .run(parsed.title ?? row.title, parsed.notes ?? row.notes, updatedAt, id);
    return publicRun(expectFound(findRunRow(id), "측정 실행 이력을 찾을 수 없습니다.", "MEASURE_RUN_NOT_FOUND"));
  });
}

export function deleteMeasureRun(idInput: unknown, input: unknown) {
  const id = resourceIdSchema.parse(idInput);
  const parsed = measureRunDeleteSchema.parse(input);
  const { sqlite } = getDatabase();
  return transactionalMutation(sqlite, () => {
    const row = ownedRunRow(id);
    assertExpectedUpdatedAt(row.updated_at, parsed.expectedUpdatedAt);
    if (row.status === "running") {
      throw new AppError("실행 중인 측정은 삭제할 수 없습니다.", 409, "MEASURE_RUN_IN_PROGRESS");
    }
    const measurementJobs = (sqlite.prepare("SELECT COUNT(*) AS count FROM measurement_jobs WHERE run_id = ?").get(id) as { count: number }).count;
    const reportPresets = (sqlite.prepare("SELECT COUNT(*) AS count FROM report_presets WHERE run_id = ?").get(id) as { count: number }).count;
    assertDeleteAllowed({ measurementJobs, reportPresets }, parsed.cascadeConfirmed, "MEASURE_RUN_HAS_DEPENDENCIES");
    sqlite.prepare("DELETE FROM measure_runs WHERE id = ?").run(id);
  });
}

export function storedMeasureRunByRequest(clientRequestId: string) {
  return getDatabase().sqlite.prepare("SELECT * FROM measure_runs WHERE client_request_id = ?").get(clientRequestId) as MeasureRunRow | undefined;
}

export function storedMeasureRunById(id: number) {
  return findRunRow(id);
}

export function storedMeasureRunHash(row: { summary: string }) {
  const value = parseJson<Record<string, unknown>>(row.summary, {})._requestHash;
  return typeof value === "string" ? value : null;
}

export function publicStoredMeasureRun(row: MeasureRunRow) {
  return publicRun(row);
}
