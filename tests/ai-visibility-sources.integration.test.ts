import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDatabase, getDatabase } from "@/lib/db";
import { createProject, ensureActiveProject } from "@/lib/projects";
import { confirmSemforgePayment, createSemforgeCheckout } from "@/lib/semforge-subscription";
import { addAiVisibilityQuery, getAiVisibilityOverview, getAiVisibilityQueryReport } from "@/lib/semforge/ai-visibility";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "geo-aiv-sources-"));
const databasePath = path.join(directory, "test.db");
let queryId = 0;

beforeAll(() => {
  vi.stubEnv("GEO_DB_PATH", databasePath);
  vi.stubEnv("SEMFORGE_BILLING_MODE", "dev");
  ensureActiveProject();
  createProject({ name: "AIV sources", brandName: "QA", category: "AI", competitors: [], activate: true });
  const checkout = createSemforgeCheckout();
  confirmSemforgePayment({ orderId: checkout.orderId, confirmToken: checkout.devConfirmToken });
  queryId = addAiVisibilityQuery({ domain: "example.com", query: "geo master 사용법" }).id;
  const insert = getDatabase().sqlite.prepare("INSERT INTO ai_visibility_snapshots (query_id, aio_present, cited, cited_url, cited_domains, organic_position, features, source, captured_at) VALUES (?, ?, ?, NULL, '[]', NULL, '[]', ?, ?)");
  // 실제 수집(talordata)은 AIO 없음, 이후 데모(mock-dev)는 AIO·인용 있음 — 데모가 실측처럼 섞이면 안 된다
  insert.run(queryId, 0, 0, "talordata", "2026-10-01T00:00:00.000Z");
  insert.run(queryId, 1, 1, "mock-dev", "2026-10-02T00:00:00.000Z");
});
beforeEach(() => {
  vi.stubEnv("GEO_DB_PATH", databasePath);
  vi.stubEnv("SEMFORGE_BILLING_MODE", "dev");
});
afterEach(() => { vi.unstubAllEnvs(); vi.stubEnv("GEO_DB_PATH", databasePath); vi.stubEnv("SEMFORGE_BILLING_MODE", "dev"); });
afterAll(() => { vi.unstubAllEnvs(); closeDatabase(databasePath); fs.rmSync(directory, { recursive: true, force: true }); });

describe("AI visibility never mixes demo (mock) snapshots with live observations", () => {
  it("live mode counts only live snapshots even when a newer demo snapshot exists", () => {
    vi.stubEnv("TALORDATA_API_TOKEN", "live-token");
    const overview = getAiVisibilityOverview("example.com");
    expect(overview.snapshotSource).toBe("talordata");
    expect(overview.queries[0]).toMatchObject({ aioPresent: false, cited: false, lastCapturedAt: "2026-10-01T00:00:00.000Z" });
    expect(overview.stats).toMatchObject({ collectedCount: 1, aioCount: 0, citedCount: 0 });
    expect(getAiVisibilityQueryReport(queryId)).toMatchObject({ snapshotSource: "talordata", snapshotCount: 1 });
  });

  it("demo mode shows only demo snapshots and labels them", () => {
    vi.stubEnv("TALORDATA_API_TOKEN", "");
    vi.stubEnv("SEMFORGE_MOCK_TALORDATA", "1");
    const overview = getAiVisibilityOverview("example.com");
    expect(overview.snapshotSource).toBe("mock-dev");
    expect(overview.stats).toMatchObject({ collectedCount: 1, aioCount: 1, citedCount: 1 });
    expect(getAiVisibilityQueryReport(queryId)).toMatchObject({ snapshotSource: "mock-dev", snapshotCount: 1 });
  });

  it("without a provider, past live results stay visible but demo results never appear", () => {
    vi.stubEnv("TALORDATA_API_TOKEN", "");
    vi.stubEnv("SEMFORGE_MOCK_TALORDATA", "");
    const overview = getAiVisibilityOverview("example.com");
    expect(overview.snapshotSource).toBe("talordata");
    expect(overview.stats).toMatchObject({ collectedCount: 1, aioCount: 0, citedCount: 0 });
  });
});
