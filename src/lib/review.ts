/**
 * 검수함 — 자동 판정을 사람이 확정한다 (leecg39/GEO_master2 FEAT-3 검수 모드).
 * - 전수(all): 검수되지 않은 정상 답변 전부
 * - 예외(exceptions): 모호 별칭으로만 잡힌 언급 + 충돌·검토 필요 주장이 있는 답변만
 * 사람 라벨은 언급 판정을 덮어쓰고 실행 요약을 다시 계산하며, 자동 식별의 정밀도·재현율 근거가 된다.
 */
import { z } from "zod";
import { resourceIdSchema } from "./crud";
import { getDatabase } from "./db";
import { AppError } from "./errors";
import { computePrecisionRecall, EXCEPTION_THRESHOLDS, exceptionModeEligible } from "./geo-core";
import { requireActiveProject } from "./projects";
import { recomputeRunSummary } from "./run-summary";

const QUEUE_LIMIT = 50;
const RESPONSE_PREVIEW = 4_000;
const REVIEWABLE_VERDICTS = ["conflict", "needs_review"];

export const reviewQueueSchema = z.object({
  mode: z.enum(["all", "exceptions"]).optional().default("exceptions"),
  runId: resourceIdSchema.optional(),
}).strict();

export const mentionReviewSchema = z.object({ resultId: resourceIdSchema, brandMentioned: z.boolean() }).strict();
export const claimReviewSchema = z.object({
  claimId: resourceIdSchema,
  verdict: z.enum(["match", "conflict", "insufficient", "time_unknown", "needs_review"]),
}).strict();

interface QueueRow {
  id: number; run_id: number; question_text: string; provider: string; response: string;
  brand_mentioned: number; matched_spans: string | null;
}
interface ClaimRow { id: number; result_id: number; claim_text: string; attribute: string; value: string; unit: string | null; verdict: string }

function ambiguousOnly(spansJson: string | null) {
  try {
    const spans = JSON.parse(spansJson ?? "[]") as Array<{ ambiguous?: boolean }>;
    return spans.length > 0 && spans.every((span) => span.ambiguous === true);
  } catch {
    return false;
  }
}

function spans(spansJson: string | null) {
  try {
    return JSON.parse(spansJson ?? "[]") as Array<{ alias: string; start: number; end: number; ambiguous?: boolean }>;
  } catch {
    return [];
  }
}

export function getReviewQueue(input: unknown = {}) {
  const { mode, runId } = reviewQueueSchema.parse(input);
  const active = requireActiveProject();
  const { sqlite } = getDatabase();
  const rows = sqlite.prepare(`
    SELECT r.id, r.run_id, r.question_text, r.provider, r.response, r.brand_mentioned, r.matched_spans
    FROM measure_results r
    JOIN measure_runs m ON m.id = r.run_id
    LEFT JOIN mention_reviews v ON v.result_id = r.id
    WHERE m.project_id = ? AND m.status = 'completed' AND COALESCE(r.slot_status, 'succeeded') = 'succeeded'
      AND v.result_id IS NULL ${runId ? "AND r.run_id = ?" : ""}
    ORDER BY r.run_id DESC, r.id
  `).all(...(runId ? [active.id, runId] : [active.id])) as QueueRow[];
  const claimRows = sqlite.prepare(`
    SELECT c.id, c.result_id, c.claim_text, c.attribute, c.value, c.unit, c.verdict FROM measure_claims c
    JOIN measure_runs m ON m.id = c.run_id
    WHERE m.project_id = ? AND c.reviewed = 0 AND c.verdict IN (${REVIEWABLE_VERDICTS.map(() => "?").join(",")})
  `).all(active.id, ...REVIEWABLE_VERDICTS) as ClaimRow[];

  const items = rows.map((row) => {
    const claims = claimRows.filter((claim) => claim.result_id === row.id);
    const reasons = [
      ...(row.brand_mentioned && ambiguousOnly(row.matched_spans) ? ["ambiguous"] : []),
      ...(claims.length ? ["claim"] : []),
    ];
    return {
      resultId: row.id,
      runId: row.run_id,
      question: row.question_text,
      provider: row.provider,
      response: row.response.slice(0, RESPONSE_PREVIEW),
      brandMentioned: Boolean(row.brand_mentioned),
      matchedSpans: spans(row.matched_spans),
      reasons,
      claims: claims.map((claim) => ({ id: claim.id, claimText: claim.claim_text, attribute: claim.attribute, value: claim.value, unit: claim.unit, verdict: claim.verdict })),
    };
  }).filter((item) => mode === "all" || item.reasons.length > 0);
  return { mode, total: items.length, items: items.slice(0, QUEUE_LIMIT) };
}

function ownedResult(resultId: number) {
  const row = getDatabase().sqlite.prepare(`
    SELECT r.id, r.run_id, r.brand_mentioned, r.slot_status, m.project_id FROM measure_results r JOIN measure_runs m ON m.id = r.run_id WHERE r.id = ?
  `).get(resultId) as { id: number; run_id: number; brand_mentioned: number; slot_status: string | null; project_id: number | null } | undefined;
  if (!row) throw new AppError("측정 결과를 찾을 수 없습니다.", 404, "MEASURE_RESULT_NOT_FOUND");
  requireActiveProject(row.project_id);
  // 거절·실패 슬롯은 답변이 없어 판정 대상이 아니다 (정밀도·재현율 표본을 오염시킨다)
  if ((row.slot_status ?? "succeeded") !== "succeeded") {
    throw new AppError("정상 답변만 검수할 수 있습니다.", 409, "RESULT_NOT_REVIEWABLE");
  }
  return row;
}

export function reviewMention(input: unknown) {
  const { resultId, brandMentioned } = mentionReviewSchema.parse(input);
  const row = ownedResult(resultId);
  const { sqlite } = getDatabase();
  sqlite.transaction(() => {
    const existing = sqlite.prepare("SELECT auto_mentioned FROM mention_reviews WHERE result_id = ?").get(resultId) as { auto_mentioned: number } | undefined;
    const autoMentioned = existing ? existing.auto_mentioned : row.brand_mentioned;
    sqlite.prepare(`
      INSERT INTO mention_reviews (result_id, run_id, auto_mentioned, human_mentioned, reviewed_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(result_id) DO UPDATE SET human_mentioned = excluded.human_mentioned, reviewed_at = excluded.reviewed_at
    `).run(resultId, row.run_id, autoMentioned, brandMentioned ? 1 : 0, new Date().toISOString());
    if (Boolean(row.brand_mentioned) !== brandMentioned) {
      sqlite.prepare("UPDATE measure_results SET brand_mentioned = ?, mention_rank = CASE WHEN ? = 0 THEN NULL ELSE mention_rank END WHERE id = ?")
        .run(brandMentioned ? 1 : 0, brandMentioned ? 1 : 0, resultId);
    }
    const adjusted = (sqlite.prepare("SELECT COUNT(*) AS count FROM mention_reviews WHERE run_id = ? AND auto_mentioned <> human_mentioned").get(row.run_id) as { count: number }).count;
    recomputeRunSummary(row.run_id, { reviewAdjusted: adjusted });
  })();
  return { resultId, brandMentioned };
}

export function reviewClaim(input: unknown) {
  const { claimId, verdict } = claimReviewSchema.parse(input);
  const { sqlite } = getDatabase();
  const claim = sqlite.prepare(`
    SELECT c.id, c.verdict, c.original_verdict, m.project_id FROM measure_claims c JOIN measure_runs m ON m.id = c.run_id WHERE c.id = ?
  `).get(claimId) as { id: number; verdict: string; original_verdict: string | null; project_id: number | null } | undefined;
  if (!claim) throw new AppError("주장을 찾을 수 없습니다.", 404, "CLAIM_NOT_FOUND");
  requireActiveProject(claim.project_id);
  sqlite.prepare("UPDATE measure_claims SET verdict = ?, original_verdict = COALESCE(original_verdict, ?), reviewed = 1 WHERE id = ?")
    .run(verdict, claim.verdict, claimId);
  return { claimId, verdict };
}

/** 사람 라벨 대비 자동 언급 식별 품질 — 예외 검수 모드 전환 근거 */
export function getReviewQuality() {
  const active = requireActiveProject();
  const labels = getDatabase().sqlite.prepare(`
    SELECT v.result_id, v.auto_mentioned, v.human_mentioned FROM mention_reviews v
    JOIN measure_runs m ON m.id = v.run_id WHERE m.project_id = ?
  `).all(active.id) as { result_id: number; auto_mentioned: number; human_mentioned: number }[];
  const metrics = computePrecisionRecall(
    labels.map((label) => ({ responseId: String(label.result_id), entityId: "brand", goldMentioned: Boolean(label.human_mentioned) })),
    labels.filter((label) => label.auto_mentioned).map((label) => ({ responseId: String(label.result_id), entityId: "brand" })),
  );
  return { ...metrics, thresholds: EXCEPTION_THRESHOLDS, exceptionModeEligible: exceptionModeEligible(metrics) };
}
