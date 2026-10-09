import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE as disconnectRoute, GET as statusRoute } from "@/app/api/integrations/gsc/route";
import { GET as callbackRoute } from "@/app/api/integrations/gsc/callback/route";
import { GET as startRoute } from "@/app/api/integrations/gsc/start/route";
import { canAccessPath } from "@/lib/account-policy";
import { closeDatabase, getDatabase } from "@/lib/db";
import {
  completeGscOAuth, disconnectGsc, getGscStatus, listGscSites, selectGscSite, startGscOAuth, syncGscPerformance,
} from "@/lib/gsc-api/store";
import { ensureActiveProject } from "@/lib/projects";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-gsc-api-"));
const databasePath = path.join(dir, "geo.db");
const saved = { db: process.env.GEO_DB_PATH, key: process.env.GEO_MASTER_KEY, id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET, redirect: process.env.GSC_REDIRECT_URI };
const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const REFRESH = "1//refresh-token-that-must-be-encrypted";

type Handler = (url: URL, init: RequestInit) => { status: number; body: unknown };
let handler: Handler;
const calls: Array<{ url: URL; body: string }> = [];
const json = (status: number, body: unknown) => ({ status, body });

function google(overrides: Partial<Record<"token" | "sites" | "query" | "revoke", () => { status: number; body: unknown }>> = {}): Handler {
  return (url, init) => {
    if (url.href === "https://oauth2.googleapis.com/token") {
      const params = new URLSearchParams(String(init.body));
      if (overrides.token) return overrides.token();
      if (params.get("grant_type") === "authorization_code") return json(200, { access_token: "access-1", refresh_token: REFRESH, scope: SCOPE, expires_in: 3599 });
      return json(200, { access_token: "access-2", scope: SCOPE, expires_in: 3599 });
    }
    if (url.href === "https://www.googleapis.com/webmasters/v3/sites") return overrides.sites?.() ?? json(200, { siteEntry: [{ siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" }, { siteUrl: "https://unverified.example/", permissionLevel: "siteUnverifiedUser" }] });
    if (url.pathname.endsWith("/searchAnalytics/query")) return overrides.query?.() ?? json(200, {
      rows: [{ keys: ["2026-10-01"], clicks: 3, impressions: 120, ctr: 0.025, position: 8.4 }, { keys: ["2026-10-02"], clicks: 0, impressions: 40, ctr: 0, position: 11 }],
      responseAggregationType: "byProperty",
    });
    if (url.href.startsWith("https://oauth2.googleapis.com/revoke")) return overrides.revoke?.() ?? json(200, {});
    return json(404, { error: "unexpected" });
  };
}

beforeAll(() => {
  process.env.GEO_DB_PATH = databasePath;
  process.env.GEO_MASTER_KEY = "gsc-api-master-key-with-32-characters-xxx";
  ensureActiveProject();
});
beforeEach(() => {
  process.env.GOOGLE_CLIENT_ID = "client-id.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "client-secret";
  process.env.GSC_REDIRECT_URI = "http://localhost:3000/api/integrations/gsc/callback";
  calls.length = 0;
  handler = google();
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, body: String(init.body ?? "") });
    const result = handler(url, init);
    return new Response(JSON.stringify(result.body), { status: result.status, headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });
afterAll(() => {
  closeDatabase(databasePath);
  fs.rmSync(dir, { recursive: true, force: true });
  const restore = (key: string, value: string | undefined) => { if (value === undefined) delete process.env[key]; else process.env[key] = value; };
  restore("GEO_DB_PATH", saved.db); restore("GEO_MASTER_KEY", saved.key); restore("GOOGLE_CLIENT_ID", saved.id); restore("GOOGLE_CLIENT_SECRET", saved.secret); restore("GSC_REDIRECT_URI", saved.redirect);
});

function startAndGetState() {
  const url = new URL(startGscOAuth());
  return { url, state: url.searchParams.get("state")! };
}

describe("GSC OAuth (read-only)", () => {
  it("reports 'not configured' instead of failing silently when env vars are missing", () => {
    delete process.env.GOOGLE_CLIENT_SECRET;
    expect(() => startGscOAuth()).toThrow(expect.objectContaining({ code: "GSC_NOT_CONFIGURED", status: 503 }));
    expect(getGscStatus()).toMatchObject({ configured: false, state: "not_configured" });
  });

  it("builds a PKCE consent URL for the read-only scope and stores only a hash of the state", () => {
    expect(getGscStatus()).toMatchObject({ configured: true, state: "not_connected" });
    const { url, state } = startAndGetState();
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: "client-id.apps.googleusercontent.com", redirect_uri: "http://localhost:3000/api/integrations/gsc/callback",
      response_type: "code", scope: SCOPE, access_type: "offline", prompt: "consent", code_challenge_method: "S256",
    });
    expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stored = getDatabase().sqlite.prepare("SELECT state_hash FROM gsc_oauth_states").all() as Array<{ state_hash: string }>;
    expect(stored.map((row) => row.state_hash)).toContain(createHash("sha256").update(state).digest("hex"));
    expect(JSON.stringify(stored)).not.toContain(state);
  });

  it("rejects unknown, reused and expired states", async () => {
    await expect(completeGscOAuth({ code: "c", state: "unknown" })).rejects.toMatchObject({ code: "GSC_STATE_INVALID" });
    const { state } = startAndGetState();
    getDatabase().sqlite.prepare("UPDATE gsc_oauth_states SET expires_at = '2000-01-01T00:00:00.000Z'").run();
    await expect(completeGscOAuth({ code: "c", state })).rejects.toMatchObject({ code: "GSC_STATE_EXPIRED" });
    await expect(completeGscOAuth({ code: "c", state })).rejects.toMatchObject({ code: "GSC_STATE_INVALID" });
  });

  it("refuses a grant without the read-only scope and stores nothing", async () => {
    handler = google({ token: () => json(200, { access_token: "a", refresh_token: REFRESH, scope: "openid", expires_in: 1 }) });
    const { state } = startAndGetState();
    await expect(completeGscOAuth({ code: "c", state })).rejects.toMatchObject({ code: "GSC_SCOPE_NOT_GRANTED" });
    expect(getGscStatus().state).toBe("not_connected");
  });

  it("connects with PKCE, keeps the refresh token encrypted at rest and never returns it", async () => {
    const { state } = startAndGetState();
    await completeGscOAuth({ code: "auth-code", state });
    const exchange = new URLSearchParams(calls.find((call) => call.url.href === "https://oauth2.googleapis.com/token")!.body);
    expect(exchange.get("code")).toBe("auth-code");
    expect(exchange.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    const status = getGscStatus();
    expect(status).toMatchObject({ configured: true, state: "connected", siteUrl: null });
    expect(JSON.stringify(status)).not.toContain(REFRESH);
    closeDatabase(databasePath);
    expect(fs.readFileSync(databasePath).includes(Buffer.from(REFRESH))).toBe(false);
    ensureActiveProject();
  });
});

describe("GSC properties and performance", () => {
  it("lists only verified properties and distinguishes an account with no properties", async () => {
    expect(await listGscSites()).toEqual({ state: "ok", sites: [{ siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" }] });
    handler = google({ sites: () => json(200, {}) });
    expect(await listGscSites()).toEqual({ state: "no_properties", sites: [] });
  });

  it("only allows selecting an accessible property", async () => {
    await expect(selectGscSite("https://unverified.example/")).rejects.toMatchObject({ code: "GSC_PROPERTY_NOT_ACCESSIBLE" });
    await selectGscSite("sc-domain:example.com");
    expect(getGscStatus()).toMatchObject({ state: "connected", siteUrl: "sc-domain:example.com" });
  });

  it("stores daily rows with the API's aggregation, data state and timezone", async () => {
    const sync = await syncGscPerformance({ startDate: "2026-10-01", endDate: "2026-10-03" });
    expect(sync).toMatchObject({ status: "ok", rowCount: 2, siteUrl: "sc-domain:example.com", aggregation: "byProperty", dataState: "final", timezone: "America/Los_Angeles" });
    expect(sync.daily).toEqual([
      { date: "2026-10-01", clicks: 3, impressions: 120, ctr: 0.025, position: 8.4 },
      { date: "2026-10-02", clicks: 0, impressions: 40, ctr: 0, position: 11 },
    ]);
    const query = JSON.parse(calls.find((call) => call.url.pathname.endsWith("/searchAnalytics/query"))!.body);
    expect(query).toMatchObject({ startDate: "2026-10-01", endDate: "2026-10-03", dimensions: ["date"], dataState: "final" });
    expect(calls.find((call) => call.url.pathname.endsWith("/searchAnalytics/query"))!.url.pathname).toContain(encodeURIComponent("sc-domain:example.com"));
  });

  it("records an empty response as 'no rows', not as zero performance", async () => {
    handler = google({ query: () => json(200, { responseAggregationType: "byProperty" }) });
    const sync = await syncGscPerformance({ startDate: "2026-10-04", endDate: "2026-10-05" });
    expect(sync).toMatchObject({ status: "no_rows", rowCount: 0, daily: [] });
  });

  it("separates permission errors and expired grants from empty data", async () => {
    handler = google({ query: () => json(403, { error: { code: 403, message: "User does not have sufficient permission" } }) });
    await expect(syncGscPerformance({ startDate: "2026-10-01", endDate: "2026-10-02" })).rejects.toMatchObject({ code: "GSC_PERMISSION_DENIED" });
    expect(getGscStatus()).toMatchObject({ state: "connected", lastError: "GSC_PERMISSION_DENIED" });
    handler = google({ token: () => json(400, { error: "invalid_grant" }) });
    await expect(listGscSites()).rejects.toMatchObject({ code: "GSC_TOKEN_INVALID" });
    expect(getGscStatus()).toMatchObject({ state: "error", lastError: "GSC_TOKEN_INVALID" });
  });

  it("validates the date range before calling Google", async () => {
    const before = calls.length;
    await expect(syncGscPerformance({ startDate: "2026-10-05", endDate: "2026-10-01" })).rejects.toBeTruthy();
    await expect(syncGscPerformance({ startDate: "2026-02-30", endDate: "2026-03-01" })).rejects.toBeTruthy();
    await expect(syncGscPerformance({ startDate: "2024-01-01", endDate: "2026-10-01" })).rejects.toBeTruthy();
    expect(calls.length).toBe(before);
  });

  it("disconnects by revoking the grant and deleting the stored token", async () => {
    const { state } = startAndGetState();
    await completeGscOAuth({ code: "again", state });
    await disconnectGsc();
    expect(calls.some((call) => call.url.href.startsWith("https://oauth2.googleapis.com/revoke"))).toBe(true);
    expect(getGscStatus()).toMatchObject({ state: "not_connected", siteUrl: null });
    await expect(listGscSites()).rejects.toMatchObject({ code: "GSC_NOT_CONNECTED" });
  });
});

describe("GSC OAuth routes", () => {
  it("redirects to Google from /start and back to the app from /callback", async () => {
    const start = startRoute(new NextRequest("http://localhost:3000/api/integrations/gsc/start"));
    expect(start.status).toBe(302);
    const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
    const ok = await callbackRoute(new NextRequest(`http://localhost:3000/api/integrations/gsc/callback?code=x&state=${state}`));
    expect(ok.status).toBe(302);
    expect(new URL(ok.headers.get("location")!).pathname + new URL(ok.headers.get("location")!).search).toBe("/search-console?gsc=connected");
    const denied = await callbackRoute(new NextRequest("http://localhost:3000/api/integrations/gsc/callback?error=access_denied&state=zzz"));
    expect(new URL(denied.headers.get("location")!).search).toBe("?gsc=error&reason=access_denied");
    const bad = await callbackRoute(new NextRequest("http://localhost:3000/api/integrations/gsc/callback?code=x&state=nope"));
    expect(new URL(bad.headers.get("location")!).search).toBe("?gsc=error&reason=GSC_STATE_INVALID");
  });

  it("is not available to guests", () => {
    for (const path of ["/api/integrations/gsc", "/api/integrations/gsc/start", "/api/integrations/gsc/callback"]) expect(canAccessPath("guest", path)).toBe(false);
  });
});


describe("GSC review regressions", () => {
  beforeEach(async () => {
    const { state } = startAndGetState();
    await completeGscOAuth({ code: "fake-code", state });
    await selectGscSite("sc-domain:example.com");
  });

  it("persists quota failures with the correct sync and connection error codes", async () => {
    handler = google({ query: () => json(403, { error: { errors: [{ reason: "quotaExceeded" }] } }) });
    await expect(syncGscPerformance({ startDate: "2026-10-01", endDate: "2026-10-02" })).rejects.toMatchObject({ code: "GSC_RATE_LIMITED", status: 429 });
    expect(getGscStatus()).toMatchObject({ state: "connected", lastError: "GSC_RATE_LIMITED", latestSync: { status: "error", errorCode: "GSC_RATE_LIMITED" } });
  });

  it.each([400, 503, "network"])("deletes local credentials but reports and preserves remote revocation failure: %s", async (failure) => {
    handler = google({ revoke: () => {
      if (failure === "network") throw new Error("fake-private-network-details");
      return json(Number(failure), { error: "fake-private-response" });
    } });
    const response = await disconnectRoute();
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body).toMatchObject({ code: "GSC_REVOCATION_FAILED" });
    expect(body.error).toContain("로컬 연결과 저장된 토큰은 삭제");
    expect(JSON.stringify(body).includes("fake-private")).toBe(false);
    const row = getDatabase().sqlite.prepare("SELECT refresh_token, granted_scope, site_url, status FROM gsc_connections ORDER BY id DESC LIMIT 1").get();
    expect(row).toEqual({ refresh_token: null, granted_scope: null, site_url: "", status: "disconnected" });
    expect((await statusRoute().json()).status).toMatchObject({ state: "not_connected", siteUrl: null, lastError: "GSC_REVOCATION_FAILED" });
    expect((await disconnectRoute()).status).toBe(502);
    expect(getGscStatus().lastError).toBe("GSC_REVOCATION_FAILED");
    await expect(listGscSites()).rejects.toMatchObject({ code: "GSC_NOT_CONNECTED" });
  });

  it("returns success only after confirmed remote revocation", async () => {
    expect((await disconnectRoute()).status).toBe(204);
    expect(getGscStatus()).toMatchObject({ state: "not_connected", lastError: null });
  });

  it.each([false, true])("requires property reselection after replacing the grant (shared old property: %s)", async (sharedOldProperty) => {
    await syncGscPerformance({ startDate: "2026-10-01", endDate: "2026-10-02" });
    const newSite = "sc-domain:new-account.example";
    handler = google({
      token: () => json(200, { access_token: "fake-new-access", refresh_token: "fake-new-refresh", scope: SCOPE }),
      sites: () => json(200, { siteEntry: [
        { siteUrl: newSite, permissionLevel: "siteOwner" },
        ...(sharedOldProperty ? [{ siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" }] : []),
      ] }),
    });
    const { state } = startAndGetState();
    await completeGscOAuth({ code: "fake-new-account-code", state });
    expect(getGscStatus()).toMatchObject({ state: "connected", siteUrl: null, lastSyncedAt: null, lastError: null });
    calls.length = 0;
    await expect(syncGscPerformance({ startDate: "2026-10-01", endDate: "2026-10-02" })).rejects.toMatchObject({ code: "GSC_PROPERTY_NOT_SELECTED" });
    expect(calls.some((call) => call.url.pathname.endsWith("/searchAnalytics/query"))).toBe(false);
    expect((await listGscSites()).sites.some((site) => site.siteUrl === newSite)).toBe(true);
    if (!sharedOldProperty) await expect(selectGscSite("sc-domain:example.com")).rejects.toMatchObject({ code: "GSC_PROPERTY_NOT_ACCESSIBLE" });
    await selectGscSite(newSite);
    expect(await syncGscPerformance({ startDate: "2026-10-01", endDate: "2026-10-02" })).toMatchObject({ siteUrl: newSite, status: "ok" });
  });
});
