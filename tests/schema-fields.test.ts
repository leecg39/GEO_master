import { describe, expect, it } from "vitest";
import { analyzeObservation, PAGE_RULES_VERSION } from "@/lib/page-snapshots";
import { evaluateJsonLd, SCHEMA_SPECS } from "@/lib/schema-fields";

const evaluate = (...blocks: unknown[]) => evaluateJsonLd(blocks.map((block) => typeof block === "string" ? block : JSON.stringify(block)));
const only = (...blocks: unknown[]) => evaluate(...blocks).nodes[0]!;

describe("schema field specs", () => {
  it("cites a Google Search Central page and a check date for every spec", () => {
    for (const spec of SCHEMA_SPECS) {
      expect(spec.docUrl, spec.id).toMatch(/^https:\/\/developers\.google\.com\/search\//);
      expect(spec.checkedAt, spec.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe("Google requirements (not RankSEO's table)", () => {
  it("has no required Article or Organization properties, only recommendations", () => {
    expect(only({ "@type": "Article" })).toMatchObject({ status: "ok", missingRequired: [] });
    expect(only({ "@type": "Article" }).missingRecommended).toEqual(expect.arrayContaining(["headline", "image", "datePublished", "author"]));
    expect(only({ "@type": "Organization" })).toMatchObject({ status: "ok", missingRequired: [] });
    expect(only({ "@type": "BlogPosting", headline: "h", image: "i", author: { name: "a" }, datePublished: "2026-01-01", dateModified: "2026-01-02" }).missingRecommended).toEqual([]);
  });

  it("requires a Product name and one of review, aggregateRating or offers", () => {
    expect(only({ "@type": "Product", name: "A" })).toMatchObject({ status: "missing-required", missingRequired: ["review | aggregateRating | offers"] });
    expect(only({ "@type": "Product", name: "A", offers: { "@type": "Offer", price: 1000 } }).missingRequired).toEqual([]);
    expect(only({ "@type": "Product", offers: { "@type": "Offer", price: 1 } }).missingRequired).toEqual(["name"]);
  });

  it("checks the nested offer shape", () => {
    expect(only({ "@type": "Product", name: "A", offers: { "@type": "Offer" } }).missingRequired).toEqual(["offers.price"]);
    expect(only({ "@type": "Product", name: "A", offers: { "@type": "Offer", priceSpecification: { price: 5 } } }).missingRequired).toEqual([]);
    expect(only({ "@type": "Product", name: "A", offers: { "@type": "AggregateOffer", lowPrice: 1 } }).missingRequired).toEqual(["offers.priceCurrency"]);
  });

  it("treats a price of zero as present", () => {
    expect(only({ "@type": "SoftwareApplication", name: "App", offers: { price: 0 }, aggregateRating: { ratingValue: 4, ratingCount: 3 } }).missingRequired).toEqual([]);
    expect(only({ "@type": "MobileApplication", name: "App", offers: { price: 0 } }).missingRequired).toEqual(["aggregateRating | review"]);
  });

  it("requires Recipe image and name", () => {
    expect(only({ "@type": "Recipe", name: "김치찌개" }).missingRequired).toEqual(["image"]);
  });

  it("requires a venue address for physical events but not for online ones", () => {
    expect(only({ "@type": "Event", name: "E", startDate: "2026-11-01", location: { "@type": "Place", name: "Hall" } }).missingRequired).toEqual(["location.address"]);
    expect(only({ "@type": "Event", name: "E", startDate: "2026-11-01", location: { "@type": "VirtualLocation", url: "https://x" } }).missingRequired).toEqual([]);
  });

  it("checks breadcrumb list items, allowing the last item to omit its URL", () => {
    const list = (items: unknown[]) => only({ "@type": "BreadcrumbList", itemListElement: items });
    expect(list([{ position: 1, name: "홈", item: "https://a.com" }, { position: 2, name: "현재" }]).missingRequired).toEqual([]);
    expect(list([{ position: 1, name: "홈" }, { name: "현재" }]).missingRequired).toEqual(["itemListElement[1].item", "itemListElement[2].position"]);
    expect(only({ "@type": "BreadcrumbList" }).missingRequired).toEqual(["itemListElement"]);
  });

  it("requires ratingCount or reviewCount on a standalone AggregateRating", () => {
    expect(only({ "@type": "AggregateRating", itemReviewed: { name: "A" }, ratingValue: 4 }).missingRequired).toEqual(["ratingCount | reviewCount"]);
  });

  it("accepts any LocalBusiness subtype it knows and asks for name and address", () => {
    expect(only({ "@type": "Restaurant", name: "식당" })).toMatchObject({ specId: "local-business", missingRequired: ["address"] });
  });

  it("matches an author array when any author has a name", () => {
    expect(only({ "@type": "Article", author: [{ "@type": "Person" }, { name: "B" }] }).missingRecommended).not.toContain("author.name");
  });
});

describe("parsing and scope", () => {
  it("reads @graph and arrays but not nested entities", () => {
    const report = evaluate({ "@context": "https://schema.org", "@graph": [{ "@type": "Organization", name: "O" }, { "@type": "WebSite", name: "W" }] },
      [{ "@type": "Product", name: "P", review: { "@type": "Review", reviewRating: { ratingValue: 5 } } }]);
    expect(report.nodes.map((node) => node.type)).toEqual(["Organization", "Product"]);
    expect(report.unchecked).toEqual(["WebSite"]);
  });

  it("skips blocks that do not parse (jsonld-parse already reports them)", () => {
    expect(evaluate("{ broken", { "@type": "Recipe", name: "x", image: "y" }).nodes).toHaveLength(1);
  });

  it("marks FAQPage and HowTo as no longer shown by Google instead of judging fields", () => {
    expect(only({ "@type": "FAQPage" })).toMatchObject({ status: "not-shown-by-google", missingRequired: [] });
    expect(only({ "@type": "HowTo" }).status).toBe("not-shown-by-google");
  });

  it("uses the first known type when @type is an array and ignores prototype keys", () => {
    expect(only({ "@type": ["Thing", "Product"], name: "P", offers: { price: 1 } })).toMatchObject({ type: "Product", missingRequired: [] });
    expect(evaluate({ "@type": "__proto__" }).unchecked).toEqual(["__proto__"]);
    expect(evaluate({ "@type": "constructor" }).nodes).toEqual([]);
  });

  it("understands full schema.org IRIs as types", () => {
    expect(only({ "@type": "https://schema.org/Recipe", name: "x" })).toMatchObject({ type: "Recipe", missingRequired: ["image"] });
    expect(only({ "@type": "http://schema.org/Recipe", name: "x", image: "i" }).missingRequired).toEqual([]);
    expect(only({ "@type": "schema:Recipe", name: "x", image: "i" }).type).toBe("Recipe");
  });

  it("asks for a Place address when an event location is plain text", () => {
    expect(only({ "@type": "Event", name: "E", startDate: "2026-11-01", location: "서울" }).missingRequired).toEqual(["location.address"]);
  });

  it("caps the work on huge graphs", () => {
    const graph = Array.from({ length: 500 }, (_, index) => ({ "@type": "Product", name: `P${index}` }));
    expect(evaluate({ "@graph": graph }).nodes.length).toBeLessThanOrEqual(100);
  });

  it("treats whitespace-only strings, empty objects, and arrays of empty strings as missing, and supports array @type on nested nodes", () => {
    expect(only({ "@type": "Product", name: "   ", offers: { price: 10 } }).missingRequired).toEqual(["name"]);
    expect(only({ "@type": "LocalBusiness", name: "가게", address: {} }).missingRequired).toEqual(["address"]);
    expect(only({ "@type": "Recipe", name: "요리", image: ["", "   "] }).missingRequired).toEqual(["image"]);
    expect(only({ "@type": "Event", name: "웨비나", startDate: "2026-11-01", location: { "@type": ["VirtualLocation"], url: "https://x" } }).missingRequired).toEqual([]);
    expect(only({ "@type": "Product", name: "A", offers: { "@type": ["https://schema.org/AggregateOffer"], lowPrice: 100 } }).missingRequired).toEqual(["offers.priceCurrency"]);
  });
});

describe("page findings", () => {
  const page = (jsonLd: unknown) => analyzeObservation({
    url: "https://example.com/p", finalUrl: "https://example.com/p", statusCode: 200, contentType: "text/html", renderMode: "native", bodyKind: "html",
    body: `<html lang="ko"><head><title>상품</title><script type="application/ld+json">${JSON.stringify(jsonLd)}</script></head><body><h1>상품</h1></body></html>`,
  }, "example.com").findings;

  it("bumps the rule version", () => {
    expect(PAGE_RULES_VERSION).toMatch(/^page-rules\/([3-9]|\d{2,})$/);
  });

  it("reports missing required properties as a technical warning with the type and property", () => {
    const finding = page({ "@type": "Product", name: "A" }).find((item) => item.code === "schema-required");
    expect(finding).toMatchObject({ passed: false, tier: "technical", severity: "warning" });
    expect(finding?.detail).toContain("Product");
    expect(finding?.detail).toContain("review | aggregateRating | offers");
  });

  it("reports missing recommended properties only as a notice", () => {
    const findings = page({ "@type": "Article", headline: "h" });
    expect(findings.find((item) => item.code === "schema-required")?.passed).toBe(true);
    expect(findings.find((item) => item.code === "schema-recommended")).toMatchObject({ passed: false, tier: "recommendation", severity: "notice" });
  });

  it("explains FAQPage without failing it", () => {
    const finding = page({ "@type": "FAQPage", mainEntity: [] }).find((item) => item.code === "schema-required");
    expect(finding?.passed).toBe(true);
    expect(finding?.detail).toMatch(/FAQPage.*표시하지 않/);
  });
});
