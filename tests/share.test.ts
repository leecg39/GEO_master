import { describe, expect, it } from "vitest";
import { aggregateShare, analyzeMentions, classifyFunnel, entityMentioned, heuristicSentiment } from "@/lib/share";

describe("answer share analytics", () => {
  it("normalizes Unicode and ranks entities by first appearance", () => {
    expect(entityMentioned("ＧＥＯ　Master는 좋은 도구", "GEO Master")).toBe(true);
    expect(analyzeMentions("경쟁사A와 브랜드Z, 경쟁사B를 비교합니다.", "브랜드Z", ["경쟁사A", "경쟁사B"])).toEqual({
      brandMentioned: true,
      mentionRank: 2,
      competitorMentions: ["경쟁사A", "경쟁사B"],
    });
  });

  it("provides a deterministic sentiment fallback", () => {
    expect(heuristicSentiment("브랜드Z는 신뢰할 수 있어 추천합니다.", "브랜드Z")).toBe("positive");
    expect(heuristicSentiment("브랜드Z는 문제와 단점이 있어 비추천합니다.", "브랜드Z")).toBe("negative");
    expect(heuristicSentiment("다른 제품입니다.", "브랜드Z")).toBe("neutral");
  });

  it("aggregates model and competitor shares with weighted rank discount", () => {
    const result = aggregateShare([
      { provider: "openai", brandMentioned: true, sentiment: "positive", mentionRank: 1, competitorMentions: ["경쟁사A"] },
      { provider: "openai", brandMentioned: false, sentiment: "neutral", mentionRank: null, competitorMentions: ["경쟁사A"] },
      { provider: "anthropic", brandMentioned: true, sentiment: "neutral", mentionRank: 2, competitorMentions: [] },
      { provider: "gemini", brandMentioned: true, sentiment: "positive", mentionRank: 1, competitorMentions: ["경쟁사B"] },
    ], ["경쟁사A", "경쟁사B"], { openai: .4, anthropic: .35, gemini: .25, grok: .25 });
    expect(result.answerShare).toBe(75);
    expect(result.perModel.openai.share).toBe(50);
    expect(result.competitorComparison[0]).toEqual({ name: "경쟁사A", mentions: 2, share: 50 });
    expect(result.genrank).toBeGreaterThan(50);
    expect(result.funnelStage).toBe("추천");
  });

  it("classifies all four funnel stages", () => {
    expect(classifyFunnel(0, 0)).toBe("존재");
    expect(classifyFunnel(50, 59)).toBe("맥락");
    expect(classifyFunnel(59, 80)).toBe("시의성");
    expect(classifyFunnel(60, 60)).toBe("추천");
  });
});
