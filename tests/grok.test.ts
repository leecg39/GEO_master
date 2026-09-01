import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  openaiOptions: vi.fn(),
  responsesCreate: vi.fn(),
}));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    responses = { create: mocks.responsesCreate };
    constructor(options: unknown) { mocks.openaiOptions(options); }
  },
}));

import { generateText, XAI_API_BASE_URL } from "@/lib/llm";

const options = {
  provider: "grok" as const,
  apiKey: "xai-test-secret",
  model: "grok-4.6",
  system: "균형 있게 답하세요.",
  prompt: "국내 GEO 도구를 추천해 주세요.",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.responsesCreate.mockResolvedValue({ output_text: "  추천 결과입니다.  " });
});

describe("xAI Grok adapter", () => {
  it("uses the official xAI base URL and Responses API", async () => {
    await expect(generateText({ ...options, maxTokens: 2_048 })).resolves.toBe("추천 결과입니다.");
    expect(mocks.openaiOptions).toHaveBeenCalledWith({ apiKey: options.apiKey, baseURL: XAI_API_BASE_URL });
    expect(mocks.responsesCreate).toHaveBeenCalledWith({
      model: "grok-4.6",
      instructions: options.system,
      input: options.prompt,
      max_output_tokens: 2_048,
    });
  });

  it("maps authentication failures without exposing upstream details", async () => {
    mocks.responsesCreate.mockRejectedValue(Object.assign(new Error("do-not-leak"), { status: 401 }));
    await expect(generateText(options)).rejects.toMatchObject({
      status: 401,
      code: "LLM_AUTH_FAILED",
      message: "Grok API 키 인증에 실패했습니다.",
    });
  });

  it("rejects a successful response without assistant text", async () => {
    mocks.responsesCreate.mockResolvedValue({ output_text: "  " });
    await expect(generateText(options)).rejects.toMatchObject({ status: 502, code: "INVALID_LLM_OUTPUT" });
  });
});
