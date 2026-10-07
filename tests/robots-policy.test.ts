import { describe, expect, it } from "vitest";
import { analyzeRobotsTxt, robotsPolicyFromResponse } from "@/lib/robots-policy";

const access = (text: string, token: string) => analyzeRobotsTxt(text).bots.find((bot) => bot.token === token);

describe("robots.txt AI crawler policy (RFC 9309)", () => {
  it("treats a GPTBot block as a training opt-out, not as an AI search block", () => {
    const policy = analyzeRobotsTxt("User-agent: GPTBot\nDisallow: /\n");
    expect(policy.summary).toEqual({ searchBlocked: [], trainingBlocked: ["GPTBot"], userBlocked: [] });
    expect(access("User-agent: GPTBot\nDisallow: /", "OAI-SearchBot")).toMatchObject({ access: "allowed", group: "none", purpose: "search" });
  });

  it("uses a bot's own group instead of the wildcard group", () => {
    const text = "User-agent: *\nDisallow: /\n\nUser-agent: OAI-SearchBot\nAllow: /\n";
    expect(access(text, "OAI-SearchBot")).toMatchObject({ access: "allowed", group: "specific" });
    expect(access(text, "GPTBot")).toMatchObject({ access: "blocked", group: "wildcard", matchedRule: "Disallow: /" });
    expect(analyzeRobotsTxt(text).summary.searchBlocked).toEqual(["Claude-SearchBot", "PerplexityBot", "Googlebot", "Bingbot"]);
  });

  it("applies the longest matching rule and lets Allow win a tie", () => {
    expect(access("User-agent: *\nDisallow: /\nAllow: /$", "Googlebot")).toMatchObject({ access: "partial", matchedRule: "Allow: /$" });
    expect(access("User-agent: *\nDisallow: /\nAllow: /", "Googlebot")).toMatchObject({ access: "allowed" });
  });

  it("reads an empty Disallow as allow-all and supports shared groups, comments and case", () => {
    expect(access("User-agent: *\nDisallow:\n", "ClaudeBot")).toMatchObject({ access: "allowed" });
    const shared = "user-agent: gptbot # 학습\nUSER-AGENT: ClaudeBot\ndisallow: / # 전체\n";
    expect(analyzeRobotsTxt(shared).summary.trainingBlocked).toEqual(["GPTBot", "ClaudeBot"]);
  });

  it("merges multiple groups for the same bot", () => {
    const text = "User-agent: PerplexityBot\nDisallow: /a\n\nUser-agent: PerplexityBot\nDisallow: /\n";
    expect(access(text, "PerplexityBot")).toMatchObject({ access: "blocked" });
  });

  it("reports a path-only restriction as partial access", () => {
    expect(access("User-agent: ClaudeBot\nDisallow: /private\n", "ClaudeBot")).toMatchObject({ access: "partial", restrictedRules: 1 });
  });

  it("keeps Google-Extended out of Google Search", () => {
    const policy = analyzeRobotsTxt("User-agent: Google-Extended\nDisallow: /\n");
    expect(policy.summary).toMatchObject({ searchBlocked: [], trainingBlocked: ["Google-Extended"] });
    expect(policy.bots.find((bot) => bot.token === "Googlebot")).toMatchObject({ access: "allowed" });
  });

  it("separates a missing robots.txt (no restrictions) from one that could not be read", () => {
    expect(robotsPolicyFromResponse({ status: 404, text: "", contentType: "text/html" })).toMatchObject({ state: "missing", summary: { searchBlocked: [] } });
    expect(robotsPolicyFromResponse({ status: 404, text: "" }).bots.every((bot) => bot.access === "allowed")).toBe(true);
    const unreadable = robotsPolicyFromResponse({ status: 503, text: "" });
    expect(unreadable.state).toBe("unknown");
    expect(unreadable.bots.every((bot) => bot.access === "unknown")).toBe(true);
    expect(robotsPolicyFromResponse(null)).toMatchObject({ state: "unknown" });
    expect(robotsPolicyFromResponse({ status: 429, text: "" })).toMatchObject({ state: "unknown" });
    expect(robotsPolicyFromResponse({ status: 200, text: "<!doctype html><html><body>홈</body></html>", contentType: "text/html" })).toMatchObject({ state: "unknown" });
  });
});
