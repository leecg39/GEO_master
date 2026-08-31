import { describe, expect, it } from "vitest";
import { LEARN_CHECKLIST } from "@/lib/learn-content";
import { generateFaqJsonLd, generateOrganizationJsonLd } from "@/lib/studio";

describe("structured content generators", () => {
  it("builds valid FAQPage JSON-LD", () => {
    const jsonLd = generateFaqJsonLd([{ question: "GEO란?", answer: "생성형 검색 최적화입니다." }]);
    expect(JSON.parse(JSON.stringify(jsonLd))).toMatchObject({
      "@context": "https://schema.org", "@type": "FAQPage",
      mainEntity: [{ "@type": "Question", name: "GEO란?", acceptedAnswer: { "@type": "Answer" } }],
    });
  });
  it("omits empty optional organization URLs", () => {
    const jsonLd = generateOrganizationJsonLd({ company: "예시", description: "설명", sameAs: ["https://example.com/profile"] });
    expect(jsonLd).toEqual({ "@context": "https://schema.org", "@type": "Organization", name: "예시", sameAs: ["https://example.com/profile"], description: "설명" });
  });
  it("contains 38 unique checklist items across six execution areas", () => {
    expect(LEARN_CHECKLIST).toHaveLength(38);
    expect(new Set(LEARN_CHECKLIST.map((item) => item.id)).size).toBe(38);
    expect(new Set(LEARN_CHECKLIST.map((item) => item.category)).size).toBe(6);
  });
});
