/**
 * Qshop 계획 P01 — URL 발견(Map)과 실제 측정을 구분한다.
 * - Map으로 찾은 URL은 요청하지 않았으므로 HTTP 상태를 "미측정"으로 둔다
 * - llms.txt는 사이트맵 목록이 아니라 실제 공개 경로 요청으로 판정한다 (§5.1-7)
 */
import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import { fetchPublicText } from "@/lib/url-security";

export type LlmsTxtState = "present" | "missing" | "unknown";
export type SiteAuditDataState = "none" | "discovered" | "measured" | "legacy_estimate";

const PROBE_TIMEOUT_MS = 8_000;

/** URL 경로 세그먼트 수 — 클릭 깊이가 아니라 주소 구조상의 깊이 */
export function urlPathDepth(url: string) {
  try {
    return new URL(url).pathname.split("/").filter(Boolean).length;
  } catch {
    return 0;
  }
}

function looksLikeHtml(text: string, contentType: string) {
  return /html/i.test(contentType) || /^\s*<(?:!doctype|html|head|body)/i.test(text);
}

/** 실제 /llms.txt 요청 결과. 네트워크 오류·서버 오류는 "확인 불가"이며 "없음"이 아니다 */
export async function probeLlmsTxt(domain: string): Promise<{ state: LlmsTxtState; detail: string }> {
  try {
    const response = await fetchPublicText(`https://${domain}/llms.txt`, PROBE_TIMEOUT_MS);
    if (response.status >= 200 && response.status < 300) {
      return looksLikeHtml(response.text, response.contentType)
        ? { state: "missing", detail: `HTTP ${response.status}이지만 HTML 페이지가 응답했습니다(소프트 404)` }
        : { state: "present", detail: `HTTP ${response.status}` };
    }
    if (response.status === 404 || response.status === 410) return { state: "missing", detail: `HTTP ${response.status}` };
    return { state: "unknown", detail: `HTTP ${response.status}` };
  } catch {
    return { state: "unknown", detail: "요청 실패(네트워크·차단·시간 초과)" };
  }
}

const PAGE_TIMEOUT_MS = 8_000;
const PAGE_CONCURRENCY = 4;

export type PageFetchState = "fetched" | "failed" | "out_of_scope";

export interface PageFetchResult {
  url: string;
  state: PageFetchState;
  statusCode: number;
  finalUrl: string | null;
  title: string | null;
  bytes: number;
  responseMs: number | null;
  contentHash: string | null;
  error: string | null;
}

/** 캠페인 도메인과 그 하위 도메인만 수집한다 (계획 §5.1-2: 명시된 사이트 범위) */
export function isInScope(url: string, domain: string) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    const base = domain.toLowerCase().replace(/^www\./, "");
    return host === base || host.endsWith(`.${base}`);
  } catch {
    return false;
  }
}

export function extractTitle(html: string) {
  if (!/<title[\s>]/i.test(html)) return null;
  const title = cheerio.load(html)("title").first().text().replace(/\s+/g, " ").trim();
  return title || null;
}

async function fetchPage(url: string, domain: string): Promise<PageFetchResult> {
  const empty = { finalUrl: null, title: null, bytes: 0, responseMs: null, contentHash: null };
  if (!isInScope(url, domain)) return { url, state: "out_of_scope", statusCode: 0, error: null, ...empty };
  const started = Date.now();
  try {
    const response = await fetchPublicText(url, PAGE_TIMEOUT_MS);
    return {
      url,
      state: "fetched",
      statusCode: response.status,
      finalUrl: response.url,
      title: /html/i.test(response.contentType) || /<html|<title/i.test(response.text) ? extractTitle(response.text) : null,
      bytes: Buffer.byteLength(response.text),
      responseMs: Date.now() - started,
      contentHash: createHash("sha256").update(response.text).digest("hex"),
      error: null,
    };
  } catch (error) {
    return { url, state: "failed", statusCode: 0, error: error instanceof Error ? error.message.slice(0, 200) : "요청 실패", ...empty, responseMs: Date.now() - started };
  }
}

/** 발견한 URL을 실제로 요청한다 (native fetch, 동시 4개). 실패는 실패로 남기고 성공 분모에 넣지 않는다 */
export async function fetchDiscoveredPages(urls: readonly string[], domain: string): Promise<PageFetchResult[]> {
  const results: PageFetchResult[] = new Array(urls.length);
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const index = next;
      next += 1;
      results[index] = await fetchPage(urls[index]!, domain);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PAGE_CONCURRENCY, urls.length) }, worker));
  return results;
}
