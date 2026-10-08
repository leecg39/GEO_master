import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/url-security", async () => {
  const actual = await vi.importActual<typeof import("@/lib/url-security")>("@/lib/url-security");
  return { ...actual, fetchPublicText: vi.fn() };
});

import { applyDatabaseMigrations, closeDatabase, DATABASE_MIGRATIONS, getDatabase } from "@/lib/db";
import { createProject, ensureActiveProject } from "@/lib/projects";
import { confirmSemforgePayment, createSemforgeCheckout } from "@/lib/semforge-subscription";
import { createSiteAuditCampaign, getSiteAuditOverview, probeLlmsTxt, runSiteAuditCampaign, urlPathDepth } from "@/lib/semforge/siteaudit";
import { AppError } from "@/lib/errors";
import { fetchPublicText } from "@/lib/url-security";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "geo-site-audit-honesty-"));
const databasePath = path.join(directory, "test.db");
const request = vi.fn();
let sequence = 0;
const mapResponse = () => Response.json({ success: true, links: ["https://example.com", "https://example.com/about", "https://example.com/blog/post-1"] });
const fetched = (status: number, text: string, contentType = "text/plain") => ({ url: "https://example.com/llms.txt", status, text, contentType });
const llms404 = (url: string) => ({ url, status: 404, text: "", contentType: "text/plain" });
const isSiteFile = (url: string) => url.endsWith("/llms.txt") || url.endsWith("/robots.txt");

beforeEach(() => {
  vi.stubEnv("GEO_DB_PATH", databasePath);
  vi.stubEnv("GEO_AUTH_MODE", "local");
  vi.stubEnv("SEMFORGE_BILLING_MODE", "dev");
  vi.stubEnv("FIRECRAWL_API_KEY", "test-firecrawl-key");
  vi.stubGlobal("fetch", request.mockReset());
  vi.mocked(fetchPublicText).mockReset();
  const db = getDatabase().sqlite;
  db.exec("DELETE FROM semforge_payment_intents; DELETE FROM semforge_subscriptions;");
  ensureActiveProject();
  createProject({ name: `Honesty ${++sequence}`, brandName: "QA", category: "AI", competitors: [], activate: true });
  const checkout = createSemforgeCheckout();
  confirmSemforgePayment({ orderId: checkout.orderId, confirmToken: checkout.devConfirmToken });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
afterAll(() => { closeDatabase(databasePath); fs.rmSync(directory, { recursive: true, force: true }); });

describe("Qshop P01: Map-only discovery is not reported as a measured crawl", () => {
  it("stores discovered URLs as unmeasured and does not invent a health score when pages are not requested (demo mode)", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "");
    vi.stubEnv("SEMFORGE_MOCK_FIRECRAWL", "1");
    const campaign = createSiteAuditCampaign({ name: "QA", domain: "example.com" });
    const result = await runSiteAuditCampaign(campaign.id);
    expect(result).toMatchObject({ discoveredUrls: 6, siteHealth: null, dataState: "discovered", llmsTxtState: "unknown", fetchedPages: 0 });
    expect(vi.mocked(fetchPublicText)).not.toHaveBeenCalled();
    const pages = getDatabase().sqlite.prepare("SELECT DISTINCT status_code, fetch_state FROM site_audit_pages WHERE campaign_id = ?").all(campaign.id);
    expect(pages).toEqual([{ status_code: 0, fetch_state: "discovered" }]);
    const depths = getDatabase().sqlite.prepare("SELECT url, depth FROM site_audit_pages WHERE campaign_id = ? AND url IN ('https://example.com', 'https://example.com/about')").all(campaign.id);
    expect(depths).toEqual(expect.arrayContaining([{ url: "https://example.com", depth: 0 }, { url: "https://example.com/about", depth: 1 }]));
    const overview = getSiteAuditOverview(campaign.id);
    expect(overview.briefing).toMatchObject({ score: null, dataState: "discovered", measured: null });
    expect(overview.briefing.grade.label).toBe("미측정");
    expect(overview.briefing.scoreFactors).toEqual([]);
  });

  it("reports llms.txt absence only from a real 404, not from the sitemap list", async () => {
    request.mockImplementation(mapResponse);
    vi.mocked(fetchPublicText).mockResolvedValue(fetched(404, "not found", "text/html"));
    const campaign = createSiteAuditCampaign({ name: "QA", domain: "example.com" });
    await runSiteAuditCampaign(campaign.id);
    const issues = getDatabase().sqlite.prepare("SELECT title, detail FROM site_audit_issues WHERE campaign_id = ?").all(campaign.id) as { title: string; detail: string }[];
    expect(issues.find((issue) => issue.title.includes("llms.txt"))?.detail).toContain("HTTP 404");
  });

  it("marks llms.txt as unknown when the probe fails instead of claiming it is missing", async () => {
    request.mockImplementation(mapResponse);
    vi.mocked(fetchPublicText).mockRejectedValue(new Error("network down"));
    const campaign = createSiteAuditCampaign({ name: "QA", domain: "example.com" });
    const result = await runSiteAuditCampaign(campaign.id);
    expect(result.llmsTxtState).toBe("unknown");
    const issues = getDatabase().sqlite.prepare("SELECT severity, title FROM site_audit_issues WHERE campaign_id = ?").all(campaign.id) as { severity: string; title: string }[];
    expect(issues.find((issue) => issue.title.includes("llms.txt"))).toMatchObject({ severity: "notice", title: expect.stringContaining("확인 불가") });
  });
});

describe("llms.txt probe and URL depth", () => {
  it("treats an HTML soft-404 as missing", async () => {
    vi.mocked(fetchPublicText).mockResolvedValue(fetched(200, "<!doctype html><html><body>페이지 없음</body></html>", "text/html"));
    expect(await probeLlmsTxt("example.com")).toMatchObject({ state: "missing" });
  });

  it("measures depth from URL path segments", () => {
    expect(urlPathDepth("https://example.com")).toBe(0);
    expect(urlPathDepth("https://example.com/")).toBe(0);
    expect(urlPathDepth("https://example.com/a/b/c?x=1")).toBe(3);
  });
});

describe("migration 17: legacy estimates are isolated", () => {
  it("labels previously stored Map-only rows as legacy estimates", () => {
    const sqlite = new Database(":memory:");
    sqlite.exec(`
      CREATE TABLE site_audit_campaigns (id INTEGER PRIMARY KEY, site_health INTEGER, last_run_at TEXT);
      CREATE TABLE site_audit_pages (id INTEGER PRIMARY KEY, campaign_id INTEGER, status_code INTEGER NOT NULL DEFAULT 0);
      INSERT INTO site_audit_campaigns (id, site_health, last_run_at) VALUES (1, 84, '2026-09-01'), (2, NULL, NULL);
      INSERT INTO site_audit_pages (campaign_id, status_code) VALUES (1, 200);
    `);
    applyDatabaseMigrations(sqlite, DATABASE_MIGRATIONS.filter(({ version }) => version === 17));
    expect(sqlite.prepare("SELECT id, data_state, site_health FROM site_audit_campaigns ORDER BY id").all()).toEqual([
      { id: 1, data_state: "legacy_estimate", site_health: 84 },
      { id: 2, data_state: "none", site_health: null },
    ]);
    expect(sqlite.prepare("SELECT fetch_state FROM site_audit_pages").get()).toEqual({ fetch_state: "legacy_estimate" });
    sqlite.close();
  });
});

describe("Qshop P02: discovered URLs are actually fetched", () => {
  function routeFetch(url: string) {
    if (url.endsWith("/llms.txt")) return Promise.resolve({ url, status: 200, text: "# Example", contentType: "text/plain" });
    if (url.endsWith("/about")) return Promise.resolve({ url: "https://example.com/about-us", status: 200, text: "<html><head><title>회사 소개</title></head><body>본문</body></html>", contentType: "text/html" });
    if (url.endsWith("/blog/post-1")) return Promise.resolve({ url, status: 404, text: "<html><title>없음</title></html>", contentType: "text/html" });
    if (url === "https://example.com") return Promise.resolve({ url: "https://example.com/", status: 200, text: "<html><body>제목 없음</body></html>", contentType: "text/html" });
    return Promise.reject(new Error("blocked"));
  }

  it("stores real status, title, final URL and hash, and keeps failures out of the success denominator", async () => {
    request.mockImplementation(() => Response.json({ success: true, links: ["https://example.com", "https://example.com/about", "https://example.com/blog/post-1", "https://other.example.net/x", "https://example.com/down"] }));
    vi.mocked(fetchPublicText).mockImplementation((url: string) => routeFetch(url));
    const campaign = createSiteAuditCampaign({ name: "QA", domain: "example.com" });
    const result = await runSiteAuditCampaign(campaign.id);
    expect(result).toMatchObject({ status: "partial", dataState: "measured", fetchedPages: 3, failedPages: 1, outOfScope: 1, siteHealth: null });
    const rows = getDatabase().sqlite.prepare("SELECT url, status_code, fetch_state, title, final_url, render_mode, content_hash IS NOT NULL AS hashed FROM site_audit_pages WHERE campaign_id = ? ORDER BY url").all(campaign.id);
    expect(rows).toEqual([
      { url: "https://example.com", status_code: 200, fetch_state: "fetched", title: null, final_url: "https://example.com/", render_mode: "native", hashed: 1 },
      { url: "https://example.com/about", status_code: 200, fetch_state: "fetched", title: "회사 소개", final_url: "https://example.com/about-us", render_mode: "native", hashed: 1 },
      { url: "https://example.com/blog/post-1", status_code: 404, fetch_state: "fetched", title: "없음", final_url: "https://example.com/blog/post-1", render_mode: "native", hashed: 1 },
      { url: "https://example.com/down", status_code: 0, fetch_state: "failed", title: null, final_url: null, render_mode: "native", hashed: 0 },
      { url: "https://other.example.net/x", status_code: 0, fetch_state: "out_of_scope", title: null, final_url: null, render_mode: null, hashed: 0 },
    ]);
    const issues = getDatabase().sqlite.prepare("SELECT title FROM site_audit_issues WHERE campaign_id = ?").all(campaign.id).map((row) => (row as { title: string }).title);
    expect(issues).toEqual(expect.arrayContaining(["HTTP 404 응답", "제목(title) 없음", "페이지 요청 실패"]));
    const briefing = getSiteAuditOverview(campaign.id).briefing;
    expect(briefing).toMatchObject({ dataState: "measured", score: null, measured: { fetched: 3, failed: 1, ok: 2, missingTitle: 1 } });
    expect(briefing.radar.find((axis) => axis.axis === "정상 응답 비율")).toMatchObject({ score: 67 });
  });

  it("records an off-site redirect as out of scope instead of a measured page", async () => {
    request.mockImplementation(() => Response.json({ success: true, links: ["https://example.com/moved"] }));
    vi.mocked(fetchPublicText).mockImplementation((url: string) => url.endsWith("/llms.txt")
      ? Promise.resolve({ url, status: 404, text: "", contentType: "text/plain" })
      : url.endsWith("/robots.txt") ? Promise.resolve(llms404(url))
      : Promise.resolve({ url: "https://other.example.net/landing", status: 200, text: "<title>남의 사이트</title>", contentType: "text/html" }));
    const campaign = createSiteAuditCampaign({ name: "QA", domain: "example.com" });
    expect(await runSiteAuditCampaign(campaign.id)).toMatchObject({ fetchedPages: 0, outOfScope: 1 });
    expect(getDatabase().sqlite.prepare("SELECT status_code, fetch_state, final_url, title, render_mode FROM site_audit_pages WHERE campaign_id = ?").get(campaign.id))
      .toEqual({ status_code: 200, fetch_state: "out_of_scope", final_url: "https://other.example.net/landing", title: null, render_mode: "native" });
    const titles = getDatabase().sqlite.prepare("SELECT title FROM site_audit_issues WHERE campaign_id = ?").all(campaign.id).map((row) => (row as { title: string }).title);
    expect(titles).toContain("사이트 범위 밖으로 리다이렉트");
  });

  it("parses titles and accepts subdomains as in scope", async () => {
    const { isInScope, extractTitle } = await import("@/lib/semforge/siteaudit/discovery");
    expect(isInScope("https://blog.example.com/a", "example.com")).toBe(true);
    expect(isInScope("https://example.com.evil.net/a", "example.com")).toBe(false);
    expect(isInScope("not a url", "example.com")).toBe(false);
    expect(extractTitle("<html><head><title>  제목  &amp; 부제 </title></head></html>")).toBe("제목 & 부제");
    expect(extractTitle("plain text")).toBeNull();
  });
});

describe("Qshop P02: rate limits, cancellation and repeated runs", () => {
  const pageLinks = (count: number) => Array.from({ length: count }, (_, index) => `https://example.com/p${index}`);
  const pageCalls = () => vi.mocked(fetchPublicText).mock.calls.filter(([url]) => !isSiteFile(String(url))).length;

  it("retries a 429 once, then stops requesting the site and leaves the rest unrequested", async () => {
    request.mockImplementation(() => Response.json({ success: true, links: pageLinks(8) }));
    vi.mocked(fetchPublicText).mockImplementation(async (url: string) => isSiteFile(url)
      ? llms404(url)
      : { url, status: 429, text: "slow down", contentType: "text/plain", retryAfter: "0" });
    const campaign = createSiteAuditCampaign({ name: "QA", domain: "example.com" });
    const result = await runSiteAuditCampaign(campaign.id);
    expect(result).toMatchObject({ status: "partial", halted: "rate_limited", fetchedPages: 0, failedPages: 4, notRequested: 4 });
    expect(pageCalls()).toBe(8);
    const rows = getDatabase().sqlite.prepare("SELECT fetch_state, status_code, COUNT(*) AS count FROM site_audit_pages WHERE campaign_id = ? GROUP BY fetch_state, status_code ORDER BY fetch_state").all(campaign.id);
    expect(rows).toEqual([{ fetch_state: "discovered", status_code: 0, count: 4 }, { fetch_state: "failed", status_code: 429, count: 4 }]);
    const titles = getDatabase().sqlite.prepare("SELECT title FROM site_audit_issues WHERE campaign_id = ?").all(campaign.id).map((row) => (row as { title: string }).title);
    expect(titles).toContain("요청 한도로 수집 중단");
    const briefing = getSiteAuditOverview(campaign.id).briefing;
    expect(briefing.measured).toMatchObject({ fetched: 0, failed: 4, notRequested: 4 });
    expect(briefing.recommendations.join(" ")).not.toContain("발견 URL이 적습니다");
    expect(briefing.recommendations.join(" ")).toContain("수집이 중간에 멈췄습니다");
  });

  it("keeps a page that succeeds on the retry after a 429", async () => {
    request.mockImplementation(() => Response.json({ success: true, links: ["https://example.com"] }));
    let attempts = 0;
    vi.mocked(fetchPublicText).mockImplementation(async (url: string) => {
      if (isSiteFile(url)) return llms404(url);
      attempts += 1;
      return attempts === 1
        ? { url, status: 429, text: "", contentType: "text/plain", retryAfter: "0" }
        : { url, status: 200, text: "<title>홈</title>", contentType: "text/html" };
    });
    const campaign = createSiteAuditCampaign({ name: "QA", domain: "example.com" });
    expect(await runSiteAuditCampaign(campaign.id)).toMatchObject({ status: "completed", halted: null, fetchedPages: 1, failedPages: 0 });
  });

  it("blocks a second run while one is in progress, cancels on request and keeps the pages already measured", async () => {
    const { cancelSiteAuditCampaign, deleteSiteAuditCampaign } = await import("@/lib/semforge/siteaudit");
    request.mockImplementation(() => Response.json({ success: true, links: pageLinks(10) }));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(fetchPublicText).mockImplementation(async (url: string) => {
      if (isSiteFile(url)) return llms404(url);
      await gate;
      return { url, status: 200, text: "<title>페이지</title>", contentType: "text/html" };
    });
    const campaign = createSiteAuditCampaign({ name: "QA", domain: "example.com" });
    expect(() => cancelSiteAuditCampaign(campaign.id)).toThrow(expect.objectContaining({ code: "SITE_AUDIT_NOT_RUNNING" }));
    const running = runSiteAuditCampaign(campaign.id);
    await vi.waitFor(() => expect(pageCalls()).toBe(4));
    await expect(runSiteAuditCampaign(campaign.id)).rejects.toMatchObject({ status: 409, code: "SITE_AUDIT_RUNNING" });
    expect(() => deleteSiteAuditCampaign(campaign.id)).toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
    expect(cancelSiteAuditCampaign(campaign.id)).toMatchObject({ id: campaign.id, cancelRequested: true });
    release();
    const result = await running;
    expect(result).toMatchObject({ status: "cancelled", halted: "cancelled", fetchedPages: 4, notRequested: 6 });
    expect(pageCalls()).toBe(4);
    const notes = getDatabase().sqlite.prepare("SELECT DISTINCT fetch_error FROM site_audit_pages WHERE campaign_id = ? AND fetch_state = 'discovered'").all(campaign.id);
    expect(notes).toEqual([{ fetch_error: expect.stringContaining("취소") }]);
    expect(getDatabase().sqlite.prepare("SELECT status, cancel_requested FROM site_audit_campaigns WHERE id = ?").get(campaign.id)).toEqual({ status: "cancelled", cancel_requested: 0 });
    expect(deleteSiteAuditCampaign(campaign.id)).toMatchObject({ deleted: true });
  });

  it("lets a stale running state from a crashed process be re-run", async () => {
    request.mockImplementation(() => Response.json({ success: true, links: ["https://example.com"] }));
    vi.mocked(fetchPublicText).mockImplementation(async (url: string) => isSiteFile(url) ? llms404(url) : { url, status: 200, text: "<title>홈</title>", contentType: "text/html" });
    const campaign = createSiteAuditCampaign({ name: "QA", domain: "example.com" });
    getDatabase().sqlite.prepare("UPDATE site_audit_campaigns SET status = 'running', updated_at = '2026-01-01T00:00:00.000Z' WHERE id = ?").run(campaign.id);
    expect(await runSiteAuditCampaign(campaign.id)).toMatchObject({ status: "completed" });
  });

  it("shows an abandoned running state as interrupted and lets cancel release it", async () => {
    const { cancelSiteAuditCampaign, listSiteAuditCampaigns } = await import("@/lib/semforge/siteaudit");
    const stale = createSiteAuditCampaign({ name: "Stale", domain: "example.com" });
    const orphan = createSiteAuditCampaign({ name: "Orphan", domain: "example.org" });
    const db = getDatabase().sqlite;
    db.prepare("UPDATE site_audit_campaigns SET status = 'running', updated_at = '2026-01-01T00:00:00.000Z' WHERE id = ?").run(stale.id);
    db.prepare("UPDATE site_audit_campaigns SET status = 'running', updated_at = ? WHERE id = ?").run(new Date().toISOString(), orphan.id);
    expect(listSiteAuditCampaigns().find((item) => item.id === stale.id)?.status).toBe("interrupted");
    expect(getSiteAuditOverview(stale.id).campaign.status).toBe("interrupted");
    // 이 프로세스에서 돌고 있지 않은 실행(서버 재시작 직후)은 취소하면 바로 풀린다
    expect(cancelSiteAuditCampaign(orphan.id)).toMatchObject({ cancelRequested: true, released: true });
    expect(db.prepare("SELECT status FROM site_audit_campaigns WHERE id = ?").get(orphan.id)).toEqual({ status: "cancelled" });
  });

  it("does not label a run cancelled before any page request as measured", async () => {
    const { cancelSiteAuditCampaign } = await import("@/lib/semforge/siteaudit");
    request.mockImplementation(() => Response.json({ success: true, links: pageLinks(3) }));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(fetchPublicText).mockImplementation(async (url: string) => {
      await gate;
      return llms404(url);
    });
    const campaign = createSiteAuditCampaign({ name: "QA", domain: "example.com" });
    const running = runSiteAuditCampaign(campaign.id);
    await vi.waitFor(() => expect(vi.mocked(fetchPublicText)).toHaveBeenCalledTimes(2));
    cancelSiteAuditCampaign(campaign.id);
    release();
    expect(await running).toMatchObject({ status: "cancelled", dataState: "discovered", fetchedPages: 0, notRequested: 3 });
    expect(pageCalls()).toBe(0);
  });

  it("records an in-flight request interrupted by cancel as interrupted, not as never requested", async () => {
    const { cancelSiteAuditCampaign } = await import("@/lib/semforge/siteaudit");
    request.mockImplementation(() => Response.json({ success: true, links: pageLinks(1) }));
    vi.mocked(fetchPublicText).mockImplementation((url: string, _timeout?: number, options?: { signal?: AbortSignal }) => {
      if (isSiteFile(url)) return Promise.resolve(llms404(url));
      return new Promise((_resolve, reject) => options?.signal?.addEventListener("abort", () => reject(new AppError("요청을 취소했습니다.", 409, "FETCH_CANCELLED"))));
    });
    const campaign = createSiteAuditCampaign({ name: "QA", domain: "example.com" });
    const running = runSiteAuditCampaign(campaign.id);
    await vi.waitFor(() => expect(pageCalls()).toBe(1));
    cancelSiteAuditCampaign(campaign.id);
    expect(await running).toMatchObject({ status: "cancelled", notRequested: 1 });
    expect(getDatabase().sqlite.prepare("SELECT fetch_error FROM site_audit_pages WHERE campaign_id = ?").get(campaign.id))
      .toEqual({ fetch_error: expect.stringContaining("요청을 중단") });
  });

  it("does not claim a rendered collection in demo mode", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "");
    vi.stubEnv("SEMFORGE_MOCK_FIRECRAWL", "1");
    const campaign = createSiteAuditCampaign({ name: "QA", domain: "example.com" });
    expect(await runSiteAuditCampaign(campaign.id, { renderMode: "rendered" })).toMatchObject({ renderMode: null, dataState: "discovered" });
  });

  it("allows deleting a partially failed campaign", async () => {
    const { deleteSiteAuditCampaign } = await import("@/lib/semforge/siteaudit");
    const campaign = createSiteAuditCampaign({ name: "QA", domain: "example.com" });
    getDatabase().sqlite.prepare("UPDATE site_audit_campaigns SET status = 'partial' WHERE id = ?").run(campaign.id);
    expect(deleteSiteAuditCampaign(campaign.id)).toMatchObject({ deleted: true });
  });
});

describe("Qshop P02: rendered collection through Firecrawl Scrape", () => {
  const links = Array.from({ length: 12 }, (_, index) => ({ url: index === 0 ? "https://example.com/gone" : `https://example.com/r${index}` }));
  function firecrawl(scrape: (url: string) => Response) {
    return (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/v2/map")) return Promise.resolve(Response.json({ success: true, links }));
      return Promise.resolve(scrape(JSON.parse(String(init?.body)).url as string));
    };
  }

  it("renders at most 10 pages, stores the page's own status and marks the rest unrequested", async () => {
    request.mockImplementation(firecrawl((url) => Response.json({
      success: true,
      data: { rawHtml: `<html><title>${url.split("/").pop()}</title></html>`, markdown: "# 본문", metadata: { statusCode: url.endsWith("/gone") ? 404 : 200, url, sourceURL: url } },
    })));
    vi.mocked(fetchPublicText).mockImplementation(async (url: string) => url.endsWith("/robots.txt") ? llms404(url) : ({ url, status: 200, text: "# llms", contentType: "text/plain" }));
    const campaign = createSiteAuditCampaign({ name: "QA", domain: "example.com" });
    const result = await runSiteAuditCampaign(campaign.id, { renderMode: "rendered" });
    expect(result).toMatchObject({ status: "completed", renderMode: "rendered", fetchedPages: 10, notRequested: 2, halted: null });
    expect(request.mock.calls.filter(([url]) => String(url).endsWith("/v2/scrape"))).toHaveLength(10);
    expect(vi.mocked(fetchPublicText).mock.calls.map(([url]) => url).sort()).toEqual(["https://example.com/llms.txt", "https://example.com/robots.txt"]);
    const gone = getDatabase().sqlite.prepare("SELECT status_code, fetch_state, title, render_mode, content_hash IS NOT NULL AS hashed FROM site_audit_pages WHERE campaign_id = ? AND url = 'https://example.com/gone'").get(campaign.id);
    expect(gone).toEqual({ status_code: 404, fetch_state: "fetched", title: "gone", render_mode: "rendered", hashed: 1 });
    const skipped = getDatabase().sqlite.prepare("SELECT fetch_error FROM site_audit_pages WHERE campaign_id = ? AND fetch_state = 'discovered'").all(campaign.id);
    expect(skipped).toEqual([{ fetch_error: expect.stringContaining("렌더링 수집 한도") }, { fetch_error: expect.stringContaining("렌더링 수집 한도") }]);
  });

  it("stops rendering when Firecrawl credits run out and keeps a contract failure per page", async () => {
    let scrapes = 0;
    request.mockImplementation(firecrawl(() => {
      scrapes += 1;
      if (scrapes === 1) return Response.json({ success: true, data: { metadata: {} } });
      return Response.json({ success: false, error: "Insufficient credits" }, { status: 402 });
    }));
    vi.mocked(fetchPublicText).mockImplementation(async (url: string) => llms404(url));
    const campaign = createSiteAuditCampaign({ name: "QA", domain: "example.com" });
    const result = await runSiteAuditCampaign(campaign.id, { renderMode: "rendered" });
    expect(result).toMatchObject({ status: "partial", halted: "credits_exhausted", fetchedPages: 0 });
    expect(scrapes).toBeLessThanOrEqual(3);
    const errors = getDatabase().sqlite.prepare("SELECT fetch_error FROM site_audit_pages WHERE campaign_id = ? AND fetch_state = 'failed'").all(campaign.id).map((row) => (row as { fetch_error: string }).fetch_error);
    expect(errors.some((error) => error.includes("응답 형식"))).toBe(true);
    expect(errors.some((error) => error.includes("크레딧"))).toBe(true);
    const titles = getDatabase().sqlite.prepare("SELECT title FROM site_audit_issues WHERE campaign_id = ?").all(campaign.id).map((row) => (row as { title: string }).title);
    expect(titles).toContain("Firecrawl 크레딧 부족으로 수집 중단");
  });

  it("rejects unknown run options", async () => {
    const campaign = createSiteAuditCampaign({ name: "QA", domain: "example.com" });
    await expect(runSiteAuditCampaign(campaign.id, { renderMode: "headless-chrome" })).rejects.toThrow();
  });
});

describe("Qshop P04: AI crawler policy from robots.txt", () => {
  const robots = (text: string, status = 200) => (url: string) => {
    if (url.endsWith("/robots.txt")) return Promise.resolve({ url, status, text, contentType: "text/plain" });
    if (url.endsWith("/llms.txt")) return Promise.resolve(llms404(url));
    return Promise.resolve({ url, status: 200, text: "<title>홈</title>", contentType: "text/html" });
  };
  const titles = (campaignId: number) => getDatabase().sqlite.prepare("SELECT severity, title, detail FROM site_audit_issues WHERE campaign_id = ?").all(campaignId) as Array<{ severity: string; title: string; detail: string }>;

  it("reports a training-only block as information, not as an AI search problem", async () => {
    request.mockImplementation(() => Response.json({ success: true, links: ["https://example.com"] }));
    vi.mocked(fetchPublicText).mockImplementation(robots("User-agent: GPTBot\nDisallow: /\n\nUser-agent: Google-Extended\nDisallow: /\n"));
    const campaign = createSiteAuditCampaign({ name: "QA", domain: "example.com" });
    await runSiteAuditCampaign(campaign.id);
    expect(titles(campaign.id).find((issue) => issue.title === "학습용 AI 크롤러만 차단")).toMatchObject({ severity: "notice", detail: expect.stringContaining("GPTBot, Google-Extended") });
    expect(titles(campaign.id).some((issue) => issue.title === "AI 검색 크롤러 차단")).toBe(false);
    expect(getSiteAuditOverview(campaign.id).briefing.robots).toMatchObject({ state: "parsed", summary: { searchBlocked: [], trainingBlocked: ["GPTBot", "Google-Extended"] } });
  });

  it("warns when search crawlers are blocked and recommends reviewing only those", async () => {
    request.mockImplementation(() => Response.json({ success: true, links: ["https://example.com"] }));
    vi.mocked(fetchPublicText).mockImplementation(robots("User-agent: *\nDisallow: /\n\nUser-agent: Googlebot\nAllow: /\n"));
    const campaign = createSiteAuditCampaign({ name: "QA", domain: "example.com" });
    await runSiteAuditCampaign(campaign.id);
    const blocked = titles(campaign.id).find((issue) => issue.title === "AI 검색 크롤러 차단");
    expect(blocked).toMatchObject({ severity: "warning" });
    expect(blocked?.detail).toContain("OAI-SearchBot");
    expect(blocked?.detail).not.toContain("Googlebot");
    expect(getSiteAuditOverview(campaign.id).briefing.recommendations.join(" ")).toContain("검색용 AI 크롤러");
  });

  it("surfaces partially restricted search crawlers in the issue, briefing and recommendation", async () => {
    request.mockImplementation(() => Response.json({ success: true, links: ["https://example.com"] }));
    vi.mocked(fetchPublicText).mockImplementation(robots("User-agent: OAI-SearchBot\nDisallow: /private\n"));
    const campaign = createSiteAuditCampaign({ name: "QA", domain: "example.com" });
    await runSiteAuditCampaign(campaign.id);
    const issue = titles(campaign.id).find((item) => item.title === "AI 검색 크롤러 일부 경로 제한");
    expect(issue).toMatchObject({ severity: "warning", detail: expect.stringContaining("일부 경로 제한: OAI-SearchBot") });
    expect(getSiteAuditOverview(campaign.id).briefing.robots).toMatchObject({
      state: "parsed", summary: { searchBlocked: [], searchPartial: ["OAI-SearchBot"] },
    });
    expect(getSiteAuditOverview(campaign.id).briefing.recommendations.join(" ")).toContain("OAI-SearchBot");
  });

  it("does not treat an unreadable robots.txt as allowing everything", async () => {
    request.mockImplementation(() => Response.json({ success: true, links: ["https://example.com"] }));
    vi.mocked(fetchPublicText).mockImplementation(robots("", 503));
    const campaign = createSiteAuditCampaign({ name: "QA", domain: "example.com" });
    await runSiteAuditCampaign(campaign.id);
    expect(titles(campaign.id).find((issue) => issue.title === "robots.txt 확인 불가")).toMatchObject({ severity: "notice" });
    expect(getSiteAuditOverview(campaign.id).briefing.robots).toMatchObject({ state: "unknown" });
  });
});
