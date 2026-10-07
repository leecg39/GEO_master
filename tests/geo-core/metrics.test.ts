import { describe, expect, it } from "vitest";
import { collectionQuality, questionMatrix, ratio, type SlotRow } from "@/lib/geo-core";

const slot = (question: string, provider: string, status: SlotRow["status"], brandMentioned = false): SlotRow => ({
  question,
  provider,
  status,
  brandMentioned,
});

describe("ratio", () => {
  it("keeps numerator and denominator and returns null value for an empty denominator", () => {
    expect(ratio(2, 3)).toEqual({ numerator: 2, denominator: 3, value: 66.7 });
    expect(ratio(0, 0)).toEqual({ numerator: 0, denominator: 0, value: null });
  });
});

describe("questionMatrix", () => {
  it("reports k/n per question and provider using only succeeded slots as the denominator", () => {
    const rows = [
      slot("Q1", "openai", "succeeded", true),
      slot("Q1", "openai", "succeeded", false),
      slot("Q1", "openai", "refused"),
      slot("Q1", "gemini", "failed"),
      slot("Q1", "gemini", "failed"),
    ];
    expect(questionMatrix(rows)).toEqual([
      { question: "Q1", provider: "openai", mentioned: 1, valid: 2, refused: 1, failed: 0, planned: 3, label: "1/2" },
      { question: "Q1", provider: "gemini", mentioned: 0, valid: 0, refused: 0, failed: 2, planned: 2, label: "N/A" },
    ]);
  });

  it("keeps first-seen question order", () => {
    const rows = [slot("B", "openai", "succeeded"), slot("A", "openai", "succeeded", true)];
    expect(questionMatrix(rows).map((cell) => cell.question)).toEqual(["B", "A"]);
  });
});

describe("collectionQuality", () => {
  it("separates refused and failed slots and counts refusals as collected", () => {
    const rows = [
      slot("Q1", "openai", "succeeded"),
      slot("Q1", "openai", "refused"),
      slot("Q2", "openai", "failed"),
      slot("Q2", "openai", "succeeded"),
    ];
    expect(collectionQuality(rows)).toEqual({
      planned: 4,
      succeeded: 2,
      refused: 1,
      failed: 1,
      completionRate: { numerator: 3, denominator: 4, value: 75 },
      refusalRate: { numerator: 1, denominator: 3, value: 33.3 },
    });
  });

  it("returns N/A rates when nothing was planned", () => {
    expect(collectionQuality([]).completionRate.value).toBeNull();
  });
});
