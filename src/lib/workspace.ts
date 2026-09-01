import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDatabase } from "./db";
import {
  auditItems, audits, checklistStates, contentRevisions, contents, measureResults, measureRuns, projects,
  questionSets, questions, settings as settingsTable, strategyItems,
} from "./db/schema";
import { AppError } from "./errors";
import { getPublicSettings } from "./settings";

export const WORKSPACE_SCHEMA_VERSION = 1 as const;
export const MAX_WORKSPACE_BYTES = 25 * 1024 * 1024;
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const optionalId = id.nullable();
const short = z.string().max(500);
const timestamp = z.string().min(1).max(64);
const jsonSmall = z.string().max(200_000);
const jsonArray = z.custom<unknown[]>((value) => Array.isArray(value));
const jsonObject = z.custom<Record<string, unknown>>((value) => typeof value === "object" && value !== null && !Array.isArray(value));
function encodedJson(maxLength: number, shape: z.ZodType = z.unknown()) {
  return z.string().max(maxLength).superRefine((value, context) => {
    try {
      if (!shape.safeParse(JSON.parse(value)).success) context.addIssue({ code: "custom", message: "JSON 데이터 형태가 올바르지 않습니다." });
    } catch { context.addIssue({ code: "custom", message: "JSON 문자열이 올바르지 않습니다." }); }
  });
}

const providerModelsSchema = z.object({
  openai: z.string().min(1).max(120), anthropic: z.string().min(1).max(120),
  gemini: z.string().min(1).max(120), grok: z.string().min(1).max(120),
}).strict();
const providerWeightsSchema = z.object({
  openai: z.number().min(0).max(1), anthropic: z.number().min(0).max(1),
  gemini: z.number().min(0).max(1), grok: z.number().min(0).max(1),
}).strict();

const snapshotDataSchema = z.object({
  settings: z.object({
    brandName: z.string().max(120), category: z.string().max(120),
    competitors: z.array(z.string().min(1).max(120)).max(20), models: providerModelsSchema,
    repetitions: z.number().int().min(1).max(5), modelWeights: providerWeightsSchema,
  }).strict(),
  projects: z.array(z.object({
    id, name: short, brandName: z.string().max(120), category: z.string().max(120),
    competitors: encodedJson(200_000, jsonArray), createdAt: timestamp, updatedAt: timestamp,
  }).strict()).max(20_000),
  questionSets: z.array(z.object({ id, projectId: optionalId, name: short, createdAt: timestamp }).strict()).max(50_000),
  questions: z.array(z.object({
    id, questionSetId: optionalId, text: z.string().max(10_000), source: short,
    intent: short, segment: short, journeyStage: short, createdAt: timestamp,
  }).strict()).max(100_000),
  measureRuns: z.array(z.object({
    id, projectId: optionalId, status: z.string().max(30), models: encodedJson(200_000, jsonArray),
    repetitions: z.number().int().min(1).max(100), totalQueries: z.number().int().min(0),
    answerShare: z.number().finite(), genrank: z.number().finite(), funnelStage: short,
    summary: encodedJson(2_000_000, jsonObject), createdAt: timestamp, completedAt: timestamp.nullable(),
  }).strict()).max(50_000),
  measureResults: z.array(z.object({
    id, runId: id, questionText: z.string().max(10_000), provider: z.string().max(120),
    model: z.string().max(200), repetition: z.number().int().min(1).max(100),
    response: z.string().max(2_000_000), brandMentioned: z.boolean(), sentiment: z.string().max(30),
    mentionRank: z.number().int().positive().nullable(), competitorMentions: encodedJson(200_000, jsonArray), createdAt: timestamp,
  }).strict()).max(250_000),
  audits: z.array(z.object({
    id, url: z.string().max(2048), score: z.number().int(), grade: short,
    items: encodedJson(2_000_000, jsonArray), metadata: encodedJson(2_000_000, jsonObject), createdAt: timestamp,
  }).strict()).max(50_000),
  auditItems: z.array(z.object({
    id, auditId: id, code: short, category: short, passed: z.boolean(), manual: z.boolean(), detail: jsonSmall,
  }).strict()).max(250_000),
  contents: z.array(z.object({ id, tool: short, input: encodedJson(2_000_000), output: encodedJson(8_000_000), createdAt: timestamp }).strict()).max(100_000),
  checklistStates: z.array(z.object({ id, scope: short, itemKey: short, checked: z.boolean(), updatedAt: timestamp }).strict()).max(100_000),
  strategyItems: z.array(z.object({ id, type: short, title: z.string().max(2_000), data: encodedJson(2_000_000, jsonObject), status: short, createdAt: timestamp, updatedAt: timestamp }).strict()).max(100_000),
}).strict();

const statsSchema = z.object({
  projects: z.number().int().nonnegative(), questionSets: z.number().int().nonnegative(),
  questions: z.number().int().nonnegative(), measureRuns: z.number().int().nonnegative(),
  measureResults: z.number().int().nonnegative(), audits: z.number().int().nonnegative(),
  auditItems: z.number().int().nonnegative(), contents: z.number().int().nonnegative(),
  checklistStates: z.number().int().nonnegative(), strategyItems: z.number().int().nonnegative(),
}).strict();

export const workspaceSnapshotSchema = z.object({
  kind: z.literal("geo-master-workspace"), schemaVersion: z.literal(WORKSPACE_SCHEMA_VERSION),
  exportedAt: z.string().datetime(), workspaceName: z.string().max(200), stats: statsSchema,
  data: snapshotDataSchema,
}).strict().superRefine((snapshot, context) => {
  for (const key of Object.keys(snapshot.stats) as (keyof typeof snapshot.stats)[]) {
    if (snapshot.stats[key] !== snapshot.data[key].length) {
      context.addIssue({ code: "custom", path: ["stats", key], message: `${key} 개수와 실제 데이터가 일치하지 않습니다.` });
    }
  }
  const idGroups = ["projects", "questionSets", "questions", "measureRuns", "measureResults", "audits", "auditItems", "contents", "checklistStates", "strategyItems"] as const;
  for (const key of idGroups) {
    const ids = snapshot.data[key].map((row) => row.id);
    if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", path: ["data", key], message: `${key} ID가 중복되었습니다.` });
  }
  const checklistKeys = snapshot.data.checklistStates.map((row) => `${row.scope}\u0000${row.itemKey}`);
  if (new Set(checklistKeys).size !== checklistKeys.length) {
    context.addIssue({ code: "custom", path: ["data", "checklistStates"], message: "체크리스트 scope/itemKey가 중복되었습니다." });
  }
});

export const workspaceImportSchema = z.object({
  mode: z.enum(["merge", "replace"]), confirmReplace: z.boolean().optional().default(false),
  snapshot: workspaceSnapshotSchema,
}).strict().superRefine((input, context) => {
  if (input.mode === "replace" && !input.confirmReplace) {
    context.addIssue({ code: "custom", path: ["confirmReplace"], message: "교체 가져오기는 명시적 확인이 필요합니다." });
  }
});

export type WorkspaceSnapshot = z.infer<typeof workspaceSnapshotSchema>;
export type WorkspaceStats = z.infer<typeof statsSchema>;

function statsFromData(data: z.infer<typeof snapshotDataSchema>): WorkspaceStats {
  return {
    projects: data.projects.length, questionSets: data.questionSets.length, questions: data.questions.length,
    measureRuns: data.measureRuns.length, measureResults: data.measureResults.length,
    audits: data.audits.length, auditItems: data.auditItems.length, contents: data.contents.length,
    checklistStates: data.checklistStates.length, strategyItems: data.strategyItems.length,
  };
}

export function getWorkspaceStats(): WorkspaceStats {
  const { sqlite } = getDatabase();
  const count = (table: string) => (sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
  return {
    projects: count("projects"), questionSets: count("question_sets"), questions: count("questions"),
    measureRuns: count("measure_runs"), measureResults: count("measure_results"), audits: count("audits"),
    auditItems: count("audit_items"), contents: count("contents"), checklistStates: count("checklist_states"),
    strategyItems: count("strategy_items"),
  };
}

export function buildWorkspaceSnapshot(): WorkspaceSnapshot {
  const { orm } = getDatabase();
  const publicSettings = getPublicSettings();
  const data = {
    settings: {
      brandName: publicSettings.brandName, category: publicSettings.category,
      competitors: publicSettings.competitors, models: publicSettings.models,
      repetitions: publicSettings.repetitions, modelWeights: publicSettings.modelWeights,
    },
    projects: orm.select().from(projects).orderBy(asc(projects.id)).all(),
    questionSets: orm.select().from(questionSets).orderBy(asc(questionSets.id)).all().map((row) => ({
      id: row.id, projectId: row.projectId, name: row.name, createdAt: row.createdAt,
    })),
    questions: orm.select().from(questions).orderBy(asc(questions.id)).all().map((row) => ({
      id: row.id, questionSetId: row.questionSetId, text: row.text, source: row.source,
      intent: row.intent, segment: row.segment, journeyStage: row.journeyStage, createdAt: row.createdAt,
    })),
    measureRuns: orm.select().from(measureRuns).orderBy(asc(measureRuns.id)).all().map((row) => ({
      id: row.id, projectId: row.projectId, status: row.status, models: row.models,
      repetitions: row.repetitions, totalQueries: row.totalQueries, answerShare: row.answerShare,
      genrank: row.genrank, funnelStage: row.funnelStage, summary: row.summary,
      createdAt: row.createdAt, completedAt: row.completedAt,
    })),
    measureResults: orm.select().from(measureResults).orderBy(asc(measureResults.id)).all(),
    audits: orm.select().from(audits).orderBy(asc(audits.id)).all().map((row) => ({
      id: row.id, url: row.url, score: row.score, grade: row.grade, items: row.items,
      metadata: row.metadata, createdAt: row.createdAt,
    })),
    auditItems: orm.select().from(auditItems).orderBy(asc(auditItems.id)).all(),
    contents: orm.select().from(contents).orderBy(asc(contents.id)).all().map((row) => ({
      id: row.id, tool: row.tool, input: row.input, output: row.output, createdAt: row.createdAt,
    })),
    checklistStates: orm.select().from(checklistStates).orderBy(asc(checklistStates.id)).all().map((row) => ({
      id: row.id, scope: row.scope, itemKey: row.itemKey, checked: row.checked, updatedAt: row.updatedAt,
    })),
    strategyItems: orm.select().from(strategyItems).orderBy(asc(strategyItems.id)).all().map((row) => ({
      id: row.id, type: row.type, title: row.title, data: row.data, status: row.status,
      createdAt: row.createdAt, updatedAt: row.updatedAt,
    })),
  };
  return workspaceSnapshotSchema.parse({
    kind: "geo-master-workspace", schemaVersion: WORKSPACE_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(), workspaceName: publicSettings.brandName || "GEO Master workspace",
    stats: statsFromData(data), data,
  });
}

function mapped(map: Map<number, number>, source: number, relation: string): number;
function mapped(map: Map<number, number>, source: null, relation: string): null;
function mapped(map: Map<number, number>, source: number | null, relation: string): number | null;
function mapped(map: Map<number, number>, source: number | null, relation: string) {
  if (source === null) return null;
  const target = map.get(source);
  if (!target) throw new AppError(`${relation} 관계가 유효하지 않아 가져오기를 중단했습니다.`, 422, "INVALID_SNAPSHOT_RELATION");
  return target;
}

export function importWorkspace(input: unknown) {
  const parsed = workspaceImportSchema.parse(input);
  getPublicSettings(); // 설정 행과 최신 DB 마이그레이션을 먼저 보장한다.
  const { orm, sqlite } = getDatabase();
  const { data } = parsed.snapshot;
  const now = new Date().toISOString();

  const execute = sqlite.transaction(() => {
    if (parsed.mode === "replace") {
      sqlite.exec(`
        DELETE FROM audit_items; DELETE FROM measure_results; DELETE FROM questions;
        DELETE FROM question_sets; DELETE FROM measure_runs; DELETE FROM audits;
        DELETE FROM contents; DELETE FROM checklist_states; DELETE FROM strategy_items; DELETE FROM projects;
      `);
    }
    orm.update(settingsTable).set({
      brandName: data.settings.brandName, category: data.settings.category,
      competitors: JSON.stringify(data.settings.competitors), models: JSON.stringify(data.settings.models),
      repetitions: data.settings.repetitions, modelWeights: JSON.stringify(data.settings.modelWeights), updatedAt: now,
    }).where(eq(settingsTable.id, 1)).run();

    const projectMap = new Map<number, number>();
    for (const row of data.projects) {
      const inserted = orm.insert(projects).values({
        ...(parsed.mode === "replace" ? { id: row.id } : {}), name: row.name, brandName: row.brandName,
        category: row.category, competitors: row.competitors, createdAt: row.createdAt, updatedAt: row.updatedAt,
      }).returning({ id: projects.id }).get();
      projectMap.set(row.id, inserted.id);
    }
    const questionSetMap = new Map<number, number>();
    for (const row of data.questionSets) {
      const inserted = orm.insert(questionSets).values({
        ...(parsed.mode === "replace" ? { id: row.id } : {}), projectId: mapped(projectMap, row.projectId, "질문 세트/프로젝트"),
        name: row.name, createdAt: row.createdAt,
      }).returning({ id: questionSets.id }).get();
      questionSetMap.set(row.id, inserted.id);
    }
    for (const row of data.questions) {
      orm.insert(questions).values({
        ...(parsed.mode === "replace" ? { id: row.id } : {}), questionSetId: mapped(questionSetMap, row.questionSetId, "질문/질문 세트"),
        text: row.text, source: row.source, intent: row.intent, segment: row.segment,
        journeyStage: row.journeyStage, createdAt: row.createdAt,
      }).run();
    }
    const runMap = new Map<number, number>();
    for (const row of data.measureRuns) {
      const inserted = orm.insert(measureRuns).values({
        ...(parsed.mode === "replace" ? { id: row.id } : {}), projectId: mapped(projectMap, row.projectId, "측정/프로젝트"),
        status: row.status, models: row.models, repetitions: row.repetitions, totalQueries: row.totalQueries,
        answerShare: row.answerShare, genrank: row.genrank, funnelStage: row.funnelStage,
        summary: row.summary, createdAt: row.createdAt, completedAt: row.completedAt,
      }).returning({ id: measureRuns.id }).get();
      runMap.set(row.id, inserted.id);
    }
    for (const row of data.measureResults) {
      orm.insert(measureResults).values({
        ...(parsed.mode === "replace" ? { id: row.id } : {}), runId: mapped(runMap, row.runId, "측정 결과/측정"),
        questionText: row.questionText, provider: row.provider, model: row.model, repetition: row.repetition,
        response: row.response, brandMentioned: row.brandMentioned, sentiment: row.sentiment,
        mentionRank: row.mentionRank, competitorMentions: row.competitorMentions, createdAt: row.createdAt,
      }).run();
    }
    const auditMap = new Map<number, number>();
    for (const row of data.audits) {
      const inserted = orm.insert(audits).values({
        ...(parsed.mode === "replace" ? { id: row.id } : {}), url: row.url, score: row.score,
        grade: row.grade, items: row.items, metadata: row.metadata, createdAt: row.createdAt,
      }).returning({ id: audits.id }).get();
      auditMap.set(row.id, inserted.id);
    }
    for (const row of data.auditItems) {
      orm.insert(auditItems).values({
        ...(parsed.mode === "replace" ? { id: row.id } : {}), auditId: mapped(auditMap, row.auditId, "진단 항목/진단"),
        code: row.code, category: row.category, passed: row.passed, manual: row.manual, detail: row.detail,
      }).run();
    }
    for (const row of data.contents) {
      const inserted = orm.insert(contents).values({
        ...(parsed.mode === "replace" ? { id: row.id } : {}),
        tool: row.tool,
        input: row.input,
        output: row.output,
        createdAt: row.createdAt,
        updatedAt: row.createdAt,
      }).returning({ id: contents.id }).get();
      orm.insert(contentRevisions).values({
        contentId: inserted.id,
        revision: 1,
        input: row.input,
        output: row.output,
        origin: "restored",
        createdAt: row.createdAt,
      }).run();
    }
    for (const row of data.checklistStates) {
      orm.insert(checklistStates).values({
        ...(parsed.mode === "replace" ? { id: row.id } : {}), scope: row.scope, itemKey: row.itemKey,
        checked: row.checked, updatedAt: row.updatedAt,
      }).onConflictDoUpdate({ target: [checklistStates.scope, checklistStates.itemKey], set: { checked: row.checked, updatedAt: row.updatedAt } }).run();
    }
    for (const row of data.strategyItems) orm.insert(strategyItems).values({ ...(parsed.mode === "replace" ? { id: row.id } : {}), type: row.type, title: row.title, data: row.data, status: row.status, createdAt: row.createdAt, updatedAt: row.updatedAt }).run();
  });
  execute();
  return {
    mode: parsed.mode, importedAt: now, imported: parsed.snapshot.stats,
    idPolicy: parsed.mode === "merge" ? "remapped" as const : "preserved" as const,
    apiKeysPreserved: true,
  };
}

export function serializeWorkspaceSnapshot(snapshot = buildWorkspaceSnapshot()) {
  const text = `${JSON.stringify(snapshot, null, 2)}\n`;
  if (Buffer.byteLength(text, "utf8") > MAX_WORKSPACE_BYTES) {
    throw new AppError("워크스페이스 스냅샷이 25MB 제한을 초과했습니다.", 413, "SNAPSHOT_TOO_LARGE");
  }
  return text;
}
