/**
 * Qshop 계획 P02 — Firecrawl 공통 어댑터.
 * - 요청·오류 분류·응답 계약 검사를 한곳에서 처리한다 (§5.1, §6 integrations/firecrawl.ts)
 * - Map 링크는 v1(문자열)과 v2(객체) 형식을 모두 받는다. 목록 자체가 없으면 "빈 사이트"가 아니라 계약 오류다
 * - 취소(AbortSignal)와 요청 한도(Retry-After)를 호출자가 구분할 수 있게 그대로 전달한다
 */
import { z } from "zod";
import { AppError } from "@/lib/errors";

const API_BASE = "https://api.firecrawl.dev/v2";
const MAP_TIMEOUT_MS = 30_000;
const SCRAPE_TIMEOUT_MS = 45_000;
const SCRAPE_PAGE_TIMEOUT_MS = 30_000;

export interface FirecrawlRequestOptions {
  apiKey: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

function contractError(what: string) {
  return new AppError(`Firecrawl ${what} 응답 형식이 예상과 다릅니다. 결과를 저장하지 않았습니다.`, 502, "FIRECRAWL_CONTRACT");
}

/** 같은 계정으로 계속 요청해도 실패하는 오류 — 남은 요청을 멈춘다 */
export function isFirecrawlAccountError(error: unknown) {
  return error instanceof AppError && (error.code === "FIRECRAWL_CREDITS_EXHAUSTED" || error.code === "FIRECRAWL_AUTH_FAILED");
}

export function parseRetryAfter(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value.trim() === "") return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, Math.ceil((date - Date.now()) / 1000)) : null;
}

async function errorDetail(response: Response) {
  try {
    const body = await response.json() as { error?: unknown; message?: unknown };
    const text = typeof body.error === "string" ? body.error : typeof body.message === "string" ? body.message : "";
    return text.slice(0, 300);
  } catch {
    return "";
  }
}

export async function firecrawlPost(path: "/map" | "/scrape", body: Record<string, unknown>, options: FirecrawlRequestOptions): Promise<unknown> {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? MAP_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
    });
  } catch (error) {
    if (options.signal?.aborted) throw new AppError("Firecrawl 요청을 취소했습니다.", 409, "FIRECRAWL_CANCELLED");
    const timedOut = error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name);
    throw new AppError(
      timedOut ? "Firecrawl 응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요." : "Firecrawl에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      502,
      timedOut ? "FIRECRAWL_TIMEOUT" : "FIRECRAWL_CONNECTION_FAILED",
    );
  }
  if (!response.ok) {
    const detail = await errorDetail(response);
    if (response.status === 402 || /insufficient credits/i.test(detail)) {
      throw new AppError("Firecrawl 크레딧이 부족하여 사이트 진단을 실행할 수 없습니다. 연결된 Firecrawl 계정에서 크레딧을 충전한 뒤 다시 진단해 주세요.", 503, "FIRECRAWL_CREDITS_EXHAUSTED");
    }
    if (response.status === 401 || response.status === 403) {
      throw new AppError("Firecrawl API 키가 유효하지 않거나 접근 권한이 없습니다. 설정에서 API 키를 확인해 주세요.", 502, "FIRECRAWL_AUTH_FAILED");
    }
    if (response.status === 429) {
      throw new AppError("Firecrawl 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.", 429, "FIRECRAWL_RATE_LIMITED", {
        retryAfterSeconds: parseRetryAfter(response.headers.get("retry-after")),
      });
    }
    throw new AppError(`Firecrawl 요청이 실패했습니다 (HTTP ${response.status}). 잠시 후 다시 시도해 주세요.`, 502, "FIRECRAWL_ERROR");
  }
  try {
    return await response.json();
  } catch {
    throw contractError(path === "/map" ? "Map" : "Scrape");
  }
}

/** 같은 문서를 가리키는 URL을 하나로 본다 — 조각(#) 제거, 호스트 소문자, 끝 슬래시 무시 */
export function discoveredUrlKey(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const path = url.pathname.replace(/\/+$/, "") || "/";
    return `${url.protocol}//${url.host}${path}${url.search}`;
  } catch {
    return null;
  }
}

const mapPayloadSchema = z.object({ success: z.boolean().optional(), links: z.array(z.unknown()).optional() }).passthrough();

export interface MapLinks {
  links: string[];
  invalid: number;
  duplicates: number;
}

export function parseMapLinks(payload: unknown, limit: number): MapLinks {
  const parsed = mapPayloadSchema.safeParse(payload);
  if (!parsed.success) throw contractError("Map");
  if (parsed.data.success === false) throw new AppError("Firecrawl이 URL 목록을 반환하지 않았습니다.", 502, "FIRECRAWL_ERROR");
  if (!parsed.data.links) throw contractError("Map");
  const seen = new Set<string>();
  const links: string[] = [];
  let invalid = 0;
  let duplicates = 0;
  for (const entry of parsed.data.links) {
    const raw = typeof entry === "string" ? entry
      : entry && typeof entry === "object" && typeof (entry as { url?: unknown }).url === "string" ? (entry as { url: string }).url
        : null;
    const key = raw === null ? null : discoveredUrlKey(raw);
    if (raw === null || key === null) { invalid += 1; continue; }
    if (seen.has(key)) { duplicates += 1; continue; }
    seen.add(key);
    if (links.length < limit) links.push(raw.trim().split("#")[0]!);
  }
  return { links, invalid, duplicates };
}

export async function mapSite(domain: string, options: FirecrawlRequestOptions & { limit: number }): Promise<MapLinks> {
  const payload = await firecrawlPost("/map", { url: `https://${domain}`, limit: options.limit }, { ...options, timeoutMs: options.timeoutMs ?? MAP_TIMEOUT_MS });
  return parseMapLinks(payload, options.limit);
}

const textOrList = z.union([z.string(), z.array(z.string())]).nullish();
const scrapePayloadSchema = z.object({
  success: z.literal(true),
  data: z.object({
    rawHtml: z.string().nullish(),
    markdown: z.string().nullish(),
    metadata: z.object({
      statusCode: z.number().int(),
      url: z.string().nullish(),
      sourceURL: z.string().nullish(),
      title: textOrList,
      contentType: z.string().nullish(),
      cacheState: z.string().nullish(),
    }).passthrough(),
  }).passthrough(),
}).passthrough();

export interface ScrapedPage {
  /** 대상 페이지가 Firecrawl에 돌려준 상태 코드 (Firecrawl API 자체의 상태가 아님) */
  statusCode: number;
  finalUrl: string | null;
  rawHtml: string | null;
  markdown: string | null;
  metadataTitle: string | null;
  contentType: string | null;
  /** Firecrawl 캐시에서 돌려준 결과 — 새로 렌더링한 결과와 구분한다 (§5.1-5) */
  cached: boolean;
}

/** 렌더링 수집. 캐시를 쓰지 않도록 maxAge 0으로 요청한다 */
export async function scrapePage(url: string, options: FirecrawlRequestOptions): Promise<ScrapedPage> {
  const payload = await firecrawlPost(
    "/scrape",
    { url, formats: ["rawHtml", "markdown"], maxAge: 0, timeout: SCRAPE_PAGE_TIMEOUT_MS },
    { ...options, timeoutMs: options.timeoutMs ?? SCRAPE_TIMEOUT_MS },
  );
  const parsed = scrapePayloadSchema.safeParse(payload);
  if (!parsed.success) throw contractError("Scrape");
  const { rawHtml, markdown, metadata } = parsed.data.data;
  const title = Array.isArray(metadata.title) ? metadata.title[0] : metadata.title;
  return {
    statusCode: metadata.statusCode,
    finalUrl: metadata.url ?? metadata.sourceURL ?? null,
    rawHtml: rawHtml ?? null,
    markdown: markdown ?? null,
    metadataTitle: title?.trim() || null,
    contentType: metadata.contentType ?? null,
    cached: metadata.cacheState === "hit",
  };
}
