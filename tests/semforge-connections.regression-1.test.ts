import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDatabase, getDatabase } from "@/lib/db";
import { ensureActiveProject } from "@/lib/projects";
import { confirmSemforgePayment, createSemforgeCheckout } from "@/lib/semforge-subscription";
import { connectGbpLocation, listGbpConnections } from "@/lib/semforge/local-business";
import { connectGscPlaceholder, listGscConnections } from "@/lib/semforge/position-tracking";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-connections-regression-"));
const databasePath = path.join(tempDir, "connections.db");
beforeEach(() => {
  vi.stubEnv("GEO_DB_PATH", databasePath);
  vi.stubEnv("SEMFORGE_BILLING_MODE", "dev");
  getDatabase().sqlite.exec("DELETE FROM semforge_payment_intents; DELETE FROM semforge_subscriptions; DELETE FROM gbp_connections; DELETE FROM gsc_connections;");
  ensureActiveProject();
  const checkout = createSemforgeCheckout();
  confirmSemforgePayment({ orderId: checkout.orderId, confirmToken: checkout.devConfirmToken });
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => { closeDatabase(databasePath); fs.rmSync(tempDir, { recursive: true, force: true }); });

// Regression: ISSUE-006 — manual locations claimed an OAuth connection that did not exist.
// Found by /qa on 2026-10-07. Report: docs/qa/qa-report-2026-10-07.md
describe("SEMForge connection provenance", () => {
  it.each(["", "qa-client"])("keeps manual GBP registration disconnected with client %s", (clientId) => {
    vi.stubEnv("GOOGLE_CLIENT_ID", clientId);
    vi.stubEnv("GOOGLE_CLIENT_SECRET", clientId);
    const result = connectGbpLocation({ locationName: "QA 매장", address: "서울" });
    expect(result).toMatchObject({ status: "disconnected", oauthUrl: null });
    expect(listGbpConnections()[0].status).toBe("disconnected");
  });

  it("does not return an unimplemented GSC OAuth URL or create a pending connection", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "qa-client");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "qa-secret");
    expect(() => connectGscPlaceholder("https://example.com")).toThrow(/아직/);
    expect(listGscConnections()).toHaveLength(0);
  });
});
