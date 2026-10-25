import { z } from "zod";
import { generationContextSchema } from "./studio-context";
import { getDatabase } from "./db";
import { AppError } from "./errors";
import { knowledgeSchema, writingProfileSchema } from "./library";
import { opportunityEvidenceSchema, opportunityKinds, opportunityResource, opportunityStatus, normalizeOpportunityQuestion, type OpportunityRow, type OpportunityEvidence } from "./opportunities";

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER), nullableId = id.nullable(), timestamp = z.string().min(1).max(64);
const common = { id, projectId: id, createdAt: timestamp, updatedAt: timestamp };
export const haloSnapshotFields = {
  knowledgeDocuments: z.array(z.object({ ...common, data: knowledgeSchema }).strict()).max(20_000).default([]),
  writingProfiles: z.array(z.object({ ...common, data: writingProfileSchema }).strict()).max(20_000).default([]),
  opportunities: z.array(z.object({ ...common, question: z.string().min(1).max(10_000), questionKey: z.string().min(1).max(10_000),
    kind: z.enum(opportunityKinds), status: z.enum(opportunityStatus), notes: z.string().max(5000), evidence: opportunityEvidenceSchema,
    questionId: nullableId, strategyId: nullableId, baselineRunId: nullableId, followupRunId: nullableId,
    followupEvidence: opportunityEvidenceSchema.nullable().default(null),
    appliedUrl: z.string().max(2048), appliedAt: z.string().max(10),
  }).strict()).max(100_000).default([]),
  opportunityDecisions: z.array(z.object({ id, opportunityId: id, action: z.string().max(40), notes: z.string().max(5000), createdAt: timestamp }).strict()).max(250_000).default([]),
  opportunityContents: z.array(z.object({ opportunityId: id, contentId: id }).strict()).max(100_000).default([]),
};
const schema = z.object(haloSnapshotFields);
export type HaloSnapshot = z.infer<typeof schema>;
export const haloStatsFields = Object.fromEntries(Object.keys(haloSnapshotFields).map(key => [key, z.number().int().nonnegative().optional()])) as { [K in keyof HaloSnapshot]: z.ZodOptional<z.ZodNumber> };
export function exportHaloSnapshot(): HaloSnapshot {
  const { sqlite } = getDatabase();
  const library = (table: string) => (sqlite.prepare(`SELECT id, project_id AS projectId, data, created_at AS createdAt, updated_at AS updatedAt FROM ${table} ORDER BY id`).all() as { id: number; projectId: number; data: string; createdAt: string; updatedAt: string }[]).map(row => ({ ...row, data: JSON.parse(row.data) }));
  const results = new Set((sqlite.prepare("SELECT id FROM measure_results").all() as { id: number }[]).map(row => row.id));
  const detach = (ev: OpportunityEvidence) => ({ ...ev, samples: ev.samples.map(sample => ({ ...sample, resultId: sample.resultId && results.has(sample.resultId) ? sample.resultId : null })) });
  return schema.parse({
    knowledgeDocuments: library("knowledge_documents"), writingProfiles: library("writing_profiles"),
    opportunities: (sqlite.prepare("SELECT * FROM opportunities ORDER BY id").all() as OpportunityRow[]).map(row => {
      const item = opportunityResource(row);
      return { ...item, evidence: detach(item.evidence), followupEvidence: item.followupEvidence ? detach(item.followupEvidence) : null };
    }),
    opportunityDecisions: sqlite.prepare("SELECT id, opportunity_id AS opportunityId, action, notes, created_at AS createdAt FROM opportunity_decisions ORDER BY id").all(),
    opportunityContents: sqlite.prepare("SELECT opportunity_id AS opportunityId, content_id AS contentId FROM opportunity_contents ORDER BY opportunity_id, content_id").all(),
  });
}
export function haloStats(data?: HaloSnapshot) {
  if (data) return Object.fromEntries(Object.entries(data).map(([key, rows]) => [key, rows.length])) as Record<keyof HaloSnapshot, number>;
  const tables = { knowledgeDocuments: "knowledge_documents", writingProfiles: "writing_profiles", opportunities: "opportunities", opportunityDecisions: "opportunity_decisions", opportunityContents: "opportunity_contents" };
  return Object.fromEntries(Object.entries(tables).map(([key, table]) => [key, (getDatabase().sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n])) as Record<keyof HaloSnapshot, number>;
}
type IdMaps = { projectMap: Map<number, number>; questionMap: Map<number, number>; runMap: Map<number, number>; resultMap: Map<number, number>; contentMap: Map<number, number>; strategyMap: Map<number, number>; factMap: Map<number, number> };
export function importHaloSnapshot(data: HaloSnapshot, maps: IdMaps, preserve: boolean) {
  const { sqlite } = getDatabase();
  const mapId = (map: Map<number, number>, old: number | null): number | null => {
    if (old === null) return null;
    const value = map.get(old);
    if (!value) throw new AppError("기회·라이브러리 백업의 연결 관계가 올바르지 않습니다.", 422, "INVALID_SNAPSHOT_RELATION");
    return value;
  };
  const insert = (table: string, values: Record<string, string | number | null>) => {
    const fields = Object.keys(values);
    return Number(sqlite.prepare(`INSERT INTO ${table} (${fields.join(",")}) VALUES (${fields.map(() => "?").join(",")})`).run(...Object.values(values)).lastInsertRowid);
  };
  const documentMap = new Map<number, number>(), profileMap = new Map<number, number>(), opportunityMap = new Map<number, number>();
  for (const [table, rows, map] of [["knowledge_documents", data.knowledgeDocuments, documentMap], ["writing_profiles", data.writingProfiles, profileMap]] as const) {
    for (const row of rows) map.set(row.id, insert(table, { ...(preserve ? { id: row.id } : {}), project_id: mapId(maps.projectMap, row.projectId), data: JSON.stringify(row.data), created_at: row.createdAt, updated_at: row.updatedAt }));
  }
  const checkProject = (table: string, id: number | null, projectId: number | null) => {
    if (id === null) return;
    const row = table === "questions"
      ? sqlite.prepare("SELECT s.project_id FROM questions q JOIN question_sets s ON s.id = q.question_set_id WHERE q.id = ?").get(id)
      : sqlite.prepare(`SELECT project_id FROM ${table} WHERE id = ?`).get(id);
    if (!row || (row as { project_id: number }).project_id !== projectId) throw new AppError("다른 프로젝트의 연결이 포함된 백업입니다.", 422, "INVALID_SNAPSHOT_RELATION");
  };
  for (const row of data.opportunities) {
    const projectId = mapId(maps.projectMap, row.projectId), questionId = mapId(maps.questionMap, row.questionId), strategyId = mapId(maps.strategyMap, row.strategyId);
    const baselineId = mapId(maps.runMap, row.baselineRunId), followupId = mapId(maps.runMap, row.followupRunId);
    for (const [table, ref] of [["questions", questionId], ["strategy_items", strategyId], ["measure_runs", baselineId], ["measure_runs", followupId]] as const) checkProject(table, ref, projectId);
    const remapEvidence = (snapshot: OpportunityEvidence, runId: number | null) => ({ ...snapshot, samples: snapshot.samples.map(sample => {
      const resultId = mapId(maps.resultMap, sample.resultId);
      if (resultId !== null) {
        const result = sqlite.prepare("SELECT run_id FROM measure_results WHERE id = ?").get(resultId) as { run_id: number } | undefined;
        if (!result || result.run_id !== runId) throw new AppError("측정 근거의 실행 연결이 일치하지 않습니다.", 422, "INVALID_SNAPSHOT_RELATION");
      }
      return { ...sample, resultId };
    }) });
    const evidence = remapEvidence(row.evidence, baselineId);
    const followup = row.followupEvidence ? remapEvidence(row.followupEvidence, followupId) : null;
    opportunityMap.set(row.id, insert("opportunities", { ...(preserve ? { id: row.id } : {}), project_id: projectId, question: row.question,
      question_key: normalizeOpportunityQuestion(row.question), kind: row.kind, status: row.status, notes: row.notes, evidence: JSON.stringify(evidence),
      question_id: questionId, strategy_id: strategyId, baseline_run_id: baselineId, followup_run_id: followupId, followup_evidence: JSON.stringify(followup),
      applied_url: row.appliedUrl, applied_at: row.appliedAt, created_at: row.createdAt, updated_at: row.updatedAt }));
  }
  for (const row of data.opportunityDecisions) insert("opportunity_decisions", { ...(preserve ? { id: row.id } : {}), opportunity_id: mapId(opportunityMap, row.opportunityId), action: row.action, notes: row.notes, created_at: row.createdAt });
  for (const row of data.opportunityContents) {
    const opportunityId = mapId(opportunityMap, row.opportunityId), contentId = mapId(maps.contentMap, row.contentId);
    const owner = sqlite.prepare("SELECT project_id FROM opportunities WHERE id = ?").get(opportunityId) as { project_id: number };
    checkProject("contents", contentId, owner.project_id);
    insert("opportunity_contents", { opportunity_id: opportunityId, content_id: contentId });
  }
  // Context objects are immutable historical snapshots. Missing/deleted references become null;
  // their text/version stays intact and must never bind to an unrelated newly allocated ID.
  const remapJson = (text: string, ownerProjectId: number) => {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) return text;
    const parsed = generationContextSchema.safeParse(value.generationContext);
    if (!parsed.success) return text;
    const context = parsed.data;
    const contextProjectId = mapId(maps.projectMap, context.projectId);
    if (contextProjectId !== ownerProjectId) throw new AppError("생성 문맥과 콘텐츠의 프로젝트가 다릅니다.", 422, "INVALID_SNAPSHOT_RELATION");
    const remapOwned = (table: string, map: Map<number, number>, old: unknown) => {
      const next = typeof old === "number" ? map.get(old) ?? null : null;
      checkProject(table, next, ownerProjectId);
      return next;
    };
    if (value.projectId != null) {
      if (mapId(maps.projectMap, value.projectId) !== ownerProjectId) throw new AppError("콘텐츠 입력의 프로젝트가 다릅니다.", 422, "INVALID_SNAPSHOT_RELATION");
      value.projectId = ownerProjectId;
    }
    if (value.opportunityId !== undefined) value.opportunityId = remapOwned("opportunities", opportunityMap, value.opportunityId);
    if (value.writingProfileId !== undefined) value.writingProfileId = remapOwned("writing_profiles", profileMap, value.writingProfileId);
    if (Array.isArray(value.knowledgeDocumentIds)) value.knowledgeDocumentIds = value.knowledgeDocumentIds.map((ref: unknown) => remapOwned("knowledge_documents", documentMap, ref)).filter((ref: number | null) => ref !== null);
    context.projectId = ownerProjectId;
    const remapResource = (resource: { id: number | null; projectId: number }, table: string, map: Map<number, number>) => {
      if (mapId(maps.projectMap, resource.projectId) !== ownerProjectId) throw new AppError("생성 자료의 프로젝트가 다릅니다.", 422, "INVALID_SNAPSHOT_RELATION");
      resource.id = remapOwned(table, map, resource.id); resource.projectId = ownerProjectId;
    };
    if (context.writingProfile) remapResource(context.writingProfile, "writing_profiles", profileMap);
    for (const item of context.knowledgeDocuments) remapResource(item, "knowledge_documents", documentMap);
    for (const item of context.facts) remapResource(item, "facts", maps.factMap);
    if (context.opportunity) {
      context.opportunity.id = remapOwned("opportunities", opportunityMap, context.opportunity.id);
      context.opportunity.baselineRunId = remapOwned("measure_runs", maps.runMap, context.opportunity.baselineRunId);
    }
    value.generationContext = context;
    return JSON.stringify(value);
  };
  for (const contentId of maps.contentMap.values()) {
    const row = sqlite.prepare("SELECT input, output, project_id FROM contents WHERE id = ?").get(contentId) as { input: string; output: string; project_id: number };
    sqlite.prepare("UPDATE contents SET input = ?, output = ? WHERE id = ?").run(remapJson(row.input, row.project_id), remapJson(row.output, row.project_id), contentId);
    const revisions = sqlite.prepare("SELECT id, input, output FROM content_revisions WHERE content_id = ?").all(contentId) as { id: number; input: string; output: string }[];
    for (const revision of revisions) sqlite.prepare("UPDATE content_revisions SET input = ?, output = ? WHERE id = ?").run(remapJson(revision.input, row.project_id), remapJson(revision.output, row.project_id), revision.id);
  }
}
