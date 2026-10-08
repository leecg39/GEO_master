/**
 * Google Search Console API 호출(읽기 전용). 고정된 Google 호스트만 부르며 토큰은 오류 메시지에 담지 않는다.
 * 오류 코드: 토큰 무효(재연결 필요) · 권한 없음 · 속성 없음 · 한도 초과 · 일반 오류를 서로 구분한다.
 */
import { AppError } from "@/lib/errors";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const API = "https://www.googleapis.com/webmasters/v3";
export const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

export interface GscOAuthConfig { clientId: string; clientSecret: string; redirectUri: string }
export interface SiteEntry { siteUrl: string; permissionLevel: string }
export interface AnalyticsRow { keys?: string[]; clicks: number; impressions: number; ctr: number; position: number }

async function call(url: string, init: RequestInit): Promise<{ status: number; body: Record<string, unknown> }> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new AppError("Google에 연결하지 못했습니다. 잠시 후 다시 시도하세요.", 502, "GSC_API_UNREACHABLE");
  }
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  return { status: response.status, body };
}

function apiError(status: number): never {
  if (status === 401) throw new AppError("Google 인증이 만료되었습니다. 다시 연결하세요.", 409, "GSC_TOKEN_INVALID");
  if (status === 403) throw new AppError("이 속성에 대한 권한이 없습니다. Search Console에서 계정 권한을 확인하세요.", 403, "GSC_PERMISSION_DENIED");
  if (status === 404) throw new AppError("Search Console 속성을 찾을 수 없습니다.", 404, "GSC_PROPERTY_NOT_FOUND");
  if (status === 429) throw new AppError("Search Console API 요청 한도를 초과했습니다. 잠시 후 다시 시도하세요.", 429, "GSC_RATE_LIMITED");
  throw new AppError(`Search Console API 오류(HTTP ${status})`, 502, "GSC_API_ERROR");
}

export async function exchangeCode(config: GscOAuthConfig, code: string, codeVerifier: string) {
  const { status, body } = await call(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri, grant_type: "authorization_code", code_verifier: codeVerifier }).toString(),
  });
  if (status !== 200) throw new AppError("Google 승인 코드를 토큰으로 바꾸지 못했습니다. 다시 연결하세요.", 502, "GSC_TOKEN_EXCHANGE_FAILED");
  return { refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : null, scope: typeof body.scope === "string" ? body.scope : "" };
}

export async function refreshAccessToken(config: GscOAuthConfig, refreshToken: string) {
  const { status, body } = await call(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }).toString(),
  });
  if (status === 400 || status === 401) throw new AppError("Google 연결이 취소되었거나 만료되었습니다. 다시 연결하세요.", 409, "GSC_TOKEN_INVALID");
  if (status !== 200 || typeof body.access_token !== "string") apiError(status === 200 ? 502 : status);
  return body.access_token as string;
}

export async function listSites(accessToken: string): Promise<SiteEntry[]> {
  const { status, body } = await call(`${API}/sites`, { headers: { authorization: `Bearer ${accessToken}` } });
  if (status !== 200) apiError(status);
  const entries = Array.isArray(body.siteEntry) ? body.siteEntry as Array<Record<string, unknown>> : [];
  return entries.filter((entry) => typeof entry.siteUrl === "string").map((entry) => ({ siteUrl: entry.siteUrl as string, permissionLevel: String(entry.permissionLevel ?? "") }));
}

export async function querySearchAnalytics(accessToken: string, siteUrl: string, query: Record<string, unknown>) {
  const { status, body } = await call(`${API}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify(query),
  });
  if (status !== 200) apiError(status);
  return {
    rows: (Array.isArray(body.rows) ? body.rows : []) as AnalyticsRow[],
    aggregation: typeof body.responseAggregationType === "string" ? body.responseAggregationType : null,
  };
}

/** 연결 해제 시 Google 쪽 승인도 취소한다. 실패해도 로컬 토큰은 지운다(호출부) */
export async function revokeToken(token: string) {
  try {
    await call(`${REVOKE_URL}?${new URLSearchParams({ token })}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" } });
  } catch { /* 네트워크 실패는 무시 */ }
}
