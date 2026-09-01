import { describe, expect, it } from "vitest";
import { automationPolicySchema, estimateMeasurementCost, nextScheduleTime, scheduleInputSchema } from "@/lib/automation";

const rates = { openai: 0.01, anthropic: 0.02, gemini: 0.005, grok: 0.004 };

describe("automation calculations", () => {
  it("reserves a conservative upper bound including possible sentiment calls", () => {
    expect(estimateMeasurementCost({
      questions: ["질문 하나입니다.", "질문 둘입니다."],
      providers: ["openai", "anthropic"],
      repetitions: 2,
    }, rates)).toEqual({ baseCalls: 8, maximumCalls: 16, estimatedCostUsd: 0.24 });
  });

  it("coalesces missed intervals to the first future slot", () => {
    expect(nextScheduleTime("2026-01-01T00:00:00.000Z", 1_440, new Date("2026-01-04T12:00:00.000Z")))
      .toBe("2026-01-05T00:00:00.000Z");
  });

  it("rejects unknown schedule fields and intervals shorter than one hour", () => {
    const base = {
      name: "월간 핵심 질문",
      questions: ["좋은 분석 도구의 기준은 무엇인가요?"],
      providers: ["openai"],
      repetitions: 1,
      intervalMinutes: 30,
      nextRunAt: "2026-01-01T00:00:00.000Z",
      enabled: false,
      apiKey: "must-not-be-stored",
    };
    expect(scheduleInputSchema.safeParse(base).success).toBe(false);
  });

  it("rejects zero provider rates that would bypass the budget gate", () => {
    expect(automationPolicySchema.safeParse({
      monthlyBudgetUsd: 10,
      maxRunCostUsd: 1,
      providerCallCosts: { ...rates, openai: 0 },
      alertThreshold: 0.8,
    }).success).toBe(false);
  });
});
