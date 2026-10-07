import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDatabase, getDatabase } from "@/lib/db";
import { confirmSemforgePayment, createSemforgeCheckout, getSemforgeSubscription } from "@/lib/semforge-subscription";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-billing-regression-"));
const databasePath = path.join(tempDir, "billing.db");
beforeEach(() => {
  vi.stubEnv("GEO_DB_PATH", databasePath);
  vi.stubEnv("SEMFORGE_BILLING_MODE", "dev");
  getDatabase().sqlite.exec("DELETE FROM semforge_payment_intents; DELETE FROM semforge_subscriptions;");
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => { closeDatabase(databasePath); fs.rmSync(tempDir, { recursive: true, force: true }); });

// Regression: ISSUE-002 — missing billing config enabled payment-free activation.
// Found by /qa on 2026-10-07. Report: docs/qa/qa-report-2026-10-07.md
describe("SEMForge billing fails closed", () => {
  it.each(["", "live", "typo"])("does not create an unverifiable checkout in %s mode", (mode) => {
    vi.stubEnv("SEMFORGE_BILLING_MODE", mode);
    expect(() => createSemforgeCheckout()).toThrow(/운영 결제/);
    expect(getDatabase().sqlite.prepare("SELECT COUNT(*) AS n FROM semforge_payment_intents").get()).toEqual({ n: 0 });
    expect(getSemforgeSubscription().active).toBe(false);
  });

  it("does not treat a shared webhook secret as proof of payment", () => {
    const checkout = createSemforgeCheckout();
    vi.stubEnv("SEMFORGE_BILLING_MODE", "live");
    vi.stubEnv("SEMFORGE_TOSS_WEBHOOK_SECRET", "not-a-payment-receipt");
    expect(() => confirmSemforgePayment({ orderId: checkout.orderId, confirmToken: "not-a-payment-receipt" })).toThrow(/운영 결제/);
    expect(getSemforgeSubscription().active).toBe(false);
  });

  it("reports elapsed subscriptions as past due", () => {
    const checkout = createSemforgeCheckout();
    confirmSemforgePayment({ orderId: checkout.orderId, confirmToken: checkout.devConfirmToken });
    getDatabase().sqlite.prepare("UPDATE semforge_subscriptions SET current_period_end = ?").run("2000-01-01T00:00:00.000Z");
    expect(getSemforgeSubscription()).toMatchObject({ active: false, status: "past_due", daysRemaining: null });
  });
});
