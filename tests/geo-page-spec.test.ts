import { describe, expect, it } from "vitest";
import { assembleGeoPageSpec, geoPageSpecSchema } from "@/lib/geo-page-spec";
import { listGeoPrompts } from "@/lib/geo-prompt-catalog";

describe("GeoPageSpec", () => {
  it("assembles required GEO blocks with markdown and JSON-LD", () => {
    const spec = assembleGeoPageSpec({
      topic: "GEO 도구 선택 기준",
      brandName: "GEO Master",
      targetAudience: "B2B 마케터",
      researchNotes: "Easy-Win 메모",
      blocks: [
        { type: "HeroAnswer", id: "h1", title: "핵심", body: "첫 문장 직접 답변입니다.", items: [], faqs: [], ctaLabel: "", ctaHref: "", source: "", sourceDate: "", altText: "", imageUrl: "", entityName: "", proof: "" },
        { type: "KeyTakeaways", id: "k1", title: "TL;DR", body: "", items: ["기준 1", "기준 2"], faqs: [], ctaLabel: "", ctaHref: "", source: "", sourceDate: "", altText: "", imageUrl: "", entityName: "", proof: "" },
        { type: "FAQ", id: "f1", title: "FAQ", body: "", items: [], faqs: [{ question: "무엇인가요?", answer: "정의입니다." }], ctaLabel: "", ctaHref: "", source: "", sourceDate: "", altText: "", imageUrl: "", entityName: "", proof: "" },
        { type: "Speakable", id: "s1", title: "Speakable", body: "한 문장 인용.", items: [], faqs: [], ctaLabel: "", ctaHref: "", source: "", sourceDate: "", altText: "", imageUrl: "", entityName: "", proof: "" },
      ],
    });
    expect(geoPageSpecSchema.parse(spec).version).toBe(1);
    expect(spec.markdown).toContain("GEO 도구 선택 기준");
    expect(spec.jsonLd.blogPosting["@type"]).toBe("BlogPosting");
    expect(spec.jsonLd.faqPage?.["@type"]).toBe("FAQPage");
    expect(spec.jsonLd.speakable?.["@type"]).toBe("WebPage");
  });

  it("exposes local prompt catalog for strategy and studio", () => {
    expect(listGeoPrompts("strategy").length).toBeGreaterThan(0);
    expect(listGeoPrompts("studio").some((item) => item.id === "snippet-writer")).toBe(true);
  });
});
