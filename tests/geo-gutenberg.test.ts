import { describe, expect, it } from "vitest";
import { assembleGeoPageSpec } from "@/lib/geo-page-spec";
import { geoPageSpecToGutenberg, slugifyTopic } from "@/lib/geo-gutenberg";

describe("geo gutenberg adapter", () => {
  it("renders core Gutenberg blocks from GeoPageSpec", () => {
    const spec = assembleGeoPageSpec({
      topic: "GEO 도구 선택",
      brandName: "TestBrand",
      targetAudience: "마케터",
      blocks: [
        { type: "HeroAnswer", id: "h1", title: "핵심", body: "직접 답변입니다.", items: [], faqs: [], ctaLabel: "", ctaHref: "", source: "", sourceDate: "", altText: "", imageUrl: "", entityName: "", proof: "" },
        { type: "KeyTakeaways", id: "k1", title: "TL;DR", body: "", items: ["A", "B"], faqs: [], ctaLabel: "", ctaHref: "", source: "", sourceDate: "", altText: "", imageUrl: "", entityName: "", proof: "" },
        { type: "FAQ", id: "f1", title: "FAQ", body: "", items: [], faqs: [{ question: "무엇인가요?", answer: "인용 준비 도구입니다." }], ctaLabel: "", ctaHref: "", source: "", sourceDate: "", altText: "", imageUrl: "", entityName: "", proof: "" },
        { type: "CTA", id: "c1", title: "CTA", body: "", items: [], faqs: [], ctaLabel: "시작", ctaHref: "https://example.com", source: "", sourceDate: "", altText: "", imageUrl: "", entityName: "", proof: "" },
      ],
    });
    const html = geoPageSpecToGutenberg(spec);
    expect(html).toContain("<!-- wp:heading");
    expect(html).toContain("geo-key-takeaways");
    expect(html).toContain("application/ld+json");
    expect(html).toContain("wp-block-button");
    expect(slugifyTopic(spec.topic).length).toBeGreaterThan(0);
  });
});
