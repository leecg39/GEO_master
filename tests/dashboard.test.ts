import { describe, expect, it } from "vitest";
import { aggregateMonthlyTrends } from "@/lib/dashboard";

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
    expect(trends).toEqual([{ month: "2026-09", overall: 18.2, openai: 18.2, anthropic: null, gemini: null }]);
  });

  it("keeps months separate and tolerates legacy malformed summaries", () => {
    const trends = aggregateMonthlyTrends([
      { createdAt: "2026-08-01", answerShare: 40, summary: "invalid" },
      { createdAt: "2026-09-01", answerShare: 60, summary: "{}" },
    ]);
    expect(trends.map((item) => [item.month, item.overall])).toEqual([["2026-09", 60], ["2026-08", 40]]);
  });
});
