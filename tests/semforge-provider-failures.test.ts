import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDatabase, getDatabase } from "@/lib/db";
import { createProject, ensureActiveProject } from "@/lib/projects";
import { confirmSemforgePayment, createSemforgeCheckout } from "@/lib/semforge-subscription";
import { fetchSerp } from "@/lib/semforge/talordata/client";
import { addTrackedKeyword, collectCampaignRankings, createPositionCampaign } from "@/lib/semforge/position-tracking";
import { addMapRankKeyword, collectMapRank, createMapRankCampaign } from "@/lib/semforge/local-business";
import { createSiteAuditCampaign, runSiteAuditCampaign } from "@/lib/semforge/siteaudit";
import { runAllInSemforge } from "@/lib/semforge/all-in";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "geo-provider-failures-"));
const databasePath = path.join(directory, "test.db");
const request = vi.fn();
let sequence = 0;
const expired = () => Response.json({ code: 400, data: "Package has expired!" });
const serp = () => Response.json({ code: 200, data: { organic: [{ title: "Example", link: "https://example.com/", position: 1 }] } });

beforeEach(() => {
  vi.stubEnv("GEO_DB_PATH", databasePath);
  vi.stubEnv("GEO_AUTH_MODE", "local");
  vi.stubEnv("SEMFORGE_BILLING_MODE", "dev");
  vi.stubEnv("TALORDATA_API_TOKEN", "test-serp-token");
  vi.stubEnv("FIRECRAWL_API_KEY", "test-firecrawl-key");
  vi.stubGlobal("fetch", request.mockReset());
  const db = getDatabase().sqlite;
  db.exec("DELETE FROM semforge_payment_intents; DELETE FROM semforge_subscriptions;");
  ensureActiveProject();
  createProject({ name: `Provider QA ${++sequence}`, brandName: "QA", category: "AI", competitors: [], activate: true });
  const checkout = createSemforgeCheckout();
  confirmSemforgePayment({ orderId: checkout.orderId, confirmToken: checkout.devConfirmToken });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
afterAll(() => { closeDatabase(databasePath); fs.rmSync(directory, { recursive: true, force: true }); });

describe("live provider failure contracts", () => {
  it("recognizes the actual HTTP 200 expired-package envelope", async () => {
    request.mockImplementation(expired);
    await expect(fetchSerp({ q: "QA" })).rejects.toMatchObject({ code: "TALORDATA_PLAN_EXPIRED", message: expect.stringContaining("이용권이 만료") });
  });

  it("keeps structured success and reports malformed responses distinctly", async () => {
    request.mockImplementationOnce(serp).mockResolvedValueOnce(new Response("not json"));
    expect((await fetchSerp({ q: "QA" })).organic[0].domain).toBe("example.com");
    expect(request.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    await expect(fetchSerp({ q: "QA" })).rejects.toMatchObject({ code: "TALORDATA_INVALID_RESPONSE" });
  });

  it.each([
    [401, "TALORDATA_AUTH_FAILED"],
    [402, "TALORDATA_CREDITS_EXHAUSTED"],
    [429, "RATE_LIMITED"],
  ])("classifies HTTP %s without leaking upstream payloads", async (status, code) => {
    request.mockResolvedValue(Response.json({ message: "upstream-private-payload" }, { status }));
    await expect(fetchSerp({ q: "QA" })).rejects.toMatchObject({ code, message: expect.not.stringContaining("upstream-private-payload") });
  });

  it("returns an actionable timeout rather than an unbounded request", async () => {
    request.mockRejectedValue(new DOMException("timeout", "TimeoutError"));
    await expect(fetchSerp({ q: "QA" })).rejects.toMatchObject({ code: "TALORDATA_TIMEOUT" });
  });

  it("distinguishes Firecrawl credits from application errors and preserves past results", async () => {
    request.mockResolvedValue(Response.json({ success: false, error: "Insufficient credits to perform this request." }, { status: 402 }));
    const campaign = createSiteAuditCampaign({ name: "QA", domain: "example.com" });
    const db = getDatabase().sqlite;
    db.prepare("UPDATE site_audit_campaigns SET site_health = 88, last_run_at = '2026-10-01' WHERE id = ?").run(campaign.id);
    await expect(runSiteAuditCampaign(campaign.id)).rejects.toMatchObject({ code: "FIRECRAWL_CREDITS_EXHAUSTED", message: expect.stringContaining("크레딧") });
    expect(db.prepare("SELECT status, site_health, last_run_at FROM site_audit_campaigns WHERE id = ?").get(campaign.id)).toEqual({ status: "failed", site_health: 88, last_run_at: "2026-10-01" });
  });

  it("stops a blocked ranking batch and does not replace prior visibility with zero", async () => {
    request.mockImplementation(expired);
    const campaign = createPositionCampaign({ name: "QA", domain: "example.com" });
    for (const keyword of ["one", "two", "three"]) addTrackedKeyword({ campaignId: campaign.id, keyword });
    const db = getDatabase().sqlite;
    db.prepare("UPDATE position_tracking_campaigns SET visibility = 67, updated_at = '2026-10-01' WHERE id = ?").run(campaign.id);
    const report = await collectCampaignRankings(campaign.id);
    expect(request).toHaveBeenCalledTimes(1);
    expect(report).toMatchObject({ collected: 0, failed: 1, skipped: 2, visibility: null });
    expect(db.prepare("SELECT visibility, updated_at FROM position_tracking_campaigns WHERE id = ?").get(campaign.id)).toEqual({ visibility: 67, updated_at: "2026-10-01" });
  });

  it("preserves map visibility when the SERP account is blocked", async () => {
    request.mockImplementation(expired);
    const campaign = createMapRankCampaign({ name: "QA", businessName: "QA", locationLabel: "서울" });
    for (const keyword of ["one", "two"]) addMapRankKeyword({ campaignId: campaign.id, keyword });
    const db = getDatabase().sqlite;
    db.prepare("UPDATE map_rank_campaigns SET visibility = 50, updated_at = '2026-10-01' WHERE id = ?").run(campaign.id);
    expect(await collectMapRank(campaign.id)).toMatchObject({ collected: 0, failed: 1, skipped: 1, visibility: null });
    expect(request).toHaveBeenCalledTimes(1);
    expect(db.prepare("SELECT visibility, updated_at FROM map_rank_campaigns WHERE id = ?").get(campaign.id)).toEqual({ visibility: 50, updated_at: "2026-10-01" });
  });

  it("continues query-specific failures without publishing a partial visibility score", async () => {
    request.mockResolvedValueOnce(Response.json({}, { status: 500 })).mockImplementation(serp);
    const campaign = createPositionCampaign({ name: "Partial QA", domain: "example.com" });
    for (const keyword of ["one", "two"]) addTrackedKeyword({ campaignId: campaign.id, keyword });
    const db = getDatabase().sqlite;
    db.prepare("UPDATE position_tracking_campaigns SET visibility = 75 WHERE id = ?").run(campaign.id);
    expect(await collectCampaignRankings(campaign.id)).toMatchObject({ collected: 1, failed: 1, skipped: 0, visibility: null });
    expect(request).toHaveBeenCalledTimes(2);
    expect(db.prepare("SELECT visibility FROM position_tracking_campaigns WHERE id = ?").get(campaign.id)).toEqual({ visibility: 75 });
  });

  it("explains ALL IN failures and avoids repeating a blocked SERP account across steps", async () => {
    request.mockImplementation((url: string) => String(url).includes("firecrawl.dev")
      ? Response.json({ success: false, error: "Insufficient credits" }, { status: 402 }) : expired());
    const result = await runAllInSemforge({ brandName: "QA", domain: "example.com" });
    expect(result.steps.find((step) => step.key === "ai-seo")).toMatchObject({ status: "error", message: expect.stringContaining("이용권이 만료") });
    expect(result.steps.find((step) => step.key === "site-audit")).toMatchObject({ status: "error", message: expect.stringContaining("크레딧") });
    for (const key of ["position-tracking", "local-business"]) {
      const step = result.steps.find((item) => item.key === key);
      expect(step).toMatchObject({ status: "skipped", message: expect.stringContaining("이용권이 만료") });
      expect(step?.message).not.toContain("가시성 0%");
    }
    expect(request).toHaveBeenCalledTimes(2);
    expect(getDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM ai_visibility_snapshots").get()).toEqual({ count: 0 });
  });

  it("can measure again after account renewal without a sticky provider lock", async () => {
    request.mockImplementation((url: string) => String(url).includes("firecrawl.dev")
      ? Response.json({ success: true, links: ["https://example.com/", "https://example.com/about", "https://example.com/llms.txt"] }) : expired());
    await runAllInSemforge({ brandName: "QA", domain: "example.com" });
    request.mockImplementation((url: string) => String(url).includes("firecrawl.dev")
      ? Response.json({ success: true, links: ["https://example.com/", "https://example.com/about", "https://example.com/llms.txt"] }) : serp());
    const recovered = await runAllInSemforge({ brandName: "QA", domain: "example.com" });
    expect(recovered.steps.every((step) => step.status === "ok")).toBe(true);
  });
});
