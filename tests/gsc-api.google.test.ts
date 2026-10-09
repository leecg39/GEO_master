import { afterEach, describe, expect, it, vi } from "vitest";
import { listSites, querySearchAnalytics, refreshAccessToken, revokeToken } from "@/lib/gsc-api/google";

const config = { clientId: "fake-client", clientSecret: "fake-secret", redirectUri: "http://localhost/callback" };
const operations = {
  sites: () => listSites("fake-access"),
  query: () => querySearchAnalytics("fake-access", "sc-domain:example.com", {}),
  refresh: () => refreshAccessToken(config, "fake-refresh"),
};
function respond(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })));
}
afterEach(() => vi.unstubAllGlobals());

describe.each(Object.entries(operations))("Google errors: %s", (_name, operation) => {
  it.each(["quotaExceeded", "rateLimitExceeded", "userRateLimitExceeded", "dailyLimitExceeded", "concurrentLimitExceeded", "servingLimitExceeded"])("classifies 403 %s as a quota failure", async (reason) => {
    respond(403, { error: { errors: [{ reason: "forbidden" }, { reason }], message: "fake-secret" } });
    await expect(operation()).rejects.toMatchObject({ code: "GSC_RATE_LIMITED", status: 429 });
  });
  it.each([
    { status: "RESOURCE_EXHAUSTED" },
    { details: [{ reason: "RATE_LIMIT_EXCEEDED" }] },
  ])("supports structured quota errors", async (error) => {
    respond(403, { error });
    await expect(operation()).rejects.toMatchObject({ code: "GSC_RATE_LIMITED", status: 429 });
  });
  it("preserves actual permission failures without exposing Google's message", async () => {
    respond(403, { error: { errors: [{ reason: "insufficientPermissions" }], message: "fake-secret" } });
    const error = await operation().catch((cause: unknown) => cause);
    expect(error).toMatchObject({ code: "GSC_PERMISSION_DENIED", status: 403 });
    expect(String(error).includes("fake-secret")).toBe(false);
  });
  it.each([null, [], { error: null }, { error: { errors: [null, 1], details: "invalid" } }])("handles malformed error bodies safely", async (body) => {
    respond(403, body);
    await expect(operation()).rejects.toMatchObject({ code: "GSC_PERMISSION_DENIED" });
  });
  it("retains HTTP 429 classification", async () => {
    respond(429, {});
    await expect(operation()).rejects.toMatchObject({ code: "GSC_RATE_LIMITED", status: 429 });
  });
});

describe("Google revocation", () => {
  it("accepts an empty HTTP 200 response and sends the token in the body, not the URL", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(revokeToken("fake-refresh")).resolves.toBeUndefined();
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://oauth2.googleapis.com/revoke");
    expect(init.method).toBe("POST");
    expect(new URLSearchParams(String(init.body)).get("token") === "fake-refresh").toBe(true);
  });
  it.each([204, 400, 401, 403, 429, 500, 503])("rejects HTTP %s without leaking the response", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(status === 204 ? null : "fake-refresh", { status })));
    const error = await revokeToken("fake-refresh").catch((cause: unknown) => cause);
    expect(error).toMatchObject({ code: "GSC_REVOCATION_FAILED", status: 502 });
    expect(String(error).includes("fake-refresh")).toBe(false);
  });
  it("sanitizes network exceptions", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fake-refresh fake-secret")));
    const error = await revokeToken("fake-refresh").catch((cause: unknown) => cause);
    expect(error).toMatchObject({ code: "GSC_REVOCATION_FAILED" });
    expect(String(error).includes("fake-")).toBe(false);
  });
});
