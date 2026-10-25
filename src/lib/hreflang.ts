/**
 * hreflang 검사 (RankSEO REA G6). 기준: Google 검색 센터 "현지화된 페이지 버전" 문서.
 * - 언어 코드: ISO 639-1/639-2 언어 + 선택 ISO 15924 문자 + 선택 지역(ISO 3166-1 alpha-2 또는 UN M.49 숫자), 또는 x-default
 * - 각 언어 버전은 자기 자신과 다른 버전을 모두 나열해야 한다 (자기 참조)
 * - 주소는 프로토콜을 포함한 절대 주소여야 한다
 * - A가 B를 가리키면 B도 A를 가리켜야 한다 (상호 참조). 두 페이지를 모두 수집했을 때만 판정한다
 */
export interface HreflangLink {
  lang: string;
  /** 페이지 주소 기준으로 풀어 쓴 절대 주소 */
  href: string;
  /** 원문 href가 절대 주소였는지 */
  absolute: boolean;
}

const HREFLANG_PATTERN = /^(?:x-default|[a-z]{2,3}(?:-[a-z]{4})?(?:-(?:[a-z]{2}|\d{3}))?)$/i;

export function isValidHreflangValue(value: string) {
  return HREFLANG_PATTERN.test(value.trim());
}

function documentKey(url: string) {
  const parsed = new URL(url);
  const path = parsed.pathname.length > 1 ? parsed.pathname.replace(/\/+$/, "") : parsed.pathname;
  return `${parsed.protocol}//${parsed.host.toLowerCase()}${path}${parsed.search}`;
}

/** 프래그먼트와 경로 끝 슬래시만 무시하고 같은 문서인지 본다. 호스트(www 포함)·쿼리는 다르면 다른 문서다. */
export function sameDocumentUrl(a: string, b: string) {
  try {
    return documentKey(a) === documentKey(b);
  } catch {
    return false;
  }
}

/** 한 페이지 안에서 판정할 수 있는 문제 목록. 비어 있으면 통과. */
export function checkPageHreflang(links: readonly HreflangLink[], pageUrl: string, canonical: string | null): string[] {
  if (links.length === 0) return [];
  const problems: string[] = [];
  const invalid = links.filter((link) => !isValidHreflangValue(link.lang)).map((link) => link.lang);
  if (invalid.length) problems.push(`형식이 맞지 않는 언어 코드: ${[...new Set(invalid)].join(", ")}`);
  const relative = links.filter((link) => !link.absolute).length;
  if (relative) problems.push(`상대 주소 ${relative}개 — 프로토콜을 포함한 절대 주소로 쓰세요`);
  const byLang = new Map<string, string[]>();
  for (const link of links) {
    const key = link.lang.trim().toLowerCase();
    byLang.set(key, [...(byLang.get(key) ?? []), link.href]);
  }
  const conflicting = [...byLang].filter(([, hrefs]) => hrefs.some((href) => !sameDocumentUrl(href, hrefs[0]!))).map(([lang]) => lang);
  if (conflicting.length) problems.push(`같은 언어 코드(${conflicting.join(", ")})가 서로 다른 주소를 가리킵니다`);
  const selfReferenced = links.some((link) => sameDocumentUrl(link.href, pageUrl) || (canonical !== null && sameDocumentUrl(link.href, canonical)));
  if (!selfReferenced) problems.push("이 페이지 자기 자신을 가리키는 hreflang이 없습니다");
  return problems;
}

export interface CrawledHreflangPage {
  url: string;
  hreflang: readonly HreflangLink[];
}

/** 수집한 페이지끼리 상호 참조가 빠진 쌍. 대상 페이지를 수집하지 않았으면 판정하지 않는다. */
export function findReturnLinkGaps(pages: readonly CrawledHreflangPage[]): Array<{ from: string; to: string }> {
  const gaps: Array<{ from: string; to: string }> = [];
  for (const page of pages) {
    for (const link of page.hreflang) {
      if (sameDocumentUrl(link.href, page.url)) continue;
      const target = pages.find((candidate) => sameDocumentUrl(candidate.url, link.href));
      if (!target) continue;
      const linkedBack = target.hreflang.some((back) => sameDocumentUrl(back.href, page.url));
      if (!linkedBack && !gaps.some((gap) => gap.from === page.url && gap.to === target.url)) gaps.push({ from: page.url, to: target.url });
    }
  }
  return gaps;
}
