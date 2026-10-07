import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { AppError } from "./errors";
import { parseAnthropicGrounding, parseGeminiGrounding, parseOpenAiGrounding, type GroundedAnswer } from "./grounding";
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

/** 웹검색 도구를 공식 지원하는 공급자 — Grok은 미확인이라 인용 지표를 N/A로 둔다 */
export const SEARCH_CAPABLE_PROVIDERS: readonly Provider[] = ["openai", "anthropic", "gemini"];

/**
 * 이 키·공급자 조합으로 실제 웹검색이 되는지.
 * 2026-10-08 실측: 구독핀 프록시(csk_)는 OpenAI Responses의 web_search 도구를 tool_choice=required여도 제거하고 일반 답변만 돌려준다.
 * 같은 프록시의 Anthropic web_search는 정상 동작했다.
 */
export function supportsWebSearch(provider: Provider, apiKey: string) {
  if (!SEARCH_CAPABLE_PROVIDERS.includes(provider)) return false;
  return !(provider === "openai" && apiKey.startsWith("csk_"));
}
const MAX_SEARCH_USES = 3;

function providerFailure(error: unknown, providerLabel: string): never {
  const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 502;
  if (status === 401 || status === 403) {
    throw new AppError(`${providerLabel} API 키 인증에 실패했습니다.`, 401, "LLM_AUTH_FAILED");
  }
  if (error instanceof AppError) throw error;
  if (status === 400 || status === 404 || status === 422) {
    throw new AppError(`${providerLabel}에서 웹검색 도구를 사용할 수 없습니다.`, 502, "SEARCH_UNSUPPORTED");
  }
  throw new AppError(`${providerLabel} 모델 호출에 실패했습니다. 잠시 후 다시 시도해 주세요.`, 502, "LLM_REQUEST_FAILED");
}

/** 검색 기반 측정 — 답변과 함께 명시 인용·검색 결과 URL을 돌려준다 */
export async function generateGroundedText({ provider, apiKey, model, system, prompt, maxTokens = 1800 }: GenerateOptions): Promise<GroundedAnswer> {
  const providerLabel = provider === "grok" ? "Grok" : provider;
  if (!apiKey) throw new AppError(`${providerLabel} API 키가 설정되지 않았습니다.`, 409, "API_KEY_REQUIRED");
  if (!supportsWebSearch(provider, apiKey)) {
    throw new AppError(`${providerLabel}는 웹검색 측정을 지원하지 않습니다.`, 502, "SEARCH_UNSUPPORTED");
  }
  try {
    if (provider === "openai") {
      const client = new OpenAI({ apiKey, baseURL: gudokpinBaseURL("openai", apiKey) });
      const response = await client.responses.create({
        model,
        instructions: system,
        input: prompt,
        max_output_tokens: maxTokens,
        tools: [{ type: "web_search" }],
      });
      return parseOpenAiGrounding(response);
    }
    if (provider === "anthropic") {
      const client = new Anthropic({ apiKey, baseURL: gudokpinBaseURL("anthropic", apiKey) });
      const message = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: prompt }],
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: MAX_SEARCH_USES }],
      });
      return parseAnthropicGrounding(message);
    }
    const client = new GoogleGenAI({ apiKey });
    const response = await client.models.generateContent({
      model,
      contents: prompt,
      config: { systemInstruction: system, maxOutputTokens: maxTokens, tools: [{ googleSearch: {} }] },
    });
    return parseGeminiGrounding({ text: response.text, modelVersion: response.modelVersion, candidates: response.candidates });
  } catch (error) {
    providerFailure(error, providerLabel);
  }
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
