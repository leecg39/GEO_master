import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { AppError } from "./errors";
import type { Provider } from "./settings";

interface GenerateOptions {
  provider: Provider;
  apiKey: string;
  model: string;
  system: string;
  prompt: string;
  maxTokens?: number;
}

export async function generateText({ provider, apiKey, model, system, prompt, maxTokens = 1800 }: GenerateOptions) {
  const providerLabel = provider === "hyperclova" ? "HyperCLOVA X" : provider;
  if (!apiKey) throw new AppError(`${providerLabel} API 키가 설정되지 않았습니다.`, 409, "API_KEY_REQUIRED");
  try {
    if (provider === "openai") {
      const client = new OpenAI({ apiKey });
      const response = await client.responses.create({
        model,
        instructions: system,
        input: prompt,
        max_output_tokens: maxTokens,
      });
      return response.output_text.trim();
    }
    if (provider === "anthropic") {
      const client = new Anthropic({ apiKey });
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
    if (provider === "hyperclova") {
      const response = await fetch(`https://clovastudio.stream.ntruss.com/v3/chat-completions/${encodeURIComponent(model)}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messages: [
            { role: "system", content: system },
            { role: "user", content: prompt },
          ],
          topP: 0.8,
          topK: 0,
          maxTokens: Math.min(4096, Math.max(1, Math.trunc(maxTokens))),
          temperature: 0.5,
          repetitionPenalty: 1.1,
          stop: [],
        }),
        signal: AbortSignal.timeout(120_000),
      });
      if (response.status === 401 || response.status === 403) {
        throw new AppError(`${providerLabel} API 키 인증에 실패했습니다.`, 401, "LLM_AUTH_FAILED");
      }
      if (!response.ok) {
        throw new AppError(`${providerLabel} 모델 호출에 실패했습니다. 잠시 후 다시 시도해 주세요.`, 502, "LLM_REQUEST_FAILED");
      }
      const data = await response.json() as { result?: { message?: { content?: unknown } } };
      const content = data.result?.message?.content;
      if (typeof content !== "string" || !content.trim()) {
        throw new AppError(`${providerLabel} 모델이 유효한 텍스트를 반환하지 않았습니다.`, 502, "INVALID_LLM_OUTPUT");
      }
      return content.trim();
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
