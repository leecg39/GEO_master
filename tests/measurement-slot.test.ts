import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/llm", async () => {
  const actual = await vi.importActual<typeof import("@/lib/llm")>("@/lib/llm");
  return { ...actual, generateText: vi.fn(), generateGroundedText: vi.fn() };
});

import { generateGroundedText, generateText, supportsWebSearch } from "@/lib/llm";
import { collectSlot } from "@/lib/measurement-slot";

beforeEach(() => {
  vi.mocked(generateText).mockReset();
  vi.mocked(generateGroundedText).mockReset();
});

describe("supportsWebSearch", () => {
  it("excludes Grok and OpenAI routed through the 구독핀 proxy (verified: proxy strips tools)", () => {
    expect(supportsWebSearch("openai", "sk-direct")).toBe(true);
    expect(supportsWebSearch("openai", "csk_proxy")).toBe(false);
    expect(supportsWebSearch("anthropic", "csk_proxy")).toBe(true);
    expect(supportsWebSearch("gemini", "key")).toBe(true);
    expect(supportsWebSearch("grok", "key")).toBe(false);
  });
});

describe("collectSlot in web mode", () => {
  it("does not count an answer as citation-supported when no search actually ran", async () => {
    vi.mocked(generateGroundedText).mockResolvedValueOnce({ text: "검색 없이 답한 충분히 긴 답변입니다.", returnedModel: "m", searchPerformed: false, citations: [] });
    const slot = await collectSlot({ provider: "anthropic", apiKey: "sk-ant", model: "m", question: "질문입니다", searchMode: "web" });
    expect(slot).toMatchObject({ status: "succeeded", searchMode: "web", searchPerformed: false, citationSupported: false });
  });

  it("falls back to a plain, honestly labeled answer for 구독핀 OpenAI keys", async () => {
    vi.mocked(generateText).mockResolvedValueOnce("일반 답변입니다. 충분히 깁니다.");
    const slot = await collectSlot({ provider: "openai", apiKey: "csk_proxy", model: "m", question: "질문입니다", searchMode: "web" });
    expect(vi.mocked(generateGroundedText)).not.toHaveBeenCalled();
    expect(slot).toMatchObject({ status: "succeeded", searchMode: "off", searchPerformed: false, citationSupported: false });
  });
});
