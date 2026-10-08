/**
 * Qshop 계획 P01·P02 — URL 발견(Map)과 실제 측정을 구분한다.
 * - Map으로 찾은 URL은 요청하지 않았으므로 HTTP 상태를 "미측정"으로 둔다
 * - llms.txt는 사이트맵 목록이 아니라 실제 공개 경로 요청으로 판정한다 (§5.1-7)
 * - native 요청, Firecrawl 렌더링, Firecrawl 캐시 결과를 구분해 기록한다 (§5.1-5)
 */
import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import { AppError } from "@/lib/errors";
import { isFirecrawlAccountError, parseRetryAfter, scrapePage } from "@/lib/integrations/firecrawl";
import type { BodyKind } from "@/lib/page-snapshots";
import { robotsPolicyFromResponse, type RobotsPolicy } from "@/lib/robots-policy";
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

/** 실제 /robots.txt 요청 결과를 목적별 AI 크롤러 정책으로 해석한다. 읽지 못하면 "확인 불가" (Qshop P04) */
export async function probeRobotsTxt(domain: string): Promise<RobotsPolicy> {
  try {
    return robotsPolicyFromResponse(await fetchPublicText(`https://${domain}/robots.txt`, PROBE_TIMEOUT_MS));
  } catch {
    return robotsPolicyFromResponse(null);
  }
}

const PAGE_TIMEOUT_MS = 8_000;
const NATIVE_CONCURRENCY = 4;
const RENDER_CONCURRENCY = 2;
/** 렌더링 수집은 페이지마다 Firecrawl 크레딧을 쓰므로 한 번에 요청하는 페이지 수를 제한한다 */
export const RENDER_PAGE_LIMIT = 10;
/** Retry-After가 이보다 길면 기다리지 않고 멈춘다 */
const MAX_RETRY_WAIT_S = 10;
const DEFAULT_RETRY_WAIT_S = 2;

export type CollectMode = "native" | "rendered";
/** 요청하지 않은 URL은 discovered로 남긴다. 범위 밖은 요청하지 않았거나 범위 밖으로 리다이렉트된 경우다 */
export type PageFetchState = "fetched" | "failed" | "out_of_scope" | "discovered";
export type PageRenderMode = "native" | "rendered" | "cache";
export type CollectHalt = "cancelled" | "rate_limited" | "credits_exhausted" | "auth_failed";

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
  renderMode: PageRenderMode | null;
  /** 응답 본문 — 스냅샷 분석용으로만 쓰고 site_audit_pages에는 저장하지 않는다 */
  body: string | null;
  bodyKind: BodyKind | null;
  contentType: string | null;
}

export interface CollectOptions {
  mode: CollectMode;
  apiKey?: string | null;
  signal?: AbortSignal;
  /** 다음 페이지를 요청하기 전에 확인한다 (DB 취소 플래그 등) */
  shouldStop?: () => boolean;
}

export interface CollectResult {
  pages: PageFetchResult[];
  halted: CollectHalt | null;
  /** 렌더링 한도 때문에 요청하지 않은 URL 수 */
  overLimit: number;
}

const INTERRUPTED_NOTE = "취소로 요청을 중단해 응답을 받지 못했습니다";

const HALT_NOTES: Record<CollectHalt, string> = {
  cancelled: "사용자가 취소해 요청하지 않았습니다",
  rate_limited: "요청 한도(HTTP 429) 때문에 수집을 멈춰 요청하지 않았습니다",
  credits_exhausted: "Firecrawl 크레딧 부족으로 수집을 멈춰 요청하지 않았습니다",
  auth_failed: "Firecrawl 인증 오류로 수집을 멈춰 요청하지 않았습니다",
};

const hashText = (text: string) => createHash("sha256").update(text).digest("hex");
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "요청 실패").slice(0, 200);
const errorCode = (error: unknown) => (error instanceof AppError ? error.code : null);

function notRequested(url: string, note: string | null, state: PageFetchState = "discovered"): PageFetchResult {
  return { url, state, statusCode: 0, finalUrl: null, title: null, bytes: 0, responseMs: null, contentHash: null, error: note, renderMode: null, body: null, bodyKind: null, contentType: null };
}

function failed(url: string, error: string, started: number, renderMode: PageRenderMode, statusCode = 0): PageFetchResult {
  return { ...notRequested(url, error, "failed"), statusCode, responseMs: Date.now() - started, renderMode };
}

/** 기다릴 시간(ms). 기다리지 않고 멈춰야 하면 null */
function retryWaitMs(retryAfterSeconds: number | null) {
  const seconds = retryAfterSeconds ?? DEFAULT_RETRY_WAIT_S;
  return seconds > MAX_RETRY_WAIT_S ? null : seconds * 1000;
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (ms <= 0 || signal?.aborted) { resolve(); return; }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

interface Outcome { page: PageFetchResult; halt?: CollectHalt }

interface ObservedResponse { statusCode: number; finalUrl: string | null; body: string; bodyKind: BodyKind; contentType: string | null; title: string | null }

function observed(url: string, domain: string, started: number, renderMode: PageRenderMode, response: ObservedResponse): PageFetchResult {
  const base = { url, statusCode: response.statusCode, finalUrl: response.finalUrl, responseMs: Date.now() - started, renderMode, contentType: response.contentType };
  // 리다이렉트 목적지가 사이트 범위 밖이면 이 사이트의 측정값이 아니다 (§5.1-2)
  if (response.finalUrl && !isInScope(response.finalUrl, domain)) {
    return { ...base, state: "out_of_scope", title: null, bytes: 0, contentHash: null, error: "사이트 범위 밖으로 리다이렉트", body: null, bodyKind: null };
  }
  return {
    ...base, state: "fetched", title: response.title, bytes: Buffer.byteLength(response.body), contentHash: hashText(response.body), error: null,
    body: response.body, bodyKind: response.bodyKind,
  };
}

async function fetchNative(url: string, domain: string, signal?: AbortSignal): Promise<Outcome> {
  const started = Date.now();
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetchPublicText(url, PAGE_TIMEOUT_MS, { signal });
      if (response.status === 429) {
        const wait = retryWaitMs(parseRetryAfter(response.retryAfter));
        if (attempt === 0 && wait !== null && !signal?.aborted) {
          await sleep(wait, signal);
          continue;
        }
        return { page: failed(url, "HTTP 429 — 대상 사이트가 요청 한도를 알렸습니다", started, "native", 429), halt: "rate_limited" };
      }
      const html = /html/i.test(response.contentType) || /<html|<title/i.test(response.text);
      return {
        page: observed(url, domain, started, "native", {
          statusCode: response.status, finalUrl: response.url, body: response.text, bodyKind: html ? "html" : "text",
          contentType: response.contentType || null, title: html ? extractTitle(response.text) : null,
        }),
      };
    } catch (error) {
      if (signal?.aborted || errorCode(error) === "FETCH_CANCELLED") return { page: notRequested(url, INTERRUPTED_NOTE), halt: "cancelled" };
      return { page: failed(url, errorMessage(error), started, "native") };
    }
  }
}

async function fetchRendered(url: string, domain: string, apiKey: string, signal?: AbortSignal): Promise<Outcome> {
  const started = Date.now();
  for (let attempt = 0; ; attempt += 1) {
    try {
      const page = await scrapePage(url, { apiKey, signal });
      const renderMode: PageRenderMode = page.cached ? "cache" : "rendered";
      if (page.statusCode === 429) return { page: failed(url, "HTTP 429 — 대상 사이트가 요청 한도를 알렸습니다", started, renderMode, 429), halt: "rate_limited" };
      const body = page.rawHtml ?? page.markdown ?? "";
      const title = page.rawHtml ? extractTitle(page.rawHtml) : page.metadataTitle;
      const bodyKind: BodyKind = page.rawHtml ? "html" : page.markdown ? "markdown" : "text";
      return { page: observed(url, domain, started, renderMode, { statusCode: page.statusCode, finalUrl: page.finalUrl, body, bodyKind, contentType: page.contentType, title }) };
    } catch (error) {
      const code = errorCode(error);
      if (signal?.aborted || code === "FIRECRAWL_CANCELLED") return { page: notRequested(url, INTERRUPTED_NOTE), halt: "cancelled" };
      if (code === "FIRECRAWL_RATE_LIMITED") {
        const details = (error as AppError).details as { retryAfterSeconds?: number | null } | undefined;
        const wait = retryWaitMs(details?.retryAfterSeconds ?? null);
        if (attempt === 0 && wait !== null) {
          await sleep(wait, signal);
          continue;
        }
        return { page: failed(url, errorMessage(error), started, "rendered"), halt: "rate_limited" };
      }
      if (isFirecrawlAccountError(error)) {
        return { page: failed(url, errorMessage(error), started, "rendered"), halt: code === "FIRECRAWL_CREDITS_EXHAUSTED" ? "credits_exhausted" : "auth_failed" };
      }
      return { page: failed(url, errorMessage(error), started, "rendered") };
    }
  }
}

/**
 * 발견한 URL을 실제로 요청한다.
 * - native: SSRF 방어가 있는 직접 요청 (동시 4개, 크레딧 없음)
 * - rendered: Firecrawl Scrape (동시 2개, 최대 10페이지, 페이지당 크레딧)
 * 429·크레딧 부족·인증 오류·취소가 나오면 남은 URL은 요청하지 않고 discovered로 남긴다.
 * 실패는 실패로 남기고 성공 분모에 넣지 않는다.
 */
export async function collectDiscoveredPages(urls: readonly string[], domain: string, options: CollectOptions): Promise<CollectResult> {
  const pages = urls.map((url) => isInScope(url, domain) ? notRequested(url, null) : notRequested(url, null, "out_of_scope"));
  const queue = pages.flatMap((page, index) => page.state === "discovered" ? [index] : []);
  const limit = options.mode === "rendered" ? RENDER_PAGE_LIMIT : queue.length;
  for (const index of queue.slice(limit)) pages[index] = notRequested(urls[index]!, `렌더링 수집 한도(${RENDER_PAGE_LIMIT}페이지)를 넘어 요청하지 않았습니다`);
  const work = queue.slice(0, limit);
  if (options.mode === "rendered" && !options.apiKey) throw new AppError("렌더링 수집에는 Firecrawl API 키가 필요합니다.", 422, "FIRECRAWL_KEY_REQUIRED");

  let halted: CollectHalt | null = null;
  const requested = new Set<number>();
  let next = 0;
  const worker = async () => {
    while (next < work.length) {
      if (!halted && (options.signal?.aborted || options.shouldStop?.())) halted = "cancelled";
      if (halted) return;
      const index = work[next]!;
      next += 1;
      requested.add(index);
      const outcome = options.mode === "rendered"
        ? await fetchRendered(urls[index]!, domain, options.apiKey!, options.signal)
        : await fetchNative(urls[index]!, domain, options.signal);
      pages[index] = outcome.page;
      if (outcome.halt && !halted) halted = outcome.halt;
    }
  };
  const concurrency = options.mode === "rendered" ? RENDER_CONCURRENCY : NATIVE_CONCURRENCY;
  await Promise.all(Array.from({ length: Math.min(concurrency, work.length) }, worker));
  if (halted) {
    for (const index of work) if (!requested.has(index)) pages[index] = notRequested(urls[index]!, HALT_NOTES[halted]);
  }
  return { pages, halted, overLimit: Math.max(0, queue.length - limit) };
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

