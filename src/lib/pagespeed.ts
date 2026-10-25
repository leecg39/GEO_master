/**
 * PageSpeed Insights (RankSEO REA G7, A7).
 * - RankSEO는 배포 코드에 기본 키를 넣었다. 여기서는 사용자 키(암호화 저장) 또는 서버 환경 변수 PAGESPEED_API_KEY만 쓴다.
 *   키 없는 호출은 하루 할당량이 0이다(2026-10-13 실측 429). 키가 없으면 기능을 끈다
 * - 실험실 측정(Lighthouse 1회)과 실사용자 측정(CrUX, 지난 28일 p75)을 섞지 않고 따로 돌려준다. 진단 점수에 넣지 않는다
 * - 응답은 fields로 필요한 부분만 받는다. 키는 오류 메시지·응답에 담지 않는다
 */
import { z } from "zod";
import { decryptSecret, encryptSecret, SecretDecryptionError } from "./crypto";
import { getDatabase } from "./db";
import { AppError } from "./errors";
import { fetchPublicText, normalizePublicUrl } from "./url-security";

const ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
const TIMEOUT_MS = 60_000;
const FIELDS = [
  "loadingExperience(id,overall_category,origin_fallback,metrics)",
  "originLoadingExperience(id,overall_category,metrics)",
  "lighthouseResult(finalUrl,fetchTime,lighthouseVersion,categories/performance/score,audits/largest-contentful-paint/numericValue,audits/cumulative-layout-shift/numericValue,audits/total-blocking-time/numericValue,audits/first-contentful-paint/numericValue,audits/speed-index/numericValue)",
].join(",");

export const pageSpeedQuerySchema = z.object({
  url: z.string().trim().min(1).max(2048),
  strategy: z.enum(["mobile", "desktop"]).default("mobile"),
}).strict();
export const pageSpeedKeySchema = z.object({ apiKey: z.string().trim().min(20).max(200) }).strict();

// ── 키 관리 ──
function savedKey(): string | null {
  const row = getDatabase().sqlite.prepare("SELECT value_encrypted FROM integration_secrets WHERE name = 'pagespeed'").get() as { value_encrypted: string } | undefined;
  if (!row) return null;
  try { return decryptSecret(row.value_encrypted); } catch (error) {
    if (error instanceof SecretDecryptionError) throw new AppError("저장된 PageSpeed 키를 읽을 수 없습니다. 키를 다시 저장하세요.", 409, "PAGESPEED_KEY_UNREADABLE");
    throw error;
  }
}
const environmentKey = () => process.env.PAGESPEED_API_KEY?.trim() || null;

export function pageSpeedKeyStatus() {
  if (savedKey()) return { configured: true, source: "saved" as const };
  return environmentKey() ? { configured: true, source: "environment" as const } : { configured: false, source: null };
}

export function savePageSpeedKey(input: unknown) {
  const { apiKey } = pageSpeedKeySchema.parse(input);
  getDatabase().sqlite.prepare(`
    INSERT INTO integration_secrets (name, value_encrypted, updated_at) VALUES ('pagespeed', ?, ?)
    ON CONFLICT(name) DO UPDATE SET value_encrypted = excluded.value_encrypted, updated_at = excluded.updated_at
  `).run(encryptSecret(apiKey), new Date().toISOString());
  return pageSpeedKeyStatus();
}

export function deletePageSpeedKey() {
  getDatabase().sqlite.prepare("DELETE FROM integration_secrets WHERE name = 'pagespeed'").run();
  return pageSpeedKeyStatus();
}

// ── 결과 해석 ──
const FIELD_LABELS: Record<string, { label: string; format: (value: number) => string }> = {
  LARGEST_CONTENTFUL_PAINT_MS: { label: "LCP", format: (value) => `${value.toLocaleString("en-US")}ms` },
  INTERACTION_TO_NEXT_PAINT: { label: "INP", format: (value) => `${value.toLocaleString("en-US")}ms` },
  CUMULATIVE_LAYOUT_SHIFT_SCORE: { label: "CLS", format: (value) => (value / 100).toFixed(2) },
  FIRST_CONTENTFUL_PAINT_MS: { label: "FCP", format: (value) => `${value.toLocaleString("en-US")}ms` },
  EXPERIMENTAL_TIME_TO_FIRST_BYTE: { label: "TTFB", format: (value) => `${value.toLocaleString("en-US")}ms` },
};

type Json = Record<string, unknown>;
const record = (value: unknown): Json => (value && typeof value === "object" && !Array.isArray(value) ? value as Json : {});
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const str = (value: unknown) => (typeof value === "string" ? value : null);

function fieldData(data: Json) {
  const page = record(data.loadingExperience);
  const usePage = Object.keys(record(page.metrics)).length > 0 && page.origin_fallback !== true;
  const source = usePage ? page : record(data.originLoadingExperience);
  const metrics = Object.entries(record(source.metrics)).flatMap(([key, value]) => {
    const p75 = num(record(value).percentile);
    if (p75 === null) return [];
    const known = FIELD_LABELS[key];
    return [{ key, label: known?.label ?? key, p75: known ? known.format(p75) : String(p75), category: str(record(value).category) }];
  });
  if (metrics.length === 0) return null;
  return { scope: usePage ? "page" as const : "origin" as const, overall: str(source.overall_category), metrics };
}

function labData(data: Json) {
  const lighthouse = record(data.lighthouseResult);
  if (!Object.keys(lighthouse).length) return null;
  const audit = (name: string) => num(record(record(lighthouse.audits)[name]).numericValue);
  const round = (value: number | null) => (value === null ? null : Math.round(value));
  const score = num(record(record(lighthouse.categories).performance).score);
  return {
    performanceScore: score === null ? null : Math.round(score * 100),
    lcpMs: round(audit("largest-contentful-paint")), cls: audit("cumulative-layout-shift"), tbtMs: round(audit("total-blocking-time")),
    fcpMs: round(audit("first-contentful-paint")), speedIndexMs: round(audit("speed-index")),
    lighthouseVersion: str(lighthouse.lighthouseVersion), fetchTime: str(lighthouse.fetchTime), finalUrl: str(lighthouse.finalUrl),
  };
}

export function parsePageSpeed(data: unknown, strategy: "mobile" | "desktop") {
  const root = record(data);
  return { strategy, lab: labData(root), field: fieldData(root) };
}

function failure(status: number, text: string, key: string): AppError {
  if (status === 429) return new AppError("PageSpeed 할당량을 넘었습니다. 잠시 후 다시 시도하거나 Google Cloud 콘솔에서 할당량을 확인하세요.", 429, "PAGESPEED_QUOTA");
  let message = "";
  try { message = str(record(record(JSON.parse(text)).error).message) ?? ""; } catch { message = ""; }
  const safe = message.replaceAll(key, "***").slice(0, 200);
  return new AppError(`PageSpeed 측정에 실패했습니다(HTTP ${status})${safe ? `: ${safe}` : ""}`, 502, "PAGESPEED_FAILED");
}

export async function runPageSpeed(input: unknown) {
  const query = pageSpeedQuerySchema.parse(input);
  const target = normalizePublicUrl(query.url).toString();
  const key = savedKey() ?? environmentKey();
  if (!key) throw new AppError("PageSpeed API 키가 필요합니다. 키 없는 호출은 Google 할당량이 0입니다.", 409, "PAGESPEED_KEY_REQUIRED");
  const url = new URL(ENDPOINT);
  url.search = new URLSearchParams({ url: target, strategy: query.strategy, category: "performance", fields: FIELDS, key }).toString();
  let response;
  try {
    response = await fetchPublicText(url.toString(), TIMEOUT_MS);
  } catch {
    throw new AppError("PageSpeed 서버에 연결하지 못했습니다.", 502, "PAGESPEED_UNREACHABLE");
  }
  if (response.status !== 200) throw failure(response.status, response.text, key);
  let data: unknown;
  try { data = JSON.parse(response.text); } catch { throw new AppError("PageSpeed 응답을 읽지 못했습니다.", 502, "PAGESPEED_FAILED"); }
  return { url: target, measuredAt: new Date().toISOString(), ...parsePageSpeed(data, query.strategy) };
}
