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
import { fetchPublicText } from "@/lib/url-security";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "geo-site-audit-honesty-"));
const databasePath = path.join(directory, "test.db");
const request = vi.fn();
let sequence = 0;
const mapResponse = () => Response.json({ success: true, links: ["https://example.com", "https://example.com/about", "https://example.com/blog/post-1"] });
const fetched = (status: number, text: string, contentType = "text/plain") => ({ url: "https://example.com/llms.txt", status, text, contentType });

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
  it("stores discovered URLs as unmeasured and does not invent a health score", async () => {
    request.mockImplementation(mapResponse);
    vi.mocked(fetchPublicText).mockResolvedValue(fetched(200, "# Example\n> 소개\n- [홈](https://example.com)"));
    const campaign = createSiteAuditCampaign({ name: "QA", domain: "example.com" });
    const result = await runSiteAuditCampaign(campaign.id);
    expect(result).toMatchObject({ discoveredUrls: 3, siteHealth: null, dataState: "discovered", llmsTxtState: "present" });
    const pages = getDatabase().sqlite.prepare("SELECT url, status_code, fetch_state, depth FROM site_audit_pages WHERE campaign_id = ? ORDER BY url").all(campaign.id);
    expect(pages).toEqual([
      { url: "https://example.com", status_code: 0, fetch_state: "discovered", depth: 0 },
      { url: "https://example.com/about", status_code: 0, fetch_state: "discovered", depth: 1 },
      { url: "https://example.com/blog/post-1", status_code: 0, fetch_state: "discovered", depth: 2 },
    ]);
    const overview = getSiteAuditOverview(campaign.id);
    expect(overview.briefing).toMatchObject({ score: null, dataState: "discovered", llmsTxtState: "present", hasLlmsTxt: true });
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
