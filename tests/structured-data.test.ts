import { describe, expect, it } from "vitest";
import { buildJsonLd, checkAgainstPage, validateJsonLd } from "@/lib/structured-data";

describe("buildJsonLd", () => {
  it("builds Organization only from provided fields and reports missing required ones", () => {
    const ok = buildJsonLd("Organization", { name: "채널톡", url: "https://channel.io", sameAs: ["https://www.linkedin.com/company/channel-io"] });
    expect(ok.jsonLd).toEqual({ "@context": "https://schema.org", "@type": "Organization", "@id": "https://channel.io/#organization", name: "채널톡", url: "https://channel.io", sameAs: ["https://www.linkedin.com/company/channel-io"] });
    expect(ok.missing).toEqual([]);
    const bad = buildJsonLd("Organization", { name: "채널톡" });
    expect(bad.missing).toEqual(["url"]);
    expect(bad.jsonLd).toBeNull();
  });

  it("never invents Product price, rating or availability; evidence-less values are blocked", () => {
    const noEvidence = buildJsonLd("Product", { name: "상담 플랜", url: "https://channel.io/plan", price: "12000", priceCurrency: "KRW", ratingValue: "4.8", ratingCount: "120" });
    expect(noEvidence.blocked.map((item) => item.field).sort()).toEqual(["price", "ratingValue"]);
    expect(noEvidence.jsonLd).not.toHaveProperty("offers");
    expect(noEvidence.jsonLd).not.toHaveProperty("aggregateRating");
    const withEvidence = buildJsonLd("Product", { name: "상담 플랜", url: "https://channel.io/plan", price: "12000", priceCurrency: "KRW", evidence: { price: "https://channel.io/pricing" } });
    expect(withEvidence.blocked).toEqual([]);
    expect(withEvidence.jsonLd).toMatchObject({ "@type": "Product", offers: { "@type": "Offer", price: "12000", priceCurrency: "KRW", url: "https://channel.io/plan" } });
  });

  it("builds BreadcrumbList positions, BlogPosting and WebSite", () => {
    const crumbs = buildJsonLd("BreadcrumbList", { items: [{ name: "홈", url: "https://channel.io" }, { name: "블로그", url: "https://channel.io/blog" }] });
    expect(crumbs.jsonLd).toMatchObject({ itemListElement: [{ position: 1, name: "홈" }, { position: 2, name: "블로그" }] });
    expect(buildJsonLd("BreadcrumbList", { items: [] }).missing).toEqual(["items"]);
    const post = buildJsonLd("BlogPosting", { headline: "제목", datePublished: "2026-10-01", authorName: "홍길동", url: "https://channel.io/blog/a" });
    expect(post.jsonLd).toMatchObject({ "@type": "BlogPosting", author: { "@type": "Person", name: "홍길동" } });
    expect(buildJsonLd("BlogPosting", { headline: "제목", datePublished: "10월 1일", authorName: "a" }).blocked.map((b) => b.field)).toContain("datePublished");
    expect(buildJsonLd("WebSite", { name: "채널톡", url: "https://channel.io" }).jsonLd).toMatchObject({ "@type": "WebSite" });
  });
});

describe("validateJsonLd / checkAgainstPage", () => {
  const product = buildJsonLd("Product", { name: "상담 플랜", url: "https://channel.io/plan", price: "12000", priceCurrency: "KRW", evidence: { price: "https://channel.io/pricing" } }).jsonLd!;

  it("passes structurally valid markup and flags missing required fields", () => {
    expect(validateJsonLd(product)).toEqual([]);
    expect(validateJsonLd({ "@context": "https://schema.org", "@type": "Product" }).map((issue) => issue.code)).toContain("MISSING_NAME");
    expect(validateJsonLd({ "@type": "Thing" }).map((issue) => issue.code)).toContain("MISSING_CONTEXT");
  });

  it("blocks markup whose price is not shown on the page", () => {
    expect(checkAgainstPage(product, "상담 플랜 월 12,000원부터").blocking).toEqual([]);
    const mismatch = checkAgainstPage(product, "상담 플랜 월 9,900원부터");
    expect(mismatch.blocking.map((issue) => issue.code)).toEqual(["PRICE_NOT_VISIBLE"]);
  });

  it("detects entities that already exist on the page and suggests linking by @id", () => {
    const existing = [{ "@context": "https://schema.org", "@type": "Organization", "@id": "https://channel.io/#organization", name: "채널톡", url: "https://channel.io" }];
    const org = buildJsonLd("Organization", { name: "채널톡", url: "https://channel.io" }).jsonLd!;
    const result = checkAgainstPage(org, "채널톡", existing);
    expect(result.duplicates).toEqual([{ type: "Organization", id: "https://channel.io/#organization", suggestion: "link" }]);
    const other = checkAgainstPage(buildJsonLd("WebSite", { name: "채널톡", url: "https://channel.io" }).jsonLd!, "채널톡", existing);
    expect(other.duplicates).toEqual([]);
  });
});
