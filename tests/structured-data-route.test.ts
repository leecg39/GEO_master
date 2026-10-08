import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/url-security", () => ({ fetchPublicText: vi.fn() }));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/structured-data/route";
import { fetchPublicText } from "@/lib/url-security";

const call = (body: unknown) => POST(new NextRequest("http://localhost/api/structured-data", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
const html = (ld: string, body: string) => ({ url: "https://channel.io/plan", status: 200, contentType: "text/html", text: `<html><head><script type="application/ld+json">${ld}</script></head><body>${body}</body></html>` });

beforeEach(() => { vi.mocked(fetchPublicText).mockReset(); });

describe("POST /api/structured-data", () => {
  it("generates without a page and reports missing fields", async () => {
    const response = await call({ type: "Organization", input: { name: "채널톡" } });
    expect(await response.json()).toMatchObject({ jsonLd: null, missing: ["url"], publishable: false });
  });

  it("checks against the live page: visible price passes, hidden price blocks, existing entity is flagged", async () => {
    const input = { name: "상담 플랜", url: "https://channel.io/plan", price: "12000", priceCurrency: "KRW", evidence: { price: "https://channel.io/pricing" } };
    vi.mocked(fetchPublicText).mockResolvedValueOnce(html("{}", "상담 플랜 월 12,000원"));
    const ok = await (await call({ type: "Product", input, pageUrl: "https://channel.io/plan" })).json();
    expect(ok).toMatchObject({ publishable: true, blocking: [], duplicates: [] });
    vi.mocked(fetchPublicText).mockResolvedValueOnce(html('{"@context":"https://schema.org","@type":"Product","name":"상담 플랜"}', "상담 플랜 월 9,900원"));
    const bad = await (await call({ type: "Product", input, pageUrl: "https://channel.io/plan" })).json();
    expect(bad.publishable).toBe(false);
    expect(bad.blocking.map((issue: { code: string }) => issue.code)).toEqual(["PRICE_NOT_VISIBLE"]);
    expect(bad.duplicates).toHaveLength(1);
  });

  it("rejects unknown types and non-http page URLs", async () => {
    expect((await call({ type: "Recipe", input: {} })).status).toBe(422);
    expect((await call({ type: "Organization", input: { name: "a", url: "https://a.io" }, pageUrl: "file:///etc/passwd" })).status).toBe(422);
  });
});
