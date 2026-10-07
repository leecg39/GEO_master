import { describe, expect, it } from "vitest";
import { summarizeCitations, type CitationSlot } from "@/lib/geo-core";

const cite = (url: string, domain: string, category: string, kind: "cited" | "searched" | "inline" = "cited") => ({ url, domain, category, kind });

describe("summarizeCitations", () => {
  const slots: CitationSlot[] = [
    { provider: "openai", status: "succeeded", citationSupported: true, brandMentioned: true, citations: [cite("https://own.kr/a", "own.kr", "own"), cite("https://own.kr/b", "own.kr", "own")] },
    { provider: "openai", status: "succeeded", citationSupported: true, brandMentioned: false, citations: [cite("https://rival.com/p", "rival.com", "competitor"), cite("https://news.kr/1", "news.kr", "media", "searched")] },
    { provider: "openai", status: "refused", citationSupported: true, brandMentioned: false, citations: [cite("https://own.kr/c", "own.kr", "own")] },
    { provider: "grok", status: "succeeded", citationSupported: false, brandMentioned: false, citations: [] },
  ];

  it("computes own citation coverage over succeeded answers whose provider supports citations", () => {
    const summary = summarizeCitations(slots);
    expect(summary.ownCitationCoverage).toEqual({ numerator: 1, denominator: 2, value: 50 });
    expect(summary.perProvider.openai).toEqual({ numerator: 1, denominator: 2, value: 50 });
    expect(summary.perProvider.grok).toEqual({ numerator: 0, denominator: 0, value: null });
  });

  it("counts explicit citations by category and keeps searched results separate", () => {
    const summary = summarizeCitations(slots);
    expect(summary.citedByCategory).toEqual({ own: 2, competitor: 1 });
    expect(summary.searchedCount).toBe(1);
    expect(summary.topDomains[0]).toEqual({ domain: "own.kr", category: "own", count: 2 });
  });

  it("lists pages cited in answers that did not mention the brand", () => {
    const summary = summarizeCitations(slots);
    expect(summary.pagesCitedWithoutBrand).toEqual([{ url: "https://rival.com/p", domain: "rival.com", category: "competitor", count: 1 }]);
  });

  it("returns N/A coverage when no provider supported citations", () => {
    expect(summarizeCitations([slots[3]!]).ownCitationCoverage.value).toBeNull();
  });

  it("counts inline text URLs separately and keeps them out of coverage", () => {
    const summary = summarizeCitations([
      { provider: "anthropic", status: "succeeded", citationSupported: true, brandMentioned: false, citations: [cite("https://own.kr/x", "own.kr", "own", "inline"), cite("https://rival.com/y", "rival.com", "competitor", "inline")] },
    ]);
    expect(summary.ownCitationCoverage).toEqual({ numerator: 0, denominator: 1, value: 0 });
    expect(summary.inlineCount).toBe(2);
    expect(summary.pagesCitedWithoutBrand).toEqual([]);
  });
});

