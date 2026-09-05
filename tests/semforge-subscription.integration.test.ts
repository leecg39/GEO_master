import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDatabase, getDatabase } from "@/lib/db";
import {
  confirmSemforgePayment,
  createSemforgeCheckout,
  getSemforgeSubscription,
  requireSemforgeSubscription,
  SEMFORGE_MONTHLY_PRICE_KRW,
} from "@/lib/semforge-subscription";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-semforge-sub-"));
const databasePath = path.join(tempDir, "sub.db");
const previousDb = process.env.GEO_DB_PATH;
const previousBilling = process.env.SEMFORGE_BILLING_MODE;

beforeAll(() => {
  process.env.GEO_DB_PATH = databasePath;
  process.env.SEMFORGE_BILLING_MODE = "dev";
  getDatabase();
});

afterAll(() => {
  closeDatabase(databasePath);
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (previousDb === undefined) delete process.env.GEO_DB_PATH;
  else process.env.GEO_DB_PATH = previousDb;
  if (previousBilling === undefined) delete process.env.SEMFORGE_BILLING_MODE;
  else process.env.SEMFORGE_BILLING_MODE = previousBilling;
});

describe("SEMForge subscription gate", () => {
  it("starts inactive at 300000 KRW/month", () => {
    const sub = getSemforgeSubscription();
    expect(sub.active).toBe(false);
    expect(sub.amountKrw).toBe(SEMFORGE_MONTHLY_PRICE_KRW);
  });

  it("activates after dev checkout confirm", () => {
    const checkout = createSemforgeCheckout();
    expect(checkout.amountKrw).toBe(300_000);
    expect(checkout.devConfirmToken).toBeTruthy();
    const activated = confirmSemforgePayment({ orderId: checkout.orderId, confirmToken: checkout.devConfirmToken });
    expect(activated.active).toBe(true);
    expect(activated.daysRemaining).toBeGreaterThan(0);
    expect(() => requireSemforgeSubscription()).not.toThrow();
  });
});
