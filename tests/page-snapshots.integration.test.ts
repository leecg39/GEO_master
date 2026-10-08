import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/url-security", async () => {
  const actual = await vi.importActual<typeof import("@/lib/url-security")>("@/lib/url-security");
  return { ...actual, fetchPublicText: vi.fn() };
});

import { closeDatabase, getDatabase } from "@/lib/db";
import { getPageSnapshot, PAGE_RULES_VERSION } from "@/lib/page-snapshots";
import { createProject, ensureActiveProject } from "@/lib/projects";
import { confirmSemforgePayment, createSemforgeCheckout } from "@/lib/semforge-subscription";
import { createSiteAuditCampaign, getSiteAuditOverview, runSiteAuditCampaign } from "@/lib/semforge/siteaudit";
import { fetchPublicText } from "@/lib/url-security";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "geo-page-snapshots-"));
const databasePath = path.join(directory, "test.db");
const request = vi.fn();
let sequence = 0;
let homeHtml = "";
let homeFinalUrl = "https://example.com";
let homeContentType = "text/html; charset=utf-8";

const productHtml = `<html lang="ko"><head><title>상품</title><link rel="canonical" href="https://mirror.example.net/product">
  <script type="application/ld+json">{ not json</script></head><body><h1>상품</h1></body></html>`;

function route(url: string) {
  if (url.endsWith("/llms.txt")) return Promise.resolve({ url, status: 404, text: "", contentType: "text/plain" });
  if (url.endsWith("/product")) return Promise.resolve({ url, status: 200, text: productHtml, contentType: "text/html" });
  if (url.endsWith("/gone")) return Promise.resolve({ url, status: 404, text: "<html><title>없음</title></html>", contentType: "text/html" });
  return Promise.resolve({ url: url === "https://example.com" ? homeFinalUrl : url, status: 200, text: homeHtml, contentType: homeContentType });
}

function activate() {
  createProject({ name: `Snapshots ${++sequence}`, brandName: "QA", category: "AI", competitors: [], activate: true });
}

beforeEach(() => {
  vi.stubEnv("GEO_DB_PATH", databasePath);
  vi.stubEnv("GEO_AUTH_MODE", "local");
  vi.stubEnv("SEMFORGE_BILLING_MODE", "dev");
  vi.stubEnv("FIRECRAWL_API_KEY", "test-firecrawl-key");
  vi.stubGlobal("fetch", request.mockReset());
  vi.mocked(fetchPublicText).mockReset().mockImplementation((url: string) => route(url));
  request.mockImplementation(() => Response.json({ success: true, links: ["https://example.com", "https://example.com/product", "https://example.com/gone", "https://other.example.net/x"] }));
  homeHtml = "<html lang=\"ko\"><head><title>홈</title><meta name=\"description\" content=\"홈 설명\"></head><body><h1>홈</h1></body></html>";
  homeFinalUrl = "https://example.com";
  homeContentType = "text/html; charset=utf-8";
  const db = getDatabase().sqlite;
  db.exec("DELETE FROM semforge_payment_intents; DELETE FROM semforge_subscriptions;");
  ensureActiveProject();
  activate();
  const checkout = createSemforgeCheckout();
  confirmSemforgePayment({ orderId: checkout.orderId, confirmToken: checkout.devConfirmToken });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
afterAll(() => { closeDatabase(databasePath); fs.rmSync(directory, { recursive: true, force: true }); });

const snapshotRows = (campaignId: number) => getDatabase().sqlite.prepare(`
  SELECT p.url, p.fetch_state, s.id AS snapshotId, s.status_code, s.render_mode, s.rules_version, s.html IS NOT NULL AS stored
  FROM site_audit_pages p LEFT JOIN page_snapshots s ON s.id = p.snapshot_id WHERE p.campaign_id = ? ORDER BY p.url
`).all(campaignId) as Array<{ url: string; fetch_state: string; snapshotId: number | null; status_code: number | null; render_mode: string | null; rules_version: string | null; stored: number | null }>;

describe("Qshop P03: crawls store versioned page snapshots", () => {
  it("stores a snapshot for every page that responded, with rule version and evidence", async () => {
    const campaign = createSiteAuditCampaign({ name: "QA", domain: "example.com" });
    await runSiteAuditCampaign(campaign.id);
    const rows = snapshotRows(campaign.id);
    expect(rows.map(({ url, snapshotId, status_code, render_mode, rules_version }) => ({ url, has: snapshotId !== null, status_code, render_mode, rules_version }))).toEqual([
      { url: "https://example.com", has: true, status_code: 200, render_mode: "native", rules_version: PAGE_RULES_VERSION },
      { url: "https://example.com/gone", has: true, status_code: 404, render_mode: "native", rules_version: PAGE_RULES_VERSION },
      { url: "https://example.com/product", has: true, status_code: 200, render_mode: "native", rules_version: PAGE_RULES_VERSION },
      { url: "https://other.example.net/x", has: false, status_code: null, render_mode: null, rules_version: null },
    ]);

    const product = getPageSnapshot(rows.find((row) => row.url.endsWith("/product"))!.snapshotId);
    expect(product).toMatchObject({ url: "https://example.com/product", statusCode: 200, renderMode: "native", rulesVersion: PAGE_RULES_VERSION, htmlStored: true });
    expect(product.facts).toMatchObject({ title: "상품", canonical: "https://mirror.example.net/product", jsonLdInvalid: 1 });
    expect(product.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "jsonld-parse", passed: false, tier: "technical" }),
      expect.objectContaining({ code: "canonical-host", passed: false, evidence: "https://mirror.example.net/product" }),
    ]));
    expect(product.versions).toHaveLength(1);
  });

  it("links snapshots from the briefing and surfaces technical findings as site issues", async () => {
    const campaign = createSiteAuditCampaign({ name: "QA", domain: "example.com" });
    await runSiteAuditCampaign(campaign.id);
    const briefing = getSiteAuditOverview(campaign.id).briefing;
    const product = briefing.pages.find((item) => item.url.endsWith("/product"));
    expect(product).toMatchObject({ snapshotId: expect.any(Number), technicalIssues: 2 });
    expect(briefing.pages.find((item) => item.url.startsWith("https://other"))).toMatchObject({ snapshotId: null, technicalIssues: 0 });
    expect(briefing.issues.map((issue) => issue.title)).toEqual(expect.arrayContaining(["JSON-LD 구문 오류", "canonical이 다른 사이트를 가리킴"]));
  });

  it("reuses an unchanged version, adds a new one when content changes and keeps at most three", async () => {
    const campaign = createSiteAuditCampaign({ name: "QA", domain: "example.com" });
    await runSiteAuditCampaign(campaign.id);
    const first = snapshotRows(campaign.id).find((row) => row.url === "https://example.com")!.snapshotId!;
    await runSiteAuditCampaign(campaign.id);
    expect(snapshotRows(campaign.id).find((row) => row.url === "https://example.com")!.snapshotId).toBe(first);
    expect(getPageSnapshot(first).lastSeenAt >= getPageSnapshot(first).capturedAt).toBe(true);

    for (const version of [2, 3, 4]) {
      homeHtml = `<html><head><title>홈 v${version}</title></head><body><h1>홈</h1></body></html>`;
      await runSiteAuditCampaign(campaign.id);
    }
    const latest = snapshotRows(campaign.id).find((row) => row.url === "https://example.com")!.snapshotId!;
    const detail = getPageSnapshot(latest);
    expect(detail.facts?.title).toBe("홈 v4");
    expect(detail.versions.map((version) => version.id)).toHaveLength(3);
    expect(detail.versions[0]).toMatchObject({ id: latest });
    expect(() => getPageSnapshot(first)).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
  });

  it("creates a new version when response metadata changes even if the body is unchanged", async () => {
    const campaign = createSiteAuditCampaign({ name: "QA", domain: "example.com" });
    await runSiteAuditCampaign(campaign.id);
    const first = snapshotRows(campaign.id).find((row) => row.url === "https://example.com")!.snapshotId!;
    const body = homeHtml;

    homeFinalUrl = "https://example.com/home";
    homeContentType = "application/xhtml+xml";
    await runSiteAuditCampaign(campaign.id);

    const latest = snapshotRows(campaign.id).find((row) => row.url === "https://example.com")!.snapshotId!;
    expect(latest).not.toBe(first);
    expect(getPageSnapshot(latest)).toMatchObject({ finalUrl: homeFinalUrl, contentType: homeContentType, bodyKind: "html" });
    expect(homeHtml).toBe(body);
  });

  it("deletes a campaign's snapshots with the campaign but keeps ones another campaign still shows", async () => {
    const { deleteSiteAuditCampaign } = await import("@/lib/semforge/siteaudit");
    const first = createSiteAuditCampaign({ name: "A", domain: "example.com" });
    await runSiteAuditCampaign(first.id);
    const second = createSiteAuditCampaign({ name: "B", domain: "example.com" });
    request.mockImplementation(() => Response.json({ success: true, links: ["https://example.com"] }));
    await runSiteAuditCampaign(second.id);
    const shared = snapshotRows(second.id)[0]!.snapshotId!;
    const count = () => (getDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM page_snapshots WHERE project_id = (SELECT project_id FROM site_audit_campaigns WHERE id = ?)").get(second.id) as { count: number }).count;
    expect(count()).toBe(3);
    deleteSiteAuditCampaign(first.id);
    expect(count()).toBe(1);
    expect(getPageSnapshot(shared)).toMatchObject({ url: "https://example.com" });
    deleteSiteAuditCampaign(second.id);
    expect(getDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM page_snapshots WHERE id = ?").get(shared)).toEqual({ count: 0 });
  });

  it("does not show another project's snapshot", async () => {
    const campaign = createSiteAuditCampaign({ name: "QA", domain: "example.com" });
    await runSiteAuditCampaign(campaign.id);
    const id = snapshotRows(campaign.id)[0]!.snapshotId!;
    activate();
    expect(() => getPageSnapshot(id)).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
  });

  it("caps the stored HTML but analyzes the full document", async () => {
    homeHtml = `<html><head><title>큰 페이지</title></head><body>${"가".repeat(400_000)}</body></html>`;
    const campaign = createSiteAuditCampaign({ name: "QA", domain: "example.com" });
    await runSiteAuditCampaign(campaign.id);
    const id = snapshotRows(campaign.id).find((row) => row.url === "https://example.com")!.snapshotId!;
    const row = getDatabase().sqlite.prepare("SELECT length(CAST(html AS BLOB)) AS stored, html_truncated, bytes FROM page_snapshots WHERE id = ?").get(id) as { stored: number; html_truncated: number; bytes: number };
    expect(row.html_truncated).toBe(1);
    expect(row.stored).toBeLessThanOrEqual(256 * 1024);
    expect(row.bytes).toBeGreaterThan(1_000_000);
    expect(getPageSnapshot(id)).toMatchObject({ htmlTruncated: true, facts: { title: "큰 페이지" } });
  });
});
