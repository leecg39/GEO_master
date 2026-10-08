import { buildDictionary, matchBrands } from "./geo-core";

const BRAND_ID = "brand";
const MIN_ALIAS_LENGTH = 2;

export interface MentionOptions {
  /** 브랜드 별칭 (영문명, 약칭 등) */
  aliases?: readonly string[];
  /** 공식 도메인 — 본문에 도메인만 있으면 언급이 아니라 자사 도메인 노출로 센다 */
  domain?: string;
}

export interface MatchedSpan {
  alias: string;
  start: number;
  end: number;
  /** 다른 엔티티와 겹치거나 모호로 지정된 별칭 */
  ambiguous: boolean;
}

export interface MentionAnalysis {
  brandMentioned: boolean;
  /** 엔티티 첫 등장 순서 기준 순위 (GenRank 입력) */
  mentionRank: number | null;
  competitorMentions: string[];
  /** 브랜드 언급이 다른 엔티티와 겹치는 모호 별칭으로만 잡혔는지 */
  ambiguous: boolean;
  ownDomainHit: boolean;
  matchedSpans: MatchedSpan[];
}

export function normalizeDomain(value: string) {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "";
  const host = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").split(/[/?#:]/)[0] ?? "";
  return host.replace(/^www\./, "");
}

function usableAliases(values: readonly string[]) {
  return values.map((value) => value.trim()).filter((value) => [...value].length >= MIN_ALIAS_LENGTH);
}

export function analyzeMentions(
  response: string,
  brand: string,
  competitors: readonly string[],
  options: MentionOptions = {},
): MentionAnalysis {
  const competitorNames = usableAliases(competitors);
  const domain = normalizeDomain(options.domain ?? "");
  const entities = [
    ...(brand.trim()
      ? [{
        id: BRAND_ID,
        name: brand.trim(),
        kind: "brand" as const,
        officialDomains: domain ? [domain] : [],
        aliases: usableAliases(options.aliases ?? []).map((alias) => ({ alias, ambiguous: false })),
      }]
      : []),
    ...competitorNames.map((name, index) => ({
      id: `competitor:${index}`,
      name,
      kind: "competitor" as const,
      aliases: [],
    })),
  ];
  const result = matchBrands(response, buildDictionary(entities), entities);
  const order = [...result.firstPositions.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
  const brandIndex = order.indexOf(BRAND_ID);
  const brandSpans = result.mentions.filter((mention) => mention.entityId === BRAND_ID);
  return {
    brandMentioned: brandIndex >= 0,
    mentionRank: brandIndex >= 0 ? brandIndex + 1 : null,
    competitorMentions: order
      .filter((id) => id !== BRAND_ID)
      .map((id) => competitorNames[Number(id.split(":")[1])]!),
    ambiguous: brandSpans.length > 0 && brandSpans.every((mention) => mention.ambiguous),
    ownDomainHit: result.domainHits.some((hit) => hit.entityId === BRAND_ID),
    matchedSpans: brandSpans.map((mention) => ({ alias: mention.matchedAlias, start: mention.start, end: mention.end, ambiguous: mention.ambiguous })),
  };
}
