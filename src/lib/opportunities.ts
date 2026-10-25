import { z } from "zod";
import { assertExpectedUpdatedAt, expectFound, resourceIdSchema } from "./crud";
import { getDatabase } from "./db";
import { AppError } from "./errors";
import { requireHalo } from "./halo-feature";
import { expectedSchema, nextHaloTime, sourceUrlSchema } from "./library";
import { monitoringMatcher } from "./monitoring-matching";
import { compareMonitoringRuns } from "./monitoring-runs";
import { requireActiveProject, type ProjectResource } from "./projects";
import { createQuestion } from "./question-pool";
import { createStrategyItem } from "./strategy";

export const opportunityKinds = ["competitor_gap", "citation_gap", "unmeasured"] as const;
export const opportunityStatus = ["pending", "dismissed", "accepted"] as const;
export const normalizeOpportunityQuestion = (text: string) => text.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
export const opportunityEvidenceSchema = z.object({
  capturedAt: z.string(), measuredAt: z.string().nullable(),
  brand: z.object({ brandName: z.string(), brandAliases: z.array(z.string()), competitors: z.array(z.string()) }).strict(),
  succeeded: z.number().int().nonnegative(), failed: z.number().int().nonnegative(), refused: z.number().int().nonnegative(),
  mentions: z.number().int().nonnegative(), citationEligible: z.number().int().nonnegative(), ownCited: z.number().int().nonnegative(),
  competitorGap: z.boolean(), citationGap: z.boolean(),
  samples: z.array(z.object({
    resultId: resourceIdSchema.nullable(), provider: z.string(), model: z.string(), response: z.string(),
    status: z.string(), citations: z.array(z.object({ url: z.string(), kind: z.string(), category: z.string() }).strict()),
  }).strict()),
}).strict();
export type OpportunityEvidence = z.infer<typeof opportunityEvidenceSchema>;
export interface Opportunity {
  id: number; projectId: number; question: string; questionKey: string;
  kind: typeof opportunityKinds[number]; status: typeof opportunityStatus[number]; notes: string;
  evidence: OpportunityEvidence; followupEvidence: OpportunityEvidence | null; questionId: number | null; strategyId: number | null;
  baselineRunId: number | null; followupRunId: number | null; appliedUrl: string; appliedAt: string;
  createdAt: string; updatedAt: string;
}
export interface OpportunityRow {
  id: number; project_id: number; question: string; question_key: string; kind: Opportunity["kind"]; status: Opportunity["status"];
  notes: string; evidence: string; followup_evidence: string; question_id: number | null; strategy_id: number | null; baseline_run_id: number | null;
  followup_run_id: number | null; applied_url: string; applied_at: string; created_at: string; updated_at: string;
}
interface ResultRow { id: number; run_id: number; question_text: string; provider: string; model: string; response: string; slot_status: string; citation_supported: number | null; measured_at: string }
function db() { return getDatabase().sqlite; }
export function opportunityResource(row: OpportunityRow): Opportunity {
  return { id: row.id, projectId: row.project_id, question: row.question, questionKey: row.question_key, kind: row.kind, status: row.status,
    notes: row.notes, evidence: opportunityEvidenceSchema.parse(JSON.parse(row.evidence)), followupEvidence: opportunityEvidenceSchema.nullable().parse(JSON.parse(row.followup_evidence)), questionId: row.question_id, strategyId: row.strategy_id,
    baselineRunId: row.baseline_run_id, followupRunId: row.followup_run_id, appliedUrl: row.applied_url, appliedAt: row.applied_at,
    createdAt: row.created_at, updatedAt: row.updated_at };
}
function owned(id: unknown) {
  requireHalo(); const project = requireActiveProject();
  return expectFound(db().prepare("SELECT * FROM opportunities WHERE id = ? AND project_id = ?").get(resourceIdSchema.parse(id), project.id) as OpportunityRow | undefined,
    "현재 프로젝트에서 기회를 찾을 수 없습니다.", "OPPORTUNITY_NOT_FOUND");
}
function results(projectId: number, runId?: number) {
  return db().prepare(`SELECT r.*, COALESCE(m.completed_at, m.created_at) AS measured_at FROM measure_results r JOIN measure_runs m ON m.id = r.run_id
    WHERE m.project_id = ? AND m.status = 'completed' AND r.provider IN ('openai','anthropic','gemini','grok') ${runId ? "AND m.id = ?" : ""}
    ORDER BY julianday(COALESCE(m.completed_at, m.created_at)) DESC, m.id DESC, r.id`).all(...(runId ? [projectId, runId] : [projectId])) as ResultRow[];
}
function evidence(rows: ResultRow[], brand: Pick<ProjectResource, "brandName" | "brandAliases" | "competitors">): OpportunityEvidence {
  const matcher = monitoringMatcher(brand);
  const value: OpportunityEvidence = { capturedAt: new Date().toISOString(), measuredAt: rows[0]?.measured_at ?? null, brand,
    succeeded: 0, failed: 0, refused: 0, mentions: 0, citationEligible: 0, ownCited: 0, competitorGap: false, citationGap: false, samples: [] };
  for (const row of rows) {
    const citations = db().prepare("SELECT url, kind, category FROM measure_citations WHERE result_id = ? ORDER BY id").all(row.id) as OpportunityEvidence["samples"][number]["citations"];
    value.samples.push({ resultId: row.id, provider: row.provider, model: row.model, response: row.response, status: row.slot_status, citations });
    if (row.slot_status === "failed") { value.failed++; continue; }
    if (row.slot_status === "refused") { value.refused++; continue; }
    if (row.slot_status !== "succeeded") continue;
    value.succeeded++;
    const positions = matcher.match(row.response).firstPositions, own = positions.has("own");
    if (own) value.mentions++;
    if (!own && [...positions.keys()].some(key => key !== "own")) value.competitorGap = true;
    if (row.citation_supported === 1) {
      value.citationEligible++;
      const cited = citations.filter(citation => citation.kind === "cited"), ownCited = cited.some(citation => citation.category === "own");
      if (ownCited) value.ownCited++;
      if (!ownCited && cited.some(citation => citation.category !== "own")) value.citationGap = true;
    }
  }
  return value;
}
function decision(id: number, action: string, notes = "") {
  db().prepare("INSERT INTO opportunity_decisions (opportunity_id, action, notes, created_at) VALUES (?, ?, ?, ?)").run(id, action, notes, nextHaloTime());
}
export function listOpportunities() {
  requireHalo();
  return (db().prepare("SELECT * FROM opportunities WHERE project_id = ? ORDER BY updated_at DESC, id DESC").all(requireActiveProject().id) as OpportunityRow[]).map(opportunityResource);
}
function sourceMissing(projectId: number, runId: number | null, snapshot: OpportunityEvidence) {
  if (snapshot.measuredAt !== null && runId === null || snapshot.samples.some(sample => sample.resultId === null)) return true;
  const existing = new Set((db().prepare(`SELECT r.id FROM measure_results r JOIN measure_runs m ON m.id = r.run_id
    WHERE m.project_id = ? AND m.id = ?`).all(projectId, runId) as { id: number }[]).map(row => row.id));
  return snapshot.samples.some(sample => !existing.has(sample.resultId!));
}
export function getOpportunity(id: unknown) {
  const item = opportunityResource(owned(id));
  const followupRows = item.followupRunId ? results(item.projectId, item.followupRunId).filter(row => normalizeOpportunityQuestion(row.question_text) === item.questionKey) : [];
  const followup = item.followupEvidence ?? (item.followupRunId ? evidence(followupRows, item.evidence.brand) : null);
  const baselineMissing = sourceMissing(item.projectId, item.baselineRunId, item.evidence);
  const followupMissing = !!followup && sourceMissing(item.projectId, item.followupRunId, followup);
  const conditions = item.baselineRunId && item.followupRunId ? compareMonitoringRuns(db(), item.projectId, item.baselineRunId, item.followupRunId) : null;
  const comparison = conditions && (baselineMissing || followupMissing) ? { comparable: false, differences: [...conditions.differences, "보존한 측정 근거의 원본 일부가 삭제되었습니다."] } : conditions;
  const delta = (before: number, beforeN: number, after: number, afterN: number) => comparison?.comparable && beforeN > 0 && afterN > 0 ? Math.round((after / afterN - before / beforeN) * 1000) / 10 : null;
  return { ...item, followup, comparison: comparison ? { ...comparison,
    mentionDelta: followup ? delta(item.evidence.mentions, item.evidence.succeeded, followup.mentions, followup.succeeded) : null,
    citationDelta: followup ? delta(item.evidence.ownCited, item.evidence.citationEligible, followup.ownCited, followup.citationEligible) : null,
  } : null,
    sourceMissing: baselineMissing,
    followupSourceMissing: followupMissing,
    decisions: db().prepare("SELECT id, action, notes, created_at AS createdAt FROM opportunity_decisions WHERE opportunity_id = ? ORDER BY id").all(item.id) as { id: number; action: string; notes: string; createdAt: string }[],
    contents: db().prepare("SELECT c.id, c.title, c.status FROM contents c JOIN opportunity_contents o ON o.content_id = c.id WHERE o.opportunity_id = ? AND c.project_id = ? ORDER BY c.id DESC").all(item.id, item.projectId) as { id: number; title: string; status: string }[],
  };
}
export function refreshOpportunities() {
  requireHalo();
  return db().transaction(() => {
    const project = requireActiveProject(), grouped = new Map<string, ResultRow[]>();
    const brand = { brandName: project.brandName, brandAliases: project.brandAliases, competitors: project.competitors };
    for (const row of results(project.id)) {
      const key = normalizeOpportunityQuestion(row.question_text), group = grouped.get(key);
      if (!group) grouped.set(key, [row]); else if (group[0].run_id === row.run_id) group.push(row);
    }
    const registered = db().prepare("SELECT q.id, q.text FROM questions q JOIN question_sets s ON s.id = q.question_set_id WHERE s.project_id = ? ORDER BY q.id").all(project.id) as { id: number; text: string }[];
    for (const row of registered) if (!grouped.has(normalizeOpportunityQuestion(row.text))) grouped.set(normalizeOpportunityQuestion(row.text), []);
    let created = 0, updated = 0;
    for (const [key, rows] of grouped) {
      const ev = evidence(rows, brand), registration = registered.find(row => normalizeOpportunityQuestion(row.text) === key);
      const kinds: Opportunity["kind"][] = [];
      if (!ev.succeeded && registration) kinds.push("unmeasured");
      if (ev.competitorGap) kinds.push("competitor_gap");
      if (ev.citationGap) kinds.push("citation_gap");
      for (const kind of kinds) {
        const old = db().prepare("SELECT * FROM opportunities WHERE project_id = ? AND question_key = ? AND kind = ?").get(project.id, key, kind) as OpportunityRow | undefined;
        if (old && old.status !== "pending") continue; // Accepted baselines and dismissed decisions stay frozen.
        if (old && sourceMissing(project.id, old.baseline_run_id, opportunityResource(old).evidence)) continue;
        const now = nextHaloTime(old?.updated_at), text = rows[0]?.question_text ?? registration!.text;
        if (old) {
          db().prepare("UPDATE opportunities SET evidence = ?, baseline_run_id = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(ev), rows[0]?.run_id ?? null, now, old.id);
          updated++;
        } else {
          const inserted = db().prepare(`INSERT INTO opportunities (project_id, question, question_key, kind, evidence, question_id, baseline_run_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(project.id, text, key, kind, JSON.stringify(ev), registration?.id ?? null, rows[0]?.run_id ?? null, now, now);
          decision(Number(inserted.lastInsertRowid), "created"); created++;
        }
      }
    }
    return { created, updated, items: listOpportunities() };
  })();
}
export function createOpportunity(input: unknown) {
  requireHalo();
  const parsed = z.object({ question: z.string().trim().min(5).max(500), notes: z.string().max(5000).default("") }).strict().parse(input);
  const project = requireActiveProject(), key = normalizeOpportunityQuestion(parsed.question);
  return db().transaction(() => {
    const old = db().prepare("SELECT * FROM opportunities WHERE project_id = ? AND question_key = ? AND kind = 'unmeasured'").get(project.id, key) as OpportunityRow | undefined;
    if (old) return opportunityResource(old);
    const now = nextHaloTime(), ev = evidence([], { brandName: project.brandName, brandAliases: project.brandAliases, competitors: project.competitors });
    const result = db().prepare("INSERT INTO opportunities (project_id, question, question_key, kind, notes, evidence, created_at, updated_at) VALUES (?, ?, ?, 'unmeasured', ?, ?, ?, ?)").run(project.id, parsed.question, key, parsed.notes, JSON.stringify(ev), now, now);
    const id = Number(result.lastInsertRowid); decision(id, "created", "직접 입력"); return opportunityResource(owned(id));
  })();
}
export function updateOpportunity(id: unknown, input: unknown) {
  const parsed = z.object({ expectedUpdatedAt: z.string().min(1), notes: z.string().max(5000).optional(), status: z.enum(["pending", "dismissed"]).optional(),
    appliedUrl: sourceUrlSchema.optional(), appliedAt: z.string().refine(v => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v).optional(),
    followupRunId: resourceIdSchema.nullable().optional(),
  }).strict().parse(input);
  return db().transaction(() => {
    const row = owned(id); assertExpectedUpdatedAt(row.updated_at, parsed.expectedUpdatedAt);
    if (parsed.status && row.status === "accepted") throw new AppError("채택 이력은 보존됩니다. 새 기회를 등록하세요.", 409, "OPPORTUNITY_ALREADY_ACCEPTED");
    if ((parsed.appliedUrl || parsed.appliedAt || parsed.followupRunId) && row.status !== "accepted") throw new AppError("채택한 기회에 반영·재측정 기록을 연결할 수 있습니다.", 409, "OPPORTUNITY_NOT_ACCEPTED");
    const url = parsed.appliedUrl ?? row.applied_url, date = parsed.appliedAt ?? row.applied_at;
    if (!!url !== !!date) throw new AppError("반영 URL과 날짜를 함께 입력하세요.", 422, "APPLICATION_FIELDS_REQUIRED");
    let followupEvidence = parsed.followupRunId === null ? null : opportunityResource(row).followupEvidence;
    if (parsed.followupRunId && (parsed.followupRunId !== row.followup_run_id || !followupEvidence)) {
      const found = results(row.project_id, parsed.followupRunId).filter(result => normalizeOpportunityQuestion(result.question_text) === row.question_key);
      const baseline = opportunityResource(row).evidence.measuredAt;
      if (!found.length || parsed.followupRunId === row.baseline_run_id || baseline && Date.parse(found[0].measured_at) <= Date.parse(baseline)) throw new AppError("같은 질문이 포함된 이후의 완료 실행을 선택하세요.", 422, "INVALID_FOLLOWUP");
      followupEvidence = evidence(found, opportunityResource(row).evidence.brand);
    }
    db().prepare("UPDATE opportunities SET notes = ?, status = ?, applied_url = ?, applied_at = ?, followup_run_id = ?, followup_evidence = ?, updated_at = ? WHERE id = ?").run(parsed.notes ?? row.notes, parsed.status ?? row.status, url, date, parsed.followupRunId === undefined ? row.followup_run_id : parsed.followupRunId, JSON.stringify(followupEvidence), nextHaloTime(row.updated_at), row.id);
    const changes = [parsed.appliedUrl === undefined ? "" : `반영 URL: ${url || "해제"}`, parsed.appliedAt === undefined ? "" : `반영일: ${date || "해제"}`,
      parsed.followupRunId === undefined ? "" : `후속 측정: ${parsed.followupRunId ? `#${parsed.followupRunId}` : "해제"}`].filter(Boolean);
    decision(row.id, parsed.status ?? "updated", parsed.notes ?? (changes.join(" / ") || "기록 수정"));
    return getOpportunity(row.id);
  })();
}
export function adoptOpportunity(id: unknown, input: unknown) {
  const parsed = z.object({ expectedUpdatedAt: z.string().min(1), questionSetId: resourceIdSchema.optional() }).strict().parse(input);
  return db().transaction(() => {
    const row = owned(id);
    if (row.status === "accepted") return getOpportunity(row.id);
    assertExpectedUpdatedAt(row.updated_at, parsed.expectedUpdatedAt);
    if (row.status !== "pending") throw new AppError("보류를 해제한 뒤 채택하세요.", 409, "OPPORTUNITY_DISMISSED");
    let questionId = row.question_id;
    if (!questionId) {
      const questions = db().prepare("SELECT q.id, q.text FROM questions q JOIN question_sets s ON s.id = q.question_set_id WHERE s.project_id = ? ORDER BY q.id").all(row.project_id) as { id: number; text: string }[];
      questionId = questions.find(q => normalizeOpportunityQuestion(q.text) === row.question_key)?.id ?? null;
    }
    if (!questionId) {
      if (!parsed.questionSetId) throw new AppError("질문을 등록할 세트를 선택하세요.", 422, "QUESTION_SET_REQUIRED");
      questionId = createQuestion(parsed.questionSetId, { text: row.question, source: "기회 발굴" }).id;
    }
    const strategy = createStrategyItem({ type: "question", title: row.question, data: { source: "기회 발굴" } });
    db().prepare("UPDATE opportunities SET status = 'accepted', question_id = ?, strategy_id = ?, updated_at = ? WHERE id = ?").run(questionId, strategy.id, nextHaloTime(row.updated_at), row.id);
    decision(row.id, "accepted"); return getOpportunity(row.id);
  })();
}
export function deleteOpportunity(id: unknown, input: unknown) {
  const parsed = expectedSchema.parse(input);
  return db().transaction(() => { const row = owned(id); assertExpectedUpdatedAt(row.updated_at, parsed.expectedUpdatedAt); db().prepare("DELETE FROM opportunities WHERE id = ?").run(row.id); return { deleted: true }; })();
}
