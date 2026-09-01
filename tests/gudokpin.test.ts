import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  openaiOptions: vi.fn(),
  openaiCreate: vi.fn(),
  anthropicOptions: vi.fn(),
  anthropicCreate: vi.fn(),
}));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    responses = { create: mocks.openaiCreate };
    constructor(options: unknown) { mocks.openaiOptions(options); }
  },
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: mocks.anthropicCreate };
    constructor(options: unknown) { mocks.anthropicOptions(options); }
  },
}));

import { generateText, GUDOKPIN_ANTHROPIC_BASE_URL, GUDOKPIN_OPENAI_BASE_URL } from "@/lib/llm";

const previousOpenAIBase = process.env.GUDOKPIN_OPENAI_BASE_URL;
const previousAnthropicBase = process.env.GUDOKPIN_ANTHROPIC_BASE_URL;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GUDOKPIN_OPENAI_BASE_URL = GUDOKPIN_OPENAI_BASE_URL;
  process.env.GUDOKPIN_ANTHROPIC_BASE_URL = GUDOKPIN_ANTHROPIC_BASE_URL;
  mocks.openaiCreate.mockResolvedValue({ output_text: "  GPT 연결 성공  " });
  mocks.anthropicCreate.mockResolvedValue({ content: [{ type: "text", text: "  Claude 연결 성공  " }] });
});

afterEach(() => {
  if (previousOpenAIBase === undefined) delete process.env.GUDOKPIN_OPENAI_BASE_URL;
  else process.env.GUDOKPIN_OPENAI_BASE_URL = previousOpenAIBase;
  if (previousAnthropicBase === undefined) delete process.env.GUDOKPIN_ANTHROPIC_BASE_URL;
  else process.env.GUDOKPIN_ANTHROPIC_BASE_URL = previousAnthropicBase;
});

describe("Gudokpin LLM adapters", () => {
  it("uses /v1 Responses for GPT and root Messages base for Claude with csk_ keys", async () => {
    await expect(generateText({
      provider: "openai", apiKey: "csk_test", model: "gpt-5.6-luna",
      system: "system", prompt: "prompt", maxTokens: 32,
    })).resolves.toBe("GPT 연결 성공");
    expect(mocks.openaiOptions).toHaveBeenCalledWith({ apiKey: "csk_test", baseURL: "https://api.gudokpin.com/v1" });
    expect(mocks.openaiCreate).toHaveBeenCalledWith({
      model: "gpt-5.6-luna", instructions: "system", input: "prompt", max_output_tokens: 32,
    });

    await expect(generateText({
      provider: "anthropic", apiKey: "csk_test", model: "claude-sonnet-5",
      system: "system", prompt: "prompt", maxTokens: 24,
    })).resolves.toBe("Claude 연결 성공");
    expect(mocks.anthropicOptions).toHaveBeenCalledWith({ apiKey: "csk_test", baseURL: "https://api.gudokpin.com" });
    expect(mocks.anthropicCreate).toHaveBeenCalledWith({
      model: "claude-sonnet-5", max_tokens: 24, system: "system",
      messages: [{ role: "user", content: "prompt" }],
    });
  });

  it("does not override SDK base URLs for direct provider keys", async () => {
    await generateText({ provider: "openai", apiKey: "sk-direct", model: "gpt-direct", system: "s", prompt: "p" });
    await generateText({ provider: "anthropic", apiKey: "sk-ant-direct", model: "claude-direct", system: "s", prompt: "p" });
    expect(mocks.openaiOptions).toHaveBeenCalledWith({ apiKey: "sk-direct", baseURL: undefined });
    expect(mocks.anthropicOptions).toHaveBeenCalledWith({ apiKey: "sk-ant-direct", baseURL: undefined });
  });

  it("rejects a csk_ connection when the configured base URL violates the documented path", async () => {
    process.env.GUDOKPIN_ANTHROPIC_BASE_URL = "https://api.gudokpin.com/v1";
    await expect(generateText({
      provider: "anthropic", apiKey: "csk_test", model: "claude-sonnet-5", system: "s", prompt: "p",
    })).rejects.toMatchObject({ code: "INVALID_GUDOKPIN_BASE_URL", status: 500 });
    expect(mocks.anthropicOptions).not.toHaveBeenCalled();
  });
});
