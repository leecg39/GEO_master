/**
 * 진단 규칙별 공식 문서 링크 (RankSEO REA G5).
 * - 규칙의 권고가 어디에 근거하는지 사용자가 직접 확인할 수 있게 한다
 * - 링크는 허용된 문서 사이트의 https 주소만 쓴다. 2026-10-13에 모두 HTTP 200을 확인했다
 * - GEO 가설 규칙은 공식 기준이 없으므로 가장 가까운 일반 원칙 문서를 연결하고, 그 사실을 note로 밝힌다
 * - 직접 확인(manual) 규칙은 링크를 두지 않는다
 */
export interface RuleDoc {
  url: string;
  /** 문서 출처 이름 */
  source: string;
  /** 문서와 규칙 사이의 주의점 (선택) */
  note?: string;
}

export const RULE_DOC_HOSTS = [
  "developers.google.com",
  "developer.mozilla.org",
  "developers.openai.com",
  "ogp.me",
  "schema.org",
  "llmstxt.org",
] as const;

const G = "https://developers.google.com/search/docs";
const MDN = "https://developer.mozilla.org/en-US/docs/Web/HTML/Reference";
const GOOGLE = "Google 검색 센터";
const HELPFUL: RuleDoc = {
  url: `${G}/fundamentals/creating-helpful-content`,
  source: GOOGLE,
  note: "GEO 가설 항목입니다. 공식 기준이 아니라 가장 가까운 일반 원칙 문서입니다.",
};
const TRUST: RuleDoc = { url: `${G}/fundamentals/creating-helpful-content`, source: GOOGLE };
const TITLE: RuleDoc = { url: `${G}/appearance/title-link`, source: GOOGLE };
const SNIPPET: RuleDoc = { url: `${G}/appearance/snippet`, source: GOOGLE };
const CANONICAL: RuleDoc = { url: `${G}/crawling-indexing/consolidate-duplicate-urls`, source: GOOGLE };
const NOINDEX: RuleDoc = { url: `${G}/crawling-indexing/block-indexing`, source: GOOGLE };
const STRUCTURED: RuleDoc = { url: `${G}/appearance/structured-data/intro-structured-data`, source: GOOGLE };

export const RULE_DOCS: Readonly<Record<string, RuleDoc>> = Object.freeze({
  // 진단기(audit.ts) 규칙
  "seo-title-meta": TITLE,
  "seo-headings": { url: `${MDN}/Elements/Heading_Elements`, source: "MDN" },
  "seo-canonical": CANONICAL,
  "seo-og": { url: "https://ogp.me/", source: "Open Graph protocol" },
  "seo-internal-links": { url: `${G}/crawling-indexing/links-crawlable`, source: GOOGLE },
  "seo-image-alt": { url: `${G}/appearance/google-images`, source: GOOGLE },
  "seo-indexable": NOINDEX,
  "geo-question-headings": HELPFUL,
  "geo-lists": HELPFUL,
  "geo-tables": HELPFUL,
  "geo-faq": HELPFUL,
  "geo-answer-first": HELPFUL,
  "trust-author": TRUST,
  "trust-citations": TRUST,
  "trust-numbers": TRUST,
  "trust-published": { url: `${G}/appearance/publication-dates`, source: GOOGLE },
  "trust-updated": { url: `${G}/appearance/publication-dates`, source: GOOGLE },
  "trust-transparency": TRUST,
  "tech-jsonld": STRUCTURED,
  "tech-faq-schema": {
    url: "https://developers.google.com/search/updates#removing-faq-rich-result",
    source: GOOGLE,
    note: "Google 검색은 2026년 5월부터 FAQ 리치 결과를 표시하지 않습니다. 이 항목은 다른 AI 서비스용 GEO 가설로만 보세요.",
  },
  "tech-entity-schema": { url: `${G}/appearance/structured-data/organization`, source: GOOGLE },
  "tech-ai-robots": {
    url: "https://developers.openai.com/api/docs/bots",
    source: "OpenAI",
    note: "OpenAI 크롤러 문서입니다. Anthropic·Perplexity·Google 크롤러는 각 회사 문서를 확인하세요.",
  },
  "tech-llms": {
    url: "https://llmstxt.org/",
    source: "llms.txt 제안",
    note: "Google 검색은 llms.txt를 쓰지 않는다고 밝혔습니다(2026년 6월). 다른 AI 서비스용입니다.",
  },
  "tech-sitemap": { url: `${G}/crawling-indexing/sitemaps/overview`, source: GOOGLE },
  "brand-entity-ids": { url: "https://schema.org/sameAs", source: "Schema.org" },
  // 페이지 스냅샷(page-snapshots.ts) 규칙
  "http-status": { url: "https://developers.google.com/crawling/docs/troubleshooting/http-status-codes", source: GOOGLE },
  "title-present": TITLE,
  "jsonld-parse": STRUCTURED,
  "canonical-host": CANONICAL,
  "robots-noindex": NOINDEX,
  "description-present": SNIPPET,
  "lang-present": { url: `${MDN}/Global_attributes/lang`, source: "MDN" },
  "title-length": { ...TITLE, note: "Google은 제목 길이 한도를 정하지 않습니다. 잘림 가능성의 추정입니다." },
  "description-length": { ...SNIPPET, note: "Google은 설명 길이 한도를 정하지 않습니다. 잘림 가능성의 추정입니다." },
  viewport: { url: `${MDN}/Elements/meta/name/viewport`, source: "MDN" },
  "https-final": { url: `${G}/appearance/page-experience`, source: GOOGLE },
  "schema-required": { url: "https://developers.google.com/search/docs/appearance/structured-data/search-gallery", source: GOOGLE, note: "필수 속성은 리치 결과 대상 자격일 뿐 노출이나 AI 인용을 보장하지 않습니다." },
  "schema-recommended": { url: "https://developers.google.com/search/docs/appearance/structured-data/search-gallery", source: GOOGLE },
  "hreflang-valid": { url: `${G}/specialty/international/localized-versions`, source: GOOGLE },
});

export function ruleDocFor(code: string): RuleDoc | null {
  return Object.hasOwn(RULE_DOCS, code) ? RULE_DOCS[code] : null;
}
