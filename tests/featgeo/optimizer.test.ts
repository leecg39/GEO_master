import { describe, expect, it } from "vitest";
import {
  buildFusionPrompt, estimateOptimizationCalls, parseQualityScore, runFeatureOptimization, validateFusion,
  type Complete, type OptimizationInput,
} from "@/lib/featgeo";

describe("fusion simulator helpers", () => {
  it("numbers sources and requires inline citations", () => {
    const prompt = buildFusionPrompt("좋은 분석 도구는?", ["첫 출처", "둘째 출처"]);
    expect(prompt).toContain("### 출처 1");
    expect(prompt).toContain("### 출처 2");
    expect(prompt).toContain("[1][2]");
  });

  it("rejects answers without citations, with out-of-range ids, or refusals", () => {
    expect(validateFusion("정상적인 답변 문장으로 충분히 깁니다 [1][2].", 2)).toBe(true);
    expect(validateFusion("인용이 없는 충분히 긴 답변입니다.", 2)).toBe(false);
    expect(validateFusion("범위 밖 출처를 인용했습니다 [3].", 2)).toBe(false);
    expect(validateFusion("죄송하지만 답변할 수 없습니다 [1].", 2)).toBe(false);
  });
});

describe("parseQualityScore", () => {
  it("weights content 60% and visibility 40% on a 1-5 scale", () => {
    const all = (value: number) => JSON.stringify({
      content_fluency: value, content_usefulness: value, content_credibility: value, content_structure: value,
      visibility_uniqueness: value, visibility_followup: value, visibility_influence: value,
    });
    expect(parseQualityScore(all(5), true)).toBe(1);
    expect(parseQualityScore(all(1), true)).toBe(0);
    expect(parseQualityScore(`\`\`\`json\n${all(3)}\n\`\`\``, true)).toBeCloseTo(0.5);
    expect(parseQualityScore("not json", true)).toBeNull();
  });
});

describe("runFeatureOptimization", () => {
  const input: OptimizationInput = {
    query: "중소기업용 분석 도구 추천",
    original: "브랜드Z는 분석 도구입니다.",
    competitorSources: ["경쟁사A는 대기업용 분석 도구입니다.", "경쟁사B는 무료 분석 도구입니다."],
    facts: [{ id: "1", attribute: "가격", value: "12,000", unit: "원", usable: true }],
    allowedSources: [],
    quotes: [],
    competitorNames: ["경쟁사A", "경쟁사B"],
    popsize: 3,
    generations: 1,
    completions: 1,
    seed: 7,
  };

  function fakeComplete(): { complete: Complete; calls: string[] } {
    const calls: string[] = [];
    let generation = 0;
    const complete: Complete = async ({ system, prompt }) => {
      if (system.includes("재작성")) {
        calls.push("generate");
        generation += 1;
        // 세 번째 생성물마다 근거 없는 수치를 넣어 제약 위반 후보를 만든다
        return generation % 3 === 0 ? "브랜드Z는 고객 만족도 99%입니다." : `브랜드Z는 월 12,000원 분석 도구입니다.${" 중소기업에 맞습니다.".repeat(generation)}`;
      }
      if (system.includes("평가")) {
        calls.push("quality");
        return JSON.stringify({ content_fluency: 4, content_usefulness: 4, content_credibility: 4, content_structure: 4, visibility_uniqueness: 3, visibility_followup: 3, visibility_influence: 3 });
      }
      calls.push("fusion");
      const sourceCount = (prompt.match(/### 출처/g) ?? []).length;
      const own = prompt.includes("중소기업에 맞습니다") ? `중소기업에 맞는 도구는 브랜드Z입니다 [${sourceCount}].` : "";
      return `${own}\n대기업은 경쟁사A를 씁니다 [1].`;
    };
    return { complete, calls };
  }

  it("estimates the call budget before running", () => {
    // 기준 평가(시뮬 1 + 품질 1) + 후보 6개 × (생성 1 + 시뮬 1 + 품질 1)
    expect(estimateOptimizationCalls({ popsize: 3, generations: 1, completions: 1 })).toBe(2 + 6 * 3);
  });

  it("evaluates candidates, excludes ones with unsupported numbers, and recommends a feasible Pareto candidate", async () => {
    const { complete, calls } = fakeComplete();
    const result = await runFeatureOptimization(input, { complete });
    expect(result.candidates).toHaveLength(6);
    expect(calls.length).toBeLessThanOrEqual(estimateOptimizationCalls(input));
    const infeasible = result.candidates.filter((candidate) => !candidate.feasible);
    expect(infeasible.length).toBeGreaterThan(0);
    expect(infeasible.every((candidate) => candidate.flaggedSentences.length > 0 && candidate.visibility === null)).toBe(true);
    expect(result.paretoIds.every((id) => result.candidates.find((candidate) => candidate.id === id)?.feasible)).toBe(true);
    const recommended = result.candidates.find((candidate) => candidate.id === result.recommendedId);
    expect(recommended?.feasible).toBe(true);
    expect(recommended!.visibility!).toBeGreaterThan(result.baseline.visibility);
    expect(result.baseline.profile).toBeDefined();
  });

  it("stops early when the call budget is exhausted", async () => {
    const { complete } = fakeComplete();
    const result = await runFeatureOptimization({ ...input, maxCalls: 8 }, { complete });
    expect(result.stoppedReason).toBe("budget");
    expect(result.callsUsed).toBeLessThanOrEqual(8);
  });
});
