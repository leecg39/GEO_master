import { describe, expect, it } from "vitest";
import { aggregateMonthlyTrends, aggregateQuestionPerformance, parseDashboardSummary } from "@/lib/dashboard";

describe("dashboard monthly trends", () => {
  it("weights answer share by raw response counts instead of averaging percentages", () => {
    const trends = aggregateMonthlyTrends([
      {
        createdAt: "2026-09-02T00:00:00.000Z",
        answerShare: 10,
        summary: JSON.stringify({ total: 20, mentions: 2, perModel: { openai: { total: 20, mentions: 2, share: 10 } } }),
      },
      {
        createdAt: "2026-09-01T00:00:00.000Z",
        answerShare: 100,
        summary: JSON.stringify({ total: 2, mentions: 2, perModel: { openai: { total: 2, mentions: 2, share: 100 } } }),
      },
    ]);
    expect(trends).toEqual([{ month: "2026-09", overall: 18.2, openai: 18.2, anthropic: null, gemini: null, grok: null }]);
  });

  it("keeps months separate and tolerates legacy malformed summaries", () => {
    const trends = aggregateMonthlyTrends([
      { createdAt: "2026-08-01", answerShare: 40, summary: "invalid" },
      { createdAt: "2026-09-01", answerShare: 60, summary: "{}" },
    ]);
    expect(trends.map((item) => [item.month, item.overall])).toEqual([["2026-09", 60], ["2026-08", 40]]);
  });

  it("aggregates each monitored question and compares it with the previous run", () => {
    const current = aggregateQuestionPerformance([
      { questionText: "어떤 도구가 좋은가요?", provider: "openai", brandMentioned: true, sentiment: "positive", mentionRank: 1 },
      { questionText: "어떤 도구가 좋은가요?", provider: "gemini", brandMentioned: false, sentiment: "neutral", mentionRank: null },
      { questionText: "비교 기준은?", provider: "openai", brandMentioned: true, sentiment: "neutral", mentionRank: 3 },
    ], [
      { questionText: "어떤 도구가 좋은가요?", provider: "openai", brandMentioned: false, sentiment: "neutral", mentionRank: null },
      { questionText: "어떤 도구가 좋은가요?", provider: "gemini", brandMentioned: false, sentiment: "neutral", mentionRank: null },
    ]);

    expect(current).toEqual([
      {
        text: "어떤 도구가 좋은가요?",
        total: 2,
        mentions: 1,
        share: 50,
        averageRank: 1,
        positiveRate: 100,
        previousShare: 0,
        delta: 50,
      },
      {
        text: "비교 기준은?",
        total: 1,
        mentions: 1,
        share: 100,
        averageRank: 3,
        positiveRate: 0,
        previousShare: null,
        delta: null,
      },
    ]);
  });
});


describe("dashboard summary safety", () => {
  it("normalizes legacy numeric strings and rejects non-finite values", () => {
    const summary = parseDashboardSummary(JSON.stringify({
      total: "5",
      mentions: "3",
      positiveRate: "80",
      perModel: { openai: { total: "5", mentions: "3", share: "60" }, gemini: { total: 5, share: "invalid" } },
      competitorComparison: [{ name: "경쟁사", share: "20", mentions: "1" }],
    }));

    expect(summary).toMatchObject({
      total: 5,
      mentions: 3,
      positiveRate: 80,
      perModel: { openai: { total: 5, mentions: 3, share: 60 }, gemini: { total: 5, share: 0 } },
      competitorComparison: [{ name: "경쟁사", share: 20, mentions: 1 }],
    });
  });
});