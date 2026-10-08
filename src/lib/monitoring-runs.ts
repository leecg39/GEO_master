import type Database from "better-sqlite3";
import { AppError } from "./errors";
import { monitoringQuestionKey } from "./monitoring-matching";
import { MONITORING_PROVIDERS, type MonitoringCondition, type MonitoringConditionComparison, type MonitoringData, type MonitoringRun } from "./monitoring-types";

export const monitoringProviderIds = MONITORING_PROVIDERS.map((provider) => provider.id);
export const monitoringProviderSql = monitoringProviderIds.map(() => "?").join(",");
export const monitoringRunTimeSql = "julianday(COALESCE(m.completed_at, m.created_at))";
export function requestedSearchMode(summary: string): "off" | "web" | null {
  try { const value = JSON.parse(summary)?.searchMode; return value === "web" || value === "off" ? value : null; } catch { return null; }
}
interface RunRow extends MonitoringRun { summary: string }
interface ConditionRow {
  runId: number; question: string; provider: string; model: string; returnedModel: string | null;
  repetition: number; searchMode: string; metricVersion: string;
}
const sorted = (values: string[]) => [...new Set(values)].sort();
function conditions(run: RunRow, rows: ConditionRow[]): MonitoringCondition {
  const requested = requestedSearchMode(run.summary);
  const slots = rows.map((row) => JSON.stringify([row.question, row.provider, row.model, row.returnedModel, row.searchMode, row.repetition])).sort();
  const known = rows.length > 0 && requested !== null && rows.every((row) => row.model && row.metricVersion !== "legacy" && ["off", "web"].includes(row.searchMode));
  const questions = sorted(rows.map((row) => monitoringQuestionKey(row.question)));
  return {
    known, signature: known ? monitoringQuestionKey(JSON.stringify([requested, slots])) : null,
    questionCount: questions.length, questions,
    models: sorted(rows.map((row) => `${row.provider}: ${row.model}${row.returnedModel ? ` → ${row.returnedModel}` : ""}`)),
    searchModes: sorted(rows.map((row) => `${row.provider}: ${row.searchMode}`)),
    repetitions: sorted(rows.map((row) => JSON.stringify([monitoringQuestionKey(row.question), row.provider, row.repetition]))),
    requestedSearchMode: requested,
  };
}
function differences(a: MonitoringCondition | null, b: MonitoringCondition | null) {
  if (!a || !b) return [];
  const result: string[] = [];
  if (!a.known || !b.known) result.push("일부 실행의 측정 조건 기록이 부족합니다.");
  if (JSON.stringify(a.questions) !== JSON.stringify(b.questions)) result.push("질문 구성이 다릅니다.");
  if (JSON.stringify(a.models) !== JSON.stringify(b.models)) result.push("서비스 또는 모델 버전이 다릅니다.");
  if (a.requestedSearchMode !== b.requestedSearchMode || JSON.stringify(a.searchModes) !== JSON.stringify(b.searchModes)) result.push("검색 요청 또는 적용 조건이 다릅니다.");
  if (JSON.stringify(a.repetitions) !== JSON.stringify(b.repetitions)) result.push("질문별 서비스·반복 구성이 다릅니다.");
  if (a.known && b.known && a.signature !== b.signature && !result.length) result.push("질문별 모델·검색·반복 조합이 다릅니다.");
  return result;
}
/** Condition filtering is shared by aggregate, CSV and response evidence queries. */
export function monitoringRuns(sqlite: Database.Database, projectId: number, range: MonitoringData["range"], mode: "all" | "same") {
  const params = [projectId, `${range.start}T00:00:00+09:00`, `${range.end}T00:00:00+09:00`];
  const scope = `m.project_id = ? AND m.status = 'completed' AND ${monitoringRunTimeSql} >= julianday(?) AND ${monitoringRunTimeSql} < julianday(?) + 1`;
  const candidates = sqlite.prepare(`SELECT m.id, m.summary, strftime('%Y-%m-%dT%H:%M:%fZ', COALESCE(m.completed_at, m.created_at)) AS at
    FROM measure_runs m WHERE ${scope}
      AND (NOT EXISTS (SELECT 1 FROM measure_results r WHERE r.run_id = m.id)
        OR EXISTS (SELECT 1 FROM measure_results r WHERE r.run_id = m.id AND r.provider IN (${monitoringProviderSql})))
    ORDER BY ${monitoringRunTimeSql}, m.id`).all(...params, ...monitoringProviderIds) as RunRow[];
  const grouped = new Map<number, ConditionRow[]>();
  const rows = sqlite.prepare(`SELECT r.run_id AS runId, r.question_text AS question, r.provider, r.model,
    r.returned_model AS returnedModel, r.repetition, r.search_mode AS searchMode, r.metric_version AS metricVersion
    FROM measure_results r JOIN measure_runs m ON m.id = r.run_id WHERE ${scope} AND r.provider IN (${monitoringProviderSql})`).iterate(...params, ...monitoringProviderIds);
  for (const raw of rows) { const row = raw as ConditionRow; const group = grouped.get(row.runId) ?? []; group.push(row); grouped.set(row.runId, group); }
  const byRun = new Map(candidates.map((run) => [run.id, conditions(run, grouped.get(run.id) ?? [])]));
  const reference = candidates.at(-1) ?? null;
  const current = reference ? byRun.get(reference.id)! : null;
  if (mode === "same" && reference && !current?.known) throw new AppError("최근 실행의 조건 기록이 부족해 동일 조건으로 비교할 수 없습니다. 전체 조건으로 조회해 주세요.", 422, "MONITORING_CONDITIONS_UNKNOWN");
  const runs = candidates.filter((run) => mode === "all" || byRun.get(run.id)?.signature === current?.signature).map(({ id, at }) => ({ id, at }));
  const baseline = runs.length > 1 ? byRun.get(runs[0].id)! : null;
  const comparison: MonitoringConditionComparison = {
    mode, referenceRun: reference ? { id: reference.id, at: reference.at } : null, baseline, current,
    differences: differences(baseline, current), excludedRuns: candidates.length - runs.length,
  };
  if (mode === "all" && candidates.some((run) => !byRun.get(run.id)?.known || byRun.get(run.id)?.signature !== current?.signature)) {
    comparison.differences.push("기간 중 최근 실행과 조건이 다르거나 조건을 확인할 수 없는 실행이 포함되어 있습니다.");
  }
  return { runs, comparison };
}
