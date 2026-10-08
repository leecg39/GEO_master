import { z } from "zod";
import { getDatabase } from "./db";
import { AppError } from "./errors";
import { requireActiveProject } from "./projects";
import { monitoringMatcher, monitoringQuestionKey } from "./monitoring-matching";
import { tally, count, metric } from "./monitoring-metrics";
import { monitoringQuerySchema, monitoringRange } from "./monitoring-query";
import { monitoringProviderIds, monitoringProviderSql, monitoringRuns, requestedSearchMode } from "./monitoring-runs";
import { MONITORING_PROVIDERS, type MonitoringResponseItem, type MonitoringResponseSource, type MonitoringResponses, type MonitoringSearchMode } from "./monitoring-types";

export const monitoringResponsesQuerySchema = monitoringQuerySchema.omit({ format: true }).extend({
  question: z.string().regex(/^[a-f0-9]{64}$/),
  runId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  provider: z.enum(["openai", "anthropic", "gemini", "grok"]).optional(),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
const cursorSchema = z.object({ scope: z.string().regex(/^[a-f0-9]{64}$/), after: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict();
interface ResultRow {
  id: number; provider: MonitoringResponseItem["provider"]; model: string; returnedModel: string | null;
  repetition: number; response: string; slotStatus: MonitoringResponseItem["slotStatus"]; slotError: string | null;
  searchMode: string; searchPerformed: number | null; metricVersion: string;
}
const columns = `id, provider, model, returned_model AS returnedModel, repetition, response, slot_status AS slotStatus,
  slot_error AS slotError, search_mode AS searchMode, search_performed AS searchPerformed, metric_version AS metricVersion`;
function appliedMode(row: ResultRow, requested: "off" | "web" | null): MonitoringSearchMode {
  if (row.searchMode === "web") return "web";
  if (row.searchMode === "off" && (row.metricVersion !== "legacy" || requested !== null || row.searchPerformed !== null)) return "off";
  return "unknown";
}
function sourceUrl(value: string): string | null {
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
/** Scoped, paginated evidence. Summary metrics always include every slot, not just this page. */
export function getMonitoringResponses(input: unknown): MonitoringResponses {
  const query = monitoringResponsesQuerySchema.parse(input);
  const range = monitoringRange(query.start, query.end);
  const { sqlite } = getDatabase();
  return sqlite.transaction(() => {
    const project = requireActiveProject(query.projectId);
    const run = sqlite.prepare(`SELECT m.id, strftime('%Y-%m-%dT%H:%M:%fZ', COALESCE(m.completed_at, m.created_at)) AS at
      FROM measure_runs m WHERE m.id = ? AND m.project_id = ? AND m.status = 'completed'
        AND julianday(COALESCE(m.completed_at, m.created_at)) >= julianday(?)
        AND julianday(COALESCE(m.completed_at, m.created_at)) < julianday(?) + 1
        AND (NOT EXISTS (SELECT 1 FROM measure_results r WHERE r.run_id = m.id)
          OR EXISTS (SELECT 1 FROM measure_results r WHERE r.run_id = m.id AND r.provider IN (${monitoringProviderSql})))`)
      .get(query.runId, project.id, `${range.start}T00:00:00+09:00`, `${range.end}T00:00:00+09:00`, ...monitoringProviderIds) as { id: number; at: string } | undefined;
    if (!run || (query.comparison === "same" && !monitoringRuns(sqlite, project.id, range, query.comparison).runs.some((item) => item.id === query.runId))) {
      throw new AppError("이 프로젝트·기간·비교 조건에서 선택한 완료 실행을 찾을 수 없습니다.", 404, "MONITORING_RUN_NOT_FOUND");
    }
    const stored = sqlite.prepare("SELECT summary FROM measure_runs WHERE id = ?").get(run.id) as { summary: string };
    const requested = requestedSearchMode(stored.summary);
    const rawAnswerCount = (sqlite.prepare(`SELECT COUNT(*) AS count FROM measure_results WHERE run_id = ? AND provider IN (${monitoringProviderSql})`).get(run.id, ...monitoringProviderIds) as { count: number }).count;
    // Prefer the selected run. For an unmeasured question, resolve only within this project's history/registrations.
    const inRun = sqlite.prepare(`SELECT DISTINCT question_text AS text FROM measure_results WHERE run_id = ? AND provider IN (${monitoringProviderSql})`).all(run.id, ...monitoringProviderIds) as { text: string }[];
    let question = inRun.find((item) => monitoringQuestionKey(item.text) === query.question);
    if (!question) {
      const texts = sqlite.prepare(`SELECT q.text FROM questions q JOIN question_sets s ON s.id = q.question_set_id WHERE s.project_id = ?
        UNION SELECT r.question_text AS text FROM measure_results r JOIN measure_runs m ON m.id = r.run_id
        WHERE m.project_id = ? AND m.status = 'completed' AND r.provider IN (${monitoringProviderSql})`).iterate(project.id, project.id, ...monitoringProviderIds);
      for (const raw of texts) { const item = raw as { text: string }; if (monitoringQuestionKey(item.text) === query.question) { question = item; break; } }
    }
    if (!question) throw new AppError("이 프로젝트에서 선택한 질문을 찾을 수 없습니다.", 404, "QUESTION_NOT_FOUND");
    const scope = monitoringQuestionKey(JSON.stringify([project.id, run.id, query.question, query.provider ?? null, range.start, range.end, query.comparison]));
    let after = 0;
    if (query.cursor) {
      try {
        const cursor = cursorSchema.parse(JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8")));
        if (cursor.scope !== scope) throw new Error("scope");
        after = cursor.after;
      } catch { throw new AppError("다른 질문·실행의 페이지이거나 잘못된 커서입니다.", 422, "INVALID_MONITORING_CURSOR"); }
    }
    const matcher = monitoringMatcher(project);
    const total = tally();
    const summaries = MONITORING_PROVIDERS.map((provider) => ({
      ...provider, value: tally(), resultCount: 0,
      groups: new Map<MonitoringSearchMode, { models: Set<string>; returnedModels: Set<string>; resultCount: number }>(),
    }));
    const where = `run_id = ? AND question_text = ? AND provider IN (${monitoringProviderSql})`;
    const parameters = [run.id, question.text, ...monitoringProviderIds];
    for (const raw of sqlite.prepare(`SELECT ${columns} FROM measure_results WHERE ${where} ORDER BY id`).iterate(...parameters)) {
      const row = raw as ResultRow;
      const provider = summaries.find((item) => item.id === row.provider)!;
      const positions = row.slotStatus === "succeeded" ? matcher.match(row.response).firstPositions : new Map<string, number>();
      count(total, row.slotStatus, row.provider, positions);
      count(provider.value, row.slotStatus, row.provider, positions);
      provider.resultCount++;
      const mode = appliedMode(row, requested);
      const group = provider.groups.get(mode) ?? { models: new Set<string>(), returnedModels: new Set<string>(), resultCount: 0 };
      group.models.add(row.model);
      if (row.returnedModel) group.returnedModels.add(row.returnedModel);
      group.resultCount++;
      provider.groups.set(mode, group);
    }
    const rows = sqlite.prepare(`SELECT ${columns} FROM measure_results WHERE ${where} AND id > ? ${query.provider ? "AND provider = ?" : ""} ORDER BY id LIMIT ?`)
      .all(...parameters, after, ...(query.provider ? [query.provider] : []), query.limit + 1) as ResultRow[];
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    const sources = new Map<number, MonitoringResponseSource[]>();
    if (page.length) {
      const citations = sqlite.prepare(`SELECT id, result_id AS resultId, url, title, domain, kind, category AS storedCategory
        FROM measure_citations WHERE run_id = ? AND result_id IN (${page.map(() => "?").join(",")}) ORDER BY id`)
        .all(run.id, ...page.map((row) => row.id)) as (MonitoringResponseSource & { resultId: number })[];
      for (const { resultId, ...source } of citations) {
        const url = sourceUrl(source.url);
        if (!url || !["cited", "inline", "searched"].includes(source.kind)) continue;
        const list = sources.get(resultId) ?? []; list.push({ ...source, url }); sources.set(resultId, list);
      }
    }
    return {
      project: { id: project.id, name: project.name }, question: { key: query.question, text: question.text },
      run: { ...run, requestedSearchMode: requested, rawAnswerCount }, interpretation: "current_brand_settings" as const,
      summary: { ...metric(total), mentionedProviderCount: summaries.filter((p) => metric(p.value).mentions > 0).length, measuredProviderCount: summaries.filter((p) => p.resultCount > 0).length },
      providers: summaries.map((provider) => ({
        id: provider.id, name: provider.name, ...metric(provider.value), resultCount: provider.resultCount,
        mentionedBrands: matcher.brands.filter((brand) => provider.value.brands.has(brand.id)),
        groups: [...provider.groups].map(([searchMode, group]) => ({ searchMode, models: [...group.models].sort(), returnedModels: [...group.returnedModels].sort(), resultCount: group.resultCount })),
      })),
      items: page.map((row) => ({
        id: row.id, provider: row.provider, model: row.model, returnedModel: row.returnedModel, repetition: row.repetition,
        slotStatus: row.slotStatus, slotError: row.slotError, response: row.response,
        searchMode: appliedMode(row, requested), searchPerformed: row.searchPerformed === null ? null : Boolean(row.searchPerformed),
        mentions: row.slotStatus === "succeeded" ? matcher.match(row.response).mentions.map((mention) => ({
          brandId: mention.entityId, name: mention.entityName, own: mention.entityId === "own", start: mention.start, end: mention.end,
        })) : [], sources: sources.get(row.id) ?? [],
      })),
      page: { hasMore, nextCursor: hasMore ? Buffer.from(JSON.stringify({ scope, after: page.at(-1)!.id })).toString("base64url") : null },
    };
  })();
}
