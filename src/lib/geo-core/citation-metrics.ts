/**
 * 인용 지표 (GEO_master2 PRD §5 기반).
 * - 자사 인용 커버리지 = 자사 URL이 명시 인용된 정상 답변 ÷ 인용 지원 공급자의 정상 답변 (한 답변 안 중복은 1회)
 * - 인용 미지원 공급자는 분모에서 빼고 N/A로 표시한다 (0으로 표시 금지)
 * - 분포는 "인용 횟수"이며 출처 독립성을 뜻하지 않는다
 */
import { ratio, type Ratio, type SlotStatus } from "./metrics";

export interface CitationSlot {
  provider: string;
  status: SlotStatus;
  /** null = 검색 측정이 아니었음 */
  citationSupported: boolean | null;
  brandMentioned: boolean;
  citations: Array<{ url: string; domain: string; category: string; kind: "cited" | "searched" }>;
}

export interface CitationSummary {
  ownCitationCoverage: Ratio;
  perProvider: Record<string, Ratio>;
  citedByCategory: Record<string, number>;
  searchedCount: number;
  topDomains: Array<{ domain: string; category: string; count: number }>;
  /** 브랜드가 언급되지 않은 답변에서 인용된 페이지 — "우리 대신 인용된 곳" */
  pagesCitedWithoutBrand: Array<{ url: string; domain: string; category: string; count: number }>;
}

const TOP_LIMIT = 10;

function eligible(slot: CitationSlot) {
  return slot.status === "succeeded" && slot.citationSupported === true;
}

function citesOwn(slot: CitationSlot) {
  return slot.citations.some((citation) => citation.kind === "cited" && citation.category === "own");
}

function coverage(slots: readonly CitationSlot[]) {
  const pool = slots.filter(eligible);
  return ratio(pool.filter(citesOwn).length, pool.length);
}

function topCounts<T extends { key: string }>(items: readonly T[]) {
  const counts = new Map<string, { item: T; count: number }>();
  for (const item of items) {
    const existing = counts.get(item.key);
    counts.set(item.key, { item, count: (existing?.count ?? 0) + 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, TOP_LIMIT);
}

export function summarizeCitations(slots: readonly CitationSlot[]): CitationSummary {
  const valid = slots.filter(eligible);
  const cited = valid.flatMap((slot) => slot.citations.filter((citation) => citation.kind === "cited"));
  const citedByCategory: Record<string, number> = {};
  for (const citation of cited) citedByCategory[citation.category] = (citedByCategory[citation.category] ?? 0) + 1;
  const providers = [...new Set(slots.map((slot) => slot.provider))];
  const withoutBrand = valid
    .filter((slot) => !slot.brandMentioned)
    .flatMap((slot) => slot.citations.filter((citation) => citation.kind === "cited" && citation.category !== "own"));
  return {
    ownCitationCoverage: coverage(slots),
    perProvider: Object.fromEntries(providers.map((provider) => [provider, coverage(slots.filter((slot) => slot.provider === provider))])),
    citedByCategory,
    searchedCount: valid.flatMap((slot) => slot.citations).filter((citation) => citation.kind === "searched").length,
    topDomains: topCounts(cited.map((citation) => ({ key: citation.domain, domain: citation.domain, category: citation.category })))
      .map(({ item, count }) => ({ domain: item.domain, category: item.category, count })),
    pagesCitedWithoutBrand: topCounts(withoutBrand.map((citation) => ({ key: citation.url, ...citation })))
      .map(({ item, count }) => ({ url: item.url, domain: item.domain, category: item.category, count })),
  };
}
