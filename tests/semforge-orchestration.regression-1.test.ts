import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDatabase, getDatabase } from "@/lib/db";
import { activateProject, createProject, ensureActiveProject } from "@/lib/projects";
import { confirmSemforgePayment, createSemforgeCheckout } from "@/lib/semforge-subscription";
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
describe("SEMForge orchestration safeguards", () => {
  it("reports total provider failure as errors instead of completed steps", async () => {
    vi.mocked(fetchSerp).mockRejectedValue(new Error("upstream unavailable"));
    const report = await runAllInSemforge({ brandName: "QA", domain: "example.com" });
    for (const key of ["ai-seo", "position-tracking", "local-business"]) {
      expect(report.steps.find((step) => step.key === key)?.status).toBe("error");
    }
  });

  it("stops after an active-project switch without creating data in the other project", async () => {
    const original = ensureActiveProject();
    const other = createProject({ name: "Other QA", brandName: "OTHER", category: "", competitors: [], activate: false });
    vi.mocked(fetchSerp).mockImplementationOnce(async () => {
      activateProject(other.id);
      return { query: "qa", engine: "google", organic: [], localPack: [], features: [], aiOverview: { present: false, citationsAvailable: false, citations: [] }, capturedAt: new Date() };
    });
    await expect(runAllInSemforge({ brandName: "QA", domain: "example.com" })).rejects.toMatchObject({ code: "PROJECT_CHANGED" });
    for (const table of ["sites", "site_audit_campaigns", "position_tracking_campaigns", "gbp_connections", "map_rank_campaigns"]) {
      expect(getDatabase().sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE project_id = ?`).get(other.id)).toEqual({ n: 0 });
    }
    activateProject(original.id);
  });
});
