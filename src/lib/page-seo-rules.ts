/**
 * 페이지 스냅샷의 기본 기술 SEO 규칙 (RankSEO REA G6, page-rules/2).
 * - 경고·오류 등급은 기술 오류(technical)만 쓴다. 형식이 틀린 hreflang은 Google이 무시하므로 기술 오류로 본다
 * - 길이 규칙은 Google이 정한 한도가 아니라 검색 결과에서 잘릴 가능성의 추정이다. 그래서 '참고' 수준으로만 알린다
 * - 한글·한자·전각 문자는 라틴 문자보다 넓으므로 2칸으로 센다
 * - H1과 title이 같은 것은 Google 문서상 문제가 아니므로 규칙으로 만들지 않는다 (RankSEO는 감점)
 */
import type * as cheerio from "cheerio";
import { checkPageHreflang, type HreflangLink } from "./hreflang";
import type { FindingSeverity, FindingTier, PageFacts, PageFinding } from "./page-snapshots";

export const TITLE_MAX_WIDTH = 60;
export const DESCRIPTION_MIN_WIDTH = 50;
export const DESCRIPTION_MAX_WIDTH = 160;
export const MAX_HREFLANG_LINKS = 50;

const WIDE_CHAR = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/u;

/** 화면 표시 폭 추정: 한글·CJK·전각 2칸, 나머지 1칸 */
export function displayWidth(text: string) {
  let width = 0;
  for (const char of text) width += WIDE_CHAR.test(char) ? 2 : 1;
  return width;
}

export function extractHreflang($: cheerio.CheerioAPI, pageUrl: string): HreflangLink[] {
  const links: HreflangLink[] = [];
  $("link[rel~='alternate'][hreflang][href]").each((_, node) => {
    if (links.length >= MAX_HREFLANG_LINKS) return false;
    const lang = $(node).attr("hreflang")?.trim() ?? "";
    const raw = $(node).attr("href")?.trim() ?? "";
    try {
      links.push({ lang, href: new URL(raw, pageUrl).toString(), absolute: /^https?:\/\//i.test(raw) });
    } catch {
      // 해석할 수 없는 주소는 건너뛴다
    }
    return undefined;
  });
  return links;
}

const make = (code: string, tier: FindingTier, severity: FindingSeverity, label: string, passed: boolean, detail: string, evidence: string | null): PageFinding =>
  ({ code, tier, severity: passed ? "notice" : severity, passed, label, detail, evidence });

function lengthFindings(facts: PageFacts): PageFinding[] {
  const titleWidth = facts.title ? displayWidth(facts.title) : 0;
  const titleOk = titleWidth <= TITLE_MAX_WIDTH;
  const descWidth = facts.description ? displayWidth(facts.description) : 0;
  const descOk = !facts.description || (descWidth >= DESCRIPTION_MIN_WIDTH && descWidth <= DESCRIPTION_MAX_WIDTH);
  const descDetail = !facts.description ? "설명이 없어 길이를 판정하지 않았습니다."
    : descWidth < DESCRIPTION_MIN_WIDTH ? `설명이 짧습니다(폭 ${descWidth}). 검색 결과가 본문에서 다른 문장을 고를 수 있습니다.`
      : descWidth > DESCRIPTION_MAX_WIDTH ? `설명이 깁니다(폭 ${descWidth}). 검색 결과에서 잘릴 수 있습니다.` : `설명 폭 ${descWidth}`;
  return [
    make("title-length", "recommendation", "notice", "title 길이", titleOk,
      !facts.title ? "제목이 없어 길이를 판정하지 않았습니다." : titleOk ? `제목 폭 ${titleWidth}`
        : `제목이 깁니다(폭 ${titleWidth}, 기준 ${TITLE_MAX_WIDTH}). 검색 결과에서 잘릴 수 있습니다. 한글은 2칸으로 센 추정치입니다.`,
      facts.title),
    make("description-length", "recommendation", "notice", "meta description 길이", descOk, descDetail, facts.description),
  ];
}

export function seoFindings(facts: PageFacts, pageUrl: string): PageFinding[] {
  const viewportOk = /(^|[\s,])width\s*=\s*device-width/i.test(facts.viewport ?? "");
  const https = pageUrl.toLowerCase().startsWith("https://");
  const hreflangProblems = checkPageHreflang(facts.hreflang, pageUrl, facts.canonical);
  return [
    ...lengthFindings(facts),
    make("viewport", "recommendation", "notice", "모바일 viewport", viewportOk,
      viewportOk ? "width=device-width가 설정돼 있습니다." : "width=device-width viewport가 없어 모바일에서 축소 표시될 수 있습니다.", facts.viewport),
    make("https-final", "technical", "warning", "HTTPS", https,
      https ? "최종 주소가 HTTPS입니다." : "최종 주소가 암호화되지 않은 HTTP입니다. HTTPS로 리다이렉트하세요.", pageUrl),
    make("hreflang-valid", "technical", "warning", "hreflang", hreflangProblems.length === 0,
      facts.hreflang.length === 0 ? "hreflang이 없습니다. 단일 언어 페이지라면 필요 없습니다."
        : hreflangProblems.length ? hreflangProblems.join(" · ") : `hreflang ${facts.hreflang.length}개가 올바릅니다.`,
      facts.hreflang.length ? facts.hreflang.map((link) => `${link.lang}=${link.href}`).join(", ").slice(0, 500) : null),
  ];
}
