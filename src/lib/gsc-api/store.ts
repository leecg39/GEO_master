/**
 * Qshop P10 — Search Console 읽기 전용 API 연결.
 * - OAuth: PKCE + 1회용 state(10분, 해시만 저장), refresh token은 암호화 저장, 응답에 토큰을 담지 않는다
 * - 상태 구분: 설정 안 됨 / 연결 안 됨 / 연결됨 / 오류(재연결 필요), 속성 없음, 행 없음은 성과 0과 다르다
 * - 콘솔 내보내기(search_console_imports)와 저장소를 섞지 않는다
 */
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { transactionalMutation } from "@/lib/crud";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { getDatabase } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { requireActiveProject } from "@/lib/projects";
import { exchangeCode, GSC_SCOPE, listSites, querySearchAnalytics, refreshAccessToken, revokeToken, type GscOAuthConfig } from "./google";

const STATE_TTL_MS = 10 * 60 * 1000;
const MAX_RANGE_DAYS = 486; // Search Console 보관 기간(약 16개월)
const TIMEZONE = "America/Los_Angeles"; // Search Console 날짜 기준 시간대

interface ConnectionRow { id: number; project_id: number; site_url: string; status: string; refresh_token: string | null; granted_scope: string | null; last_error: string | null; last_synced_at: string | null }
interface SyncRow { id: number; site_url: string; start_date: string; end_date: string; data_state: string; search_type: string; aggregation: string | null; timezone: string; row_count: number; status: string; error_code: string | null; fetched_at: string }

const base64url = (buffer: Buffer) => buffer.toString("base64url");
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function config(): GscOAuthConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const redirectUri = process.env.GSC_REDIRECT_URI?.trim();
  return clientId && clientSecret && redirectUri ? { clientId, clientSecret, redirectUri } : null;
}

function requireConfig() {
  const value = config();
  if (!value) throw new AppError("Search Console API 연결이 설정되지 않았습니다. GOOGLE_CLIENT_ID·GOOGLE_CLIENT_SECRET·GSC_REDIRECT_URI 환경 변수를 확인하세요.", 503, "GSC_NOT_CONFIGURED");
  return value;
}

function connectionOf(projectId: number) {
  return getDatabase().sqlite.prepare("SELECT * FROM gsc_connections WHERE project_id = ? ORDER BY id DESC LIMIT 1").get(projectId) as ConnectionRow | undefined;
}

function updateConnection(id: number, fields: Partial<Record<"site_url" | "status" | "refresh_token" | "granted_scope" | "last_error" | "last_synced_at", string | null>>) {
  const keys = Object.keys(fields);
  getDatabase().sqlite.prepare(`UPDATE gsc_connections SET ${keys.map((key) => `${key} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
    .run(...keys.map((key) => fields[key as keyof typeof fields] ?? null), new Date().toISOString(), id);
}

function toSync(row: SyncRow) {
  return {
    id: row.id, siteUrl: row.site_url, startDate: row.start_date, endDate: row.end_date, dataState: row.data_state, searchType: row.search_type,
    aggregation: row.aggregation, timezone: row.timezone, rowCount: row.row_count, status: row.status as "ok" | "no_rows" | "error", errorCode: row.error_code, fetchedAt: row.fetched_at,
  };
}

export function getGscStatus() {
  const active = requireActiveProject();
  const row = connectionOf(active.id);
  const latest = getDatabase().sqlite.prepare("SELECT * FROM gsc_api_syncs WHERE project_id = ? ORDER BY id DESC LIMIT 1").get(active.id) as SyncRow | undefined;
  const configured = config() !== null;
  const state = !configured ? "not_configured" as const
    : row?.status === "error" ? "error" as const
      : row?.refresh_token && row.status === "connected" ? "connected" as const : "not_connected" as const;
  return { configured, state, siteUrl: row?.site_url || null, lastError: row?.last_error ?? null, lastSyncedAt: row?.last_synced_at ?? null, latestSync: latest ? toSync(latest) : null };
}

/** 동의 화면 URL을 만든다. state 원문은 저장하지 않고 해시만 남긴다 */
export function startGscOAuth() {
  const settings = requireConfig();
  const active = requireActiveProject();
  const state = base64url(randomBytes(32));
  const verifier = base64url(randomBytes(48));
  const now = Date.now();
  const { sqlite } = getDatabase();
  sqlite.prepare("DELETE FROM gsc_oauth_states WHERE expires_at < ?").run(new Date(now).toISOString());
  sqlite.prepare("INSERT INTO gsc_oauth_states (state_hash, project_id, code_verifier, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
    .run(sha256(state), active.id, encryptSecret(verifier), new Date(now).toISOString(), new Date(now + STATE_TTL_MS).toISOString());
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: settings.clientId, redirect_uri: settings.redirectUri, response_type: "code", scope: GSC_SCOPE,
    access_type: "offline", prompt: "consent", include_granted_scopes: "false", state,
    code_challenge: base64url(createHash("sha256").update(verifier).digest()), code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

export async function completeGscOAuth(input: { code: string; state: string }) {
  const settings = requireConfig();
  const { sqlite } = getDatabase();
  // state는 성공·실패와 관계없이 한 번만 쓸 수 있도록 먼저 지운다
  const pending = transactionalMutation(sqlite, () => {
    const row = sqlite.prepare("SELECT * FROM gsc_oauth_states WHERE state_hash = ?").get(sha256(input.state)) as { project_id: number; code_verifier: string; expires_at: string } | undefined;
    if (row) sqlite.prepare("DELETE FROM gsc_oauth_states WHERE state_hash = ?").run(sha256(input.state));
    return row;
  });
  if (!pending) throw new AppError("연결 요청을 확인할 수 없습니다. 다시 연결을 시작하세요.", 400, "GSC_STATE_INVALID");
  if (Date.parse(pending.expires_at) < Date.now()) throw new AppError("연결 요청이 만료되었습니다. 다시 연결을 시작하세요.", 400, "GSC_STATE_EXPIRED");
  const verifier = decryptSecret(pending.code_verifier);
  if (!verifier) throw new AppError("연결 요청을 확인할 수 없습니다. 다시 연결을 시작하세요.", 400, "GSC_STATE_INVALID");
  const token = await exchangeCode(settings, input.code, verifier);
  if (!token.scope.split(" ").includes(GSC_SCOPE)) throw new AppError("Search Console 읽기 권한이 승인되지 않았습니다. 동의 화면에서 권한을 허용하세요.", 403, "GSC_SCOPE_NOT_GRANTED");
  if (!token.refreshToken) throw new AppError("Google이 갱신 토큰을 주지 않았습니다. Google 계정의 앱 권한에서 GEO Master를 삭제한 뒤 다시 연결하세요.", 502, "GSC_NO_REFRESH_TOKEN");
  const existing = connectionOf(pending.project_id);
  const now = new Date().toISOString();
  if (existing) {
    updateConnection(existing.id, { status: "connected", refresh_token: encryptSecret(token.refreshToken), granted_scope: GSC_SCOPE, last_error: null });
  } else {
    sqlite.prepare("INSERT INTO gsc_connections (project_id, site_url, status, refresh_token, granted_scope, created_at, updated_at) VALUES (?, '', 'connected', ?, ?, ?, ?)")
      .run(pending.project_id, encryptSecret(token.refreshToken), GSC_SCOPE, now, now);
  }
}

async function accessToken() {
  const settings = requireConfig();
  const active = requireActiveProject();
  const row = connectionOf(active.id);
  const refresh = row?.refresh_token ? decryptSecret(row.refresh_token) : null;
  if (!row || !refresh || row.status === "disconnected") throw new AppError("Search Console API가 연결되지 않았습니다.", 409, "GSC_NOT_CONNECTED");
  try {
    return { row, token: await refreshAccessToken(settings, refresh) };
  } catch (error) {
    if (error instanceof AppError && error.code === "GSC_TOKEN_INVALID") updateConnection(row.id, { status: "error", last_error: error.code });
    throw error;
  }
}

/** 확인된 속성만 돌려준다. 계정에 속성이 하나도 없으면 오류가 아니라 no_properties */
export async function listGscSites() {
  const { token } = await accessToken();
  const sites = (await listSites(token)).filter((site) => site.permissionLevel !== "siteUnverifiedUser");
  return { state: sites.length ? "ok" as const : "no_properties" as const, sites };
}

export async function selectGscSite(siteUrlInput: unknown) {
  const siteUrl = z.string().trim().min(1).max(300).parse(siteUrlInput);
  const { row, token } = await accessToken();
  const sites = (await listSites(token)).filter((site) => site.permissionLevel !== "siteUnverifiedUser");
  if (!sites.some((site) => site.siteUrl === siteUrl)) throw new AppError("이 계정에서 확인된 속성이 아닙니다.", 403, "GSC_PROPERTY_NOT_ACCESSIBLE");
  updateConnection(row.id, { site_url: siteUrl, last_error: null });
}

function validDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
}

const rangeSchema = z.object({
  startDate: z.string().refine(validDate, "올바른 날짜(YYYY-MM-DD)가 아닙니다."),
  endDate: z.string().refine(validDate, "올바른 날짜(YYYY-MM-DD)가 아닙니다."),
}).strict().refine((value) => value.startDate <= value.endDate, "시작일이 종료일보다 늦습니다.")
  .refine((value) => (Date.parse(value.endDate) - Date.parse(value.startDate)) / 86_400_000 <= MAX_RANGE_DAYS, "기간은 Search Console 보관 기간(약 16개월) 이내여야 합니다.");

/** 날짜별 성과를 읽어 저장한다. 응답에 행이 없으면 no_rows로 남기고 0으로 채우지 않는다 */
export async function syncGscPerformance(input: unknown) {
  const range = rangeSchema.parse(input);
  const { row, token } = await accessToken();
  if (!row.site_url) throw new AppError("먼저 Search Console 속성을 선택하세요.", 409, "GSC_PROPERTY_NOT_SELECTED");
  const { sqlite } = getDatabase();
  const fetchedAt = new Date().toISOString();
  const insertSync = (status: string, rowCount: number, aggregation: string | null, errorCode: string | null) => Number(sqlite.prepare(`
    INSERT INTO gsc_api_syncs (project_id, site_url, start_date, end_date, data_state, search_type, aggregation, timezone, row_count, status, error_code, fetched_at)
    VALUES (?, ?, ?, ?, 'final', 'web', ?, ?, ?, ?, ?, ?)
  `).run(row.project_id, row.site_url, range.startDate, range.endDate, aggregation, TIMEZONE, rowCount, status, errorCode, fetchedAt).lastInsertRowid);
  let result: Awaited<ReturnType<typeof querySearchAnalytics>>;
  try {
    result = await querySearchAnalytics(token, row.site_url, { startDate: range.startDate, endDate: range.endDate, dimensions: ["date"], type: "web", dataState: "final", rowLimit: 25_000 });
  } catch (error) {
    const code = error instanceof AppError ? error.code : "GSC_API_ERROR";
    insertSync("error", 0, null, code);
    updateConnection(row.id, code === "GSC_TOKEN_INVALID" ? { status: "error", last_error: code } : { last_error: code });
    throw error;
  }
  const daily = result.rows.filter((item) => typeof item.keys?.[0] === "string" && validDate(item.keys[0]))
    .map((item) => ({ date: item.keys![0]!, clicks: item.clicks, impressions: item.impressions, ctr: item.ctr, position: item.position }));
  const syncId = transactionalMutation(sqlite, () => {
    const id = insertSync(daily.length ? "ok" : "no_rows", daily.length, result.aggregation, null);
    const insert = sqlite.prepare("INSERT INTO gsc_api_daily (sync_id, date, clicks, impressions, ctr, position) VALUES (?, ?, ?, ?, ?, ?)");
    for (const item of daily) insert.run(id, item.date, item.clicks, item.impressions, item.ctr, item.position);
    return id;
  });
  updateConnection(row.id, { last_synced_at: fetchedAt, last_error: null });
  return { ...toSync(sqlite.prepare("SELECT * FROM gsc_api_syncs WHERE id = ?").get(syncId) as SyncRow), daily };
}

export function getLatestGscSync() {
  const active = requireActiveProject();
  const { sqlite } = getDatabase();
  const row = sqlite.prepare("SELECT * FROM gsc_api_syncs WHERE project_id = ? AND status != 'error' ORDER BY id DESC LIMIT 1").get(active.id) as SyncRow | undefined;
  if (!row) return null;
  const daily = sqlite.prepare("SELECT date, clicks, impressions, ctr, position FROM gsc_api_daily WHERE sync_id = ? ORDER BY date").all(row.id);
  return { ...toSync(row), daily };
}

export async function disconnectGsc() {
  const active = requireActiveProject();
  const row = connectionOf(active.id);
  if (!row) return;
  const refresh = row.refresh_token ? decryptSecret(row.refresh_token) : null;
  if (refresh) await revokeToken(refresh);
  updateConnection(row.id, { status: "disconnected", refresh_token: null, granted_scope: null, site_url: "", last_error: null });
}
