import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { AppError } from "./errors";
import type { Provider } from "./settings";

export const GUDOKPIN_OPENAI_BASE_URL = "https://api.gudokpin.com/v1";
export const GUDOKPIN_ANTHROPIC_BASE_URL = "https://api.gudokpin.com";
export const XAI_API_BASE_URL = "https://api.x.ai/v1";

function gudokpinBaseURL(provider: "openai" | "anthropic", apiKey: string) {
  if (!apiKey.startsWith("csk_")) return undefined;
  const expected = provider === "openai" ? GUDOKPIN_OPENAI_BASE_URL : GUDOKPIN_ANTHROPIC_BASE_URL;
  const configured = (provider === "openai" ? process.env.GUDOKPIN_OPENAI_BASE_URL : process.env.GUDOKPIN_ANTHROPIC_BASE_URL)?.trim() || expected;
  if (configured !== expected) {
    throw new AppError(`구독핀 ${provider} Base URL 설정이 올바르지 않습니다.`, 500, "INVALID_GUDOKPIN_BASE_URL");
  }
  return configured;
}

interface GenerateOptions {
  provider: Provider;
  apiKey: string;
  model: string;
  system: string;
  prompt: string;
  maxTokens?: number;
}

export async function generateText({ provider, apiKey, model, system, prompt, maxTokens = 1800 }: GenerateOptions) {
  const providerLabel = provider === "grok" ? "Grok" : provider;
  if (!apiKey) throw new AppError(`${providerLabel} API 키가 설정되지 않았습니다.`, 409, "API_KEY_REQUIRED");
  try {
    if (provider === "openai") {
      const client = new OpenAI({ apiKey, baseURL: gudokpinBaseURL("openai", apiKey) });
      const response = await client.responses.create({
        model,
        instructions: system,
        input: prompt,
        max_output_tokens: maxTokens,
      });
      return response.output_text.trim();
    }
    if (provider === "anthropic") {
      const client = new Anthropic({ apiKey, baseURL: gudokpinBaseURL("anthropic", apiKey) });
      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: prompt }],
      });
      return response.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim();
    }
    if (provider === "grok") {
      const client = new OpenAI({ apiKey, baseURL: XAI_API_BASE_URL });
      const response = await client.responses.create({
        model,
        instructions: system,
        input: prompt,
        max_output_tokens: maxTokens,
      });
      const content = response.output_text.trim();
      if (!content) {
        throw new AppError(`${providerLabel} 모델이 유효한 텍스트를 반환하지 않았습니다.`, 502, "INVALID_LLM_OUTPUT");
      }
      return content;
    }
    const client = new GoogleGenAI({ apiKey });
    const response = await client.models.generateContent({
      model,
      contents: prompt,
      config: { systemInstruction: system, maxOutputTokens: maxTokens },
    });
    return (response.text ?? "").trim();
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 502;
    if (status === 401 || status === 403) {
      throw new AppError(`${providerLabel} API 키 인증에 실패했습니다.`, 401, "LLM_AUTH_FAILED");
    }
    if (error instanceof AppError) throw error;
    throw new AppError(`${providerLabel} 모델 호출에 실패했습니다. 잠시 후 다시 시도해 주세요.`, 502, "LLM_REQUEST_FAILED");
  }
}
