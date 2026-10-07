import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDatabase, getDatabase } from "@/lib/db";
import { getRequestAccount, withRequestAccount } from "@/lib/request-account";
import { cancelSemforgeSubscription, confirmSemforgePayment, createSemforgeCheckout, getSemforgeSubscription, requireSemforgeSubscription } from "@/lib/semforge-subscription";
import { GET as subscriptionGET } from "@/app/api/semforge/subscription/route";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "geo-account-access-"));
const dbPath = path.join(directory, "test.db");
const secret = "test-only-proxy-secret-at-least-32-bytes";
const userHeaders = (user: string) => new Headers({ "x-geo-auth-user": user, "x-geo-auth-secret": secret });
const as = <T>(user: string, fn: () => T) => withRequestAccount(userHeaders(user), fn);
const activate = (user: string) => as(user, () => {
  const checkout = createSemforgeCheckout();
  return confirmSemforgePayment({ orderId: checkout.orderId, confirmToken: checkout.devConfirmToken });
});

beforeEach(() => {
  vi.stubEnv("GEO_DB_PATH", dbPath);
  vi.stubEnv("GEO_AUTH_MODE", "proxy");
  vi.stubEnv("GEO_AUTH_PROXY_SECRET", secret);
  vi.stubEnv("GEO_ADMIN_USERS", "geo-admin");
  vi.stubEnv("SEMFORGE_BILLING_MODE", "live");
  getDatabase().sqlite.exec("DELETE FROM semforge_subscriptions; DELETE FROM semforge_payment_intents;");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
afterAll(() => { closeDatabase(dbPath); fs.rmSync(directory, { recursive: true, force: true }); });

describe("account-scoped SEMForge permissions", () => {
  it("grants the authenticated administrator permanent access without changing member subscriptions", () => {
    expect(as("geo-admin", requireSemforgeSubscription)).toMatchObject({ accountId: "geo-admin", active: true, accessSource: "admin", amountKrw: 0, currentPeriodEnd: null });
    expect(as("alice", getSemforgeSubscription)).toMatchObject({ accountId: "alice", active: false, role: "member" });
    expect(() => as("alice", requireSemforgeSubscription)).toThrow(/구독/);
    expect(() => as("geo-admin", cancelSemforgeSubscription)).toThrow(/관리자/);
    expect(() => as("geo-admin", createSemforgeCheckout)).toThrow(/결제 없이/);
    expect(getDatabase().sqlite.prepare("SELECT COUNT(*) AS n FROM semforge_subscriptions WHERE account_id = 'geo-admin'").get()).toEqual({ n: 0 });
  });

  it("rejects forged or missing proxy identity and does not promote lookalike usernames", async () => {
    for (const headers of [new Headers(), new Headers({ "x-geo-auth-user": "geo-admin" }), new Headers({ "x-geo-auth-user": "geo-admin", "x-geo-auth-secret": "forged" })]) {
      const response = await subscriptionGET(new NextRequest("https://geo.test/api/semforge/subscription", { headers }));
      expect(response.status).toBe(401);
    }
    expect(as("geo-admin.other", getRequestAccount).role).toBe("member");
    expect(() => getSemforgeSubscription()).toThrow(/로그인/);
    vi.stubEnv("GEO_AUTH_PROXY_SECRET", "");
    expect(() => as("geo-admin", getSemforgeSubscription)).toThrow(/설정/);
  });

  it("keeps concurrent requests in independent account contexts", async () => {
    const result = await Promise.all(["geo-admin", "alice", "bob"].map((user) => as(user, async () => {
      await new Promise((resolve) => setTimeout(resolve, user === "geo-admin" ? 15 : 5));
      return getSemforgeSubscription();
    })));
    expect(result.map(({ accountId, active }) => ({ accountId, active }))).toEqual([
      { accountId: "geo-admin", active: true }, { accountId: "alice", active: false }, { accountId: "bob", active: false },
    ]);
  });

  it("prevents another member from confirming or canceling the owner's subscription", () => {
    vi.stubEnv("SEMFORGE_BILLING_MODE", "dev");
    const checkout = as("alice", createSemforgeCheckout);
    expect(() => as("bob", () => confirmSemforgePayment({ orderId: checkout.orderId, confirmToken: checkout.devConfirmToken }))).toThrow(/찾을 수 없습니다/);
    as("alice", () => confirmSemforgePayment({ orderId: checkout.orderId, confirmToken: checkout.devConfirmToken }));
    expect(as("alice", getSemforgeSubscription).active).toBe(true);
    as("bob", cancelSemforgeSubscription);
    expect(as("alice", getSemforgeSubscription).active).toBe(true);
    expect(as("bob", getSemforgeSubscription).active).toBe(false);
  });

  it("requires a matching paid receipt and expiry even for an active member row", () => {
    vi.stubEnv("SEMFORGE_BILLING_MODE", "dev");
    activate("alice");
    const { sqlite } = getDatabase();
    // Simulate a server-verified live receipt; no live checkout endpoint accepts this input.
    sqlite.exec("UPDATE semforge_subscriptions SET billing_mode = 'live'; UPDATE semforge_payment_intents SET billing_mode = 'live', provider = 'toss';");
    vi.stubEnv("SEMFORGE_BILLING_MODE", "live");
    expect(as("alice", requireSemforgeSubscription).accessSource).toBe("paid");
    expect(() => as("bob", requireSemforgeSubscription)).toThrow(/구독/);
    sqlite.exec("UPDATE semforge_payment_intents SET account_id = 'bob';");
    expect(as("alice", getSemforgeSubscription).active).toBe(false);
    sqlite.exec("UPDATE semforge_payment_intents SET account_id = 'alice'; UPDATE semforge_subscriptions SET current_period_end = '2000-01-01T00:00:00.000Z';");
    expect(as("alice", getSemforgeSubscription).active).toBe(false);
  });

  it("never accepts development payments in live mode or a production process", () => {
    vi.stubEnv("SEMFORGE_BILLING_MODE", "dev");
    activate("alice");
    vi.stubEnv("SEMFORGE_BILLING_MODE", "live");
    expect(as("alice", getSemforgeSubscription).active).toBe(false);
    vi.stubEnv("SEMFORGE_BILLING_MODE", "dev");
    vi.stubEnv("NODE_ENV", "production");
    expect(as("alice", getSemforgeSubscription).active).toBe(false);
    expect(() => as("bob", createSemforgeCheckout)).toThrow(/운영 결제/);
  });

  it("marks role-dependent responses as private and never caches the administrator's access", async () => {
    const response = await subscriptionGET(new NextRequest("https://geo.test/api/semforge/subscription", { headers: userHeaders("geo-admin") }));
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ subscription: { accessSource: "admin", active: true } });
  });

  it("blocks every SEMForge business API method before parsing input or invoking providers", async () => {
    const modules = await Promise.all([
      import("@/app/api/ai-seo/collect/route"), import("@/app/api/ai-seo/overview/route"), import("@/app/api/ai-seo/queries/route"),
      import("@/app/api/analytics/overview/route"), import("@/app/api/position-tracking/route"), import("@/app/api/site-audit/route"),
      import("@/app/api/local-business/route"), import("@/app/api/semforge/all-in/route"), import("@/app/api/semforge/sites/route"),
    ]);
    const upstream = vi.fn(() => { throw new Error("Unexpected external call"); });
    vi.stubGlobal("fetch", upstream);
    let checked = 0;
    for (const routeModule of modules) {
      for (const [method, handler] of Object.entries(routeModule)) {
        if (!/^(GET|POST|PATCH|DELETE)$/.test(method) || typeof handler !== "function") continue;
        const response = await handler(new NextRequest("https://geo.test/api/private", { method, headers: userHeaders("alice") }));
        expect(response.status, method).toBe(402);
        checked++;
      }
    }
    expect(checked).toBe(20);
    expect(upstream).not.toHaveBeenCalled();
  });
});
