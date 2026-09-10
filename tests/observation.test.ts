import { describe, expect, it } from "vitest";
import { comparableMeasurements } from "@/lib/observation";
import { observeBotPolicy, robotsAllows } from "@/lib/site-ops/bot-policy";
const conditions = {
  mode: "model_only",
  dataState: "live",
  questionSetHash: "set-1",
  modelConfigHash: "gpt",
  repetitions: 3,
  language: "ko",
  country: null,
  promptVersion: "1",
};
const summary = (overrides: object = {}) =>
  JSON.stringify({ measurementConditions: { ...conditions, ...overrides } });
describe("observation semantics", () => {
  it("compares only compatible live measurements", () => {
    expect(comparableMeasurements(summary(), summary())).toBe(true);
    for (const change of [
      { mode: "web_search" },
      { questionSetHash: "other" },
      { modelConfigHash: "other" },
      { repetitions: 2 },
      { language: "en" },
      { country: "US" },
      { dataState: "mock" },
    ])
      expect(comparableMeasurements(summary(), summary(change))).toBe(false);
    expect(
      comparableMeasurements(
        summary(),
        JSON.stringify({ response: "https://example.com" }),
      ),
    ).toBe(false);
  });
  it("separates training blocks from search and respects specific allow groups", () => {
    const policies = observeBotPolicy(
      "User-agent: *\nDisallow: /\nUser-agent: GPTBot\nDisallow: /\nUser-agent: OAI-SearchBot\nAllow: /",
    );
    expect(policies.find((b) => b.bot === "GPTBot")).toMatchObject({
      purpose: "training",
      allowed: false,
    });
    expect(policies.find((b) => b.bot === "OAI-SearchBot")).toMatchObject({
      purpose: "search",
      allowed: true,
    });
    expect(observeBotPolicy(null).every((b) => b.allowed === null)).toBe(true);
    expect(
      robotsAllows(
        "User-agent: OAI-SearchBot\nAllow: /docs\nDisallow: /\nUser-agent: GPTBot\nDisallow: /",
        "OAI-SearchBot",
        "/docs/start",
      ),
    ).toBe(true);
  });
});
