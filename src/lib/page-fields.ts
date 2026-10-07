/** 공개 페이지 HTML에서 수정안 대상 필드의 현재 값을 읽는다 (원본 HTML 기준, Markdown 변환 아님) */
import * as cheerio from "cheerio";

export type PageField = "title" | "description" | "canonical" | "og_image" | "robots_meta" | "json_ld" | "body";

const MAX_BODY = 20_000;
const squash = (text: string) => text.replace(/\s+/g, " ").trim();

export function extractPageField(html: string, field: string): string | null {
  const $ = cheerio.load(html);
  const attr = (selector: string, name: string) => $(selector).first().attr(name)?.trim() || null;
  switch (field as PageField) {
    case "title": return /<title[\s>]/i.test(html) ? squash($("title").first().text()) || null : null;
    case "description": return attr("meta[name='description']", "content");
    case "canonical": return attr("link[rel='canonical']", "href");
    case "og_image": return attr("meta[property='og:image']", "content");
    case "robots_meta": return attr("meta[name='robots']", "content");
    case "json_ld": {
      const blocks = $("script[type='application/ld+json']").toArray().map((el) => $(el).text().trim()).filter(Boolean);
      return blocks.length ? blocks.join("\n") : null;
    }
    case "body": {
      $("script, style, noscript, nav, header, footer, aside, form, iframe, svg").remove();
      return squash($("body").text()).slice(0, MAX_BODY) || null;
    }
    default: return null;
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function jsonLdEqual(actual: string, expected: string) {
  try {
    const parse = (text: string) => { const v = JSON.parse(text); return Array.isArray(v) ? v : [v]; };
    const left = parse(actual).map(canonicalJson).sort().join("|");
    const right = parse(expected).map(canonicalJson).sort().join("|");
    return left === right;
  } catch {
    // 여러 블록이 줄바꿈으로 이어진 경우 블록별로 비교한다
    const blocks = actual.split("\n").map((line) => line.trim());
    return blocks.includes(expected.trim());
  }
}

/** 실제 값이 수정안과 일치하는지 — 공백 차이는 무시, JSON-LD는 키 순서 무시, 본문은 포함 여부 */
export function fieldMatches(field: string, actual: string | null, expected: string) {
  if (actual === null) return false;
  if (field === "json_ld") return jsonLdEqual(actual, expected);
  if (field === "body") return squash(actual).includes(squash(expected));
  return squash(actual) === squash(expected);
}
