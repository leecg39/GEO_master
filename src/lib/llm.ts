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
  if (!apiKey) throw new AppError(`${provider} API 키가 설정되지 않았습니다.`, 409, "API_KEY_REQUIRED");
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
      throw new AppError(`${provider} API 키 인증에 실패했습니다.`, 401, "LLM_AUTH_FAILED");
    }
    if (error instanceof AppError) throw error;
    throw new AppError(`${provider} 모델 호출에 실패했습니다. 잠시 후 다시 시도해 주세요.`, 502, "LLM_REQUEST_FAILED");
  }
}
