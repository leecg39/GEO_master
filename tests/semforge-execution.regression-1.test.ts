import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDatabase, getDatabase } from "@/lib/db";
import { createProject, ensureActiveProject } from "@/lib/projects";
import { confirmSemforgePayment, createSemforgeCheckout } from "@/lib/semforge-subscription";
import { addTrackedKeyword, createPositionCampaign, listTrackedKeywords } from "@/lib/semforge/position-tracking";
import { addMapRankKeyword, createMapRankCampaign, listMapRankKeywords } from "@/lib/semforge/local-business";
import { runAllInSemforge } from "@/lib/semforge/all-in";
import { fetchSerp } from "@/lib/semforge/talordata/client";

vi.mock("@/lib/semforge/talordata/client", () => ({
  talordataConfigured: () => true, talordataMode: () => "mock", talordataSource: () => "mock-dev", fetchSerp: vi.fn(),
}));
vi.mock("@/lib/semforge/siteaudit", () => ({ firecrawlConfigured: () => false }));

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-execution-regression-"));
const databasePath = path.join(tempDir, "execution.db");
let sequence = 0;
beforeEach(() => {
  vi.stubEnv("GEO_DB_PATH", databasePath);
  vi.stubEnv("SEMFORGE_BILLING_MODE", "dev");
  getDatabase().sqlite.exec("DELETE FROM semforge_payment_intents; DELETE FROM semforge_subscriptions;");
  ensureActiveProject();
  createProject({ name: `QA ${++sequence}`, brandName: "QA", category: "도구", competitors: [], activate: true });
  const checkout = createSemforgeCheckout();
  confirmSemforgePayment({ orderId: checkout.orderId, confirmToken: checkout.devConfirmToken });
  vi.mocked(fetchSerp).mockReset().mockResolvedValue({
    query: "qa", engine: "google", organic: [], localPack: [], features: [],
    aiOverview: { present: false, citationsAvailable: false, citations: [] }, capturedAt: new Date(),
  });
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => { closeDatabase(databasePath); fs.rmSync(tempDir, { recursive: true, force: true }); });

// Regression: ISSUE-003/004 — repeat runs multiplied billable calls; errors looked successful.
// Found by /qa on 2026-10-07. Report: docs/qa/qa-report-2026-10-07.md
describe("SEMForge execution safeguards", () => {
  it("rejects equivalent keywords within a campaign", () => {
    const position = createPositionCampaign({ name: "순위", domain: "example.com" });
    addTrackedKeyword({ campaignId: position.id, keyword: "QA keyword" });
    expect(() => addTrackedKeyword({ campaignId: position.id, keyword: " qa   KEYWORD " })).toThrow(/이미/);
    expect(listTrackedKeywords(position.id)).toHaveLength(1);
    const local = createMapRankCampaign({ name: "지역", businessName: "QA", locationLabel: "서울" });
    addMapRankKeyword({ campaignId: local.id, keyword: "QA keyword" });
    expect(() => addMapRankKeyword({ campaignId: local.id, keyword: " qa   KEYWORD " })).toThrow(/이미/);
    expect(listMapRankKeywords(local.id)).toHaveLength(1);
  });

  it("does not multiply keywords or SERP requests when ALL IN runs twice", async () => {
    const input = { brandName: "QA", domain: "example.com" };
    await runAllInSemforge(input);
    const firstCalls = vi.mocked(fetchSerp).mock.calls.length;
    vi.mocked(fetchSerp).mockClear();
    await runAllInSemforge(input);
    expect(fetchSerp).toHaveBeenCalledTimes(firstCalls);
  });

});
