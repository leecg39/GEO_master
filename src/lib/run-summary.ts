/**
 * 저장된 슬롯 행에서 실행 요약을 다시 계산한다 — 검수로 언급 판정이 바뀌었을 때 사용.
 * 측정 당시와 같은 산식(aggregateShare, summarizeCitations)을 쓰고, 측정 조건 필드(searchMode 등)는 유지한다.
 */
import { getDatabase } from "./db";
import { summarizeCitations, type CitationSlot, type SlotStatus } from "./geo-core";
import { getPublicSettings, type Provider } from "./settings";
import { aggregateShare, type Sentiment } from "./share";

interface ResultRow {
  id: number;
  provider: string;
  question_text: string;
  slot_status: SlotStatus | null;
  sentiment: string;
  brand_mentioned: number;
  mention_rank: number | null;
  competitor_mentions: string;
  citation_supported: number | null;
}

interface CitationRow { result_id: number; url: string; domain: string; category: string; kind: "cited" | "searched" }

function parse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function recomputeRunSummary(runId: number, extra: Record<string, unknown> = {}) {
  const { sqlite } = getDatabase();
  const run = sqlite.prepare("SELECT summary FROM measure_runs WHERE id = ?").get(runId) as { summary: string } | undefined;
  if (!run) return;
  const previous = parse<Record<string, unknown>>(run.summary, {});
  const results = sqlite.prepare(`
    SELECT id, provider, question_text, slot_status, sentiment, brand_mentioned, mention_rank, competitor_mentions, citation_supported
    FROM measure_results WHERE run_id = ? ORDER BY id
  `).all(runId) as ResultRow[];
  const settings = getPublicSettings();
  // 측정 당시 경쟁사 집합을 유지한다 — 이후 프로젝트 설정 변경이 과거 실행에 섞이지 않게
  const storedCompetitors = Array.isArray(previous.competitorComparison)
    ? (previous.competitorComparison as Array<{ name?: unknown }>).map((item) => item.name).filter((name): name is string => typeof name === "string")
    : null;
  const aggregate = aggregateShare(results.map((row) => ({
    provider: row.provider as Provider,
    question: row.question_text,
    status: row.slot_status ?? "succeeded",
    sentiment: row.sentiment as Sentiment,
    brandMentioned: Boolean(row.brand_mentioned),
    mentionRank: row.mention_rank,
    competitorMentions: parse<string[]>(row.competitor_mentions, []),
  })), storedCompetitors ?? settings.competitors, settings.modelWeights);

  let citations: unknown = previous.citations;
  if (previous.searchMode === "web") {
    const citationRows = sqlite.prepare("SELECT result_id, url, domain, category, kind FROM measure_citations WHERE run_id = ?").all(runId) as CitationRow[];
    const slots: CitationSlot[] = results.map((row) => ({
      provider: row.provider,
      status: row.slot_status ?? "succeeded",
      citationSupported: row.citation_supported === null ? null : Boolean(row.citation_supported),
      brandMentioned: Boolean(row.brand_mentioned),
      citations: citationRows.filter((citation) => citation.result_id === row.id),
    }));
    citations = summarizeCitations(slots);
  }

  const summary = { ...previous, ...aggregate, ...(citations ? { citations } : {}), ...extra };
  sqlite.prepare("UPDATE measure_runs SET answer_share = ?, genrank = ?, funnel_stage = ?, summary = ?, updated_at = ? WHERE id = ?")
    .run(aggregate.answerShare, aggregate.genrank, aggregate.funnelStage, JSON.stringify(summary), new Date().toISOString(), runId);
}
