import { describe, expect, it } from "vitest";
import { formatRatio, parseMeasurementEvidence } from "@/lib/measurement-evidence";

describe("parseMeasurementEvidence", () => {
  it("reads quality and question matrix from a run summary", () => {
    const evidence = parseMeasurementEvidence({
      metricVersion: "m1.0",
      quality: {
        planned: 4, succeeded: 2, refused: 1, failed: 1,
        completionRate: { numerator: 3, denominator: 4, value: 75 },
        refusalRate: { numerator: 1, denominator: 3, value: 33.3 },
      },
      questionMatrix: [
        { question: "Q1", provider: "openai", mentioned: 1, valid: 2, refused: 0, failed: 0, planned: 2, label: "1/2" },
        { question: "bad" },
      ],
    });
    expect(evidence.legacy).toBe(false);
    expect(evidence.metricVersion).toBe("m1.0");
    expect(evidence.quality?.failed).toBe(1);
    expect(evidence.questionMatrix).toHaveLength(1);
    expect(evidence.questions).toEqual(["Q1"]);
  });

  it("marks summaries without a metric version as legacy", () => {
    const evidence = parseMeasurementEvidence({ answerShare: 10 });
    expect(evidence).toEqual({ legacy: true, metricVersion: "legacy", quality: null, questionMatrix: [], questions: [], providers: [], searchMode: "off", citations: null });
  });
});

describe("citation evidence", () => {
  it("reads a web-search citation summary and ignores malformed ones", () => {
    const citations = {
      ownCitationCoverage: { numerator: 1, denominator: 2, value: 50 }, perProvider: {}, citedByCategory: { own: 1 },
      searchedCount: 0, topDomains: [], pagesCitedWithoutBrand: [],
    };
    expect(parseMeasurementEvidence({ metricVersion: "m1.0", searchMode: "web", citations }).citations).toEqual(citations);
    expect(parseMeasurementEvidence({ metricVersion: "m1.0", searchMode: "web", citations: { bad: true } }).citations).toBeNull();
  });
});

describe("formatRatio", () => {
  it("shows numerator, denominator and N/A for an empty denominator", () => {
    expect(formatRatio({ numerator: 3, denominator: 4, value: 75 })).toBe("75% (3/4)");
    expect(formatRatio({ numerator: 0, denominator: 0, value: null })).toBe("N/A (0/0)");
  });
});
