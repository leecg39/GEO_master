/**
 * JavaScript 실행 전후 비교 (RankSEO REA G2, A4).
 * RankSEO의 "AI Crawler View"는 브라우저 DOM의 숨김 요소 개수를 섞은 추정치였다.
 * 여기서는 같은 URL의 렌더링 결과(Firecrawl)와 직접 받은 HTML(JavaScript 미실행)을 실제로 비교한다.
 * 모든 AI 크롤러가 JavaScript를 실행한다고 보장할 수 없으므로, 실행 전 HTML에 핵심 내용이 없으면 기술 경고로 알린다.
 */
import * as cheerio from "cheerio";
import { sameDocumentUrl } from "./hreflang";
import type { BodyKind, PageFinding } from "./page-snapshots";

/** 이보다 짧은 페이지는 단어 비율로 판정하지 않는다 */
export const MIN_RENDERED_WORDS = 100;
/** 실행 전 본문이 실행 후의 이 비율 미만이면 경고 */
export const MIN_NATIVE_WORD_RATIO = 0.5;

export interface NativeBaseline {
  statusCode: number;
  /** 직접 요청의 최종 주소(리디렉션 후) */
  finalUrl: string;
  body: string;
  bodyKind: BodyKind;
}

interface Shape { title: boolean; h1: boolean; jsonLd: boolean; words: number }

export function visibleWordCount(html: string) {
  const $ = cheerio.load(html);
  $("script, style, noscript, template").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim();
  return text ? text.split(" ").length : 0;
}

function shape(html: string): Shape {
  const $ = cheerio.load(html);
  return {
    title: Boolean($("title").first().text().trim()),
    h1: $("h1").toArray().some((node) => Boolean($(node).text().trim())),
    jsonLd: $("script[type='application/ld+json']").length > 0,
    words: visibleWordCount(html),
  };
}

const finding = (passed: boolean, detail: string, evidence: string | null): PageFinding => ({
  code: "js-dependent-content", tier: "technical", severity: passed ? "notice" : "warning", passed,
  label: "JavaScript 없이 보이는 내용", detail, evidence,
});

export function compareRenderedToNative(renderedHtml: string, native: NativeBaseline | null, renderedUrl: string): PageFinding {
  const redirected = native !== null && !sameDocumentUrl(native.finalUrl, renderedUrl);
  if (!native || redirected || native.bodyKind !== "html" || native.statusCode < 200 || native.statusCode >= 300) {
    const reason = !native ? "JavaScript 실행 전 HTML을 받지 못해"
      : redirected ? `직접 요청이 다른 주소(${native.finalUrl.slice(0, 200)})로 이동해`
        : native.bodyKind !== "html" ? "직접 받은 응답이 HTML이 아니어서" : `직접 요청이 HTTP ${native.statusCode}로 응답해`;
    return finding(true, `${reason} 비교하지 않았습니다.`, null);
  }
  const after = shape(renderedHtml);
  const before = shape(native.body);
  const missing = [
    after.title && !before.title ? "title" : null,
    after.h1 && !before.h1 ? "H1" : null,
    after.jsonLd && !before.jsonLd ? "JSON-LD" : null,
  ].filter((item): item is string => item !== null);
  const ratio = after.words ? before.words / after.words : 1;
  const textGap = after.words >= MIN_RENDERED_WORDS && ratio < MIN_NATIVE_WORD_RATIO;
  const evidence = `JS 실행 전 ${before.words} / 실행 후 ${after.words}단어`;
  if (!missing.length && !textGap) return finding(true, "JavaScript를 실행하지 않아도 핵심 내용이 HTML에 있습니다.", evidence);
  const parts = [
    missing.length ? `JavaScript 실행 후에만 나타나는 요소: ${missing.join(", ")}` : "",
    textGap ? `본문의 ${Math.round(ratio * 100)}%만 실행 전 HTML에 있습니다` : "",
  ].filter(Boolean);
  return finding(false, `${parts.join(" · ")}. JavaScript를 실행하지 않는 크롤러는 이 내용을 보지 못할 수 있습니다. 서버 렌더링이나 정적 생성을 검토하세요. 직접 요청이 봇 차단 페이지를 받았을 수도 있으니 관측값을 함께 확인하세요.`, evidence);
}
