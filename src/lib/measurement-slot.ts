/**
 * 측정 슬롯 1개(질문 × 공급자 × 반복) 수집.
 * - 공급자 일시 오류는 슬롯 실패(결측)로 남기고 원인 코드를 보존한다
 * - 인증·설정 오류는 실행 전체를 멈춘다 (모든 슬롯이 같은 이유로 실패하므로)
 * - 거절 답변은 refused로 분류해 지표 분모에서 뺀다
 */
import { classifyRefusal, type SlotStatus } from "./geo-core";
import { AppError } from "./errors";
import type { Citation } from "./grounding";
import { generateGroundedText, generateText, SEARCH_CAPABLE_PROVIDERS } from "./llm";
import type { Provider } from "./settings";

export type SearchMode = "off" | "web";

export const MEASUREMENT_SYSTEM_PROMPT = "사용자의 질문에 독립적이고 균형 잡힌 한국어 답변을 제공하세요. 확인되지 않은 순위나 수치를 만들지 마세요.";
const SLOT_FAILURE_CODES = new Set(["LLM_REQUEST_FAILED", "INVALID_LLM_OUTPUT", "SEARCH_UNSUPPORTED"]);
const MAX_TOKENS = 1600;

export interface SlotRequest {
  provider: Provider;
  apiKey: string;
  model: string;
  question: string;
  searchMode: SearchMode;
}

export interface SlotOutcome {
  status: SlotStatus;
  response: string;
  error: string | null;
  /** 실제로 적용된 측정 조건 — 검색 미지원 공급자는 off로 기록 */
  searchMode: SearchMode;
  searchPerformed: boolean | null;
  citationSupported: boolean | null;
  returnedModel: string | null;
  citations: Citation[];
}

function outcome(response: string, partial: Omit<SlotOutcome, "status" | "response" | "error">): SlotOutcome {
  if (!response.trim()) return { ...partial, status: "failed", response: "", error: "EMPTY_RESPONSE", citations: [] };
  return { ...partial, status: classifyRefusal(response) ? "refused" : "succeeded", response, error: null };
}

async function request({ provider, apiKey, model, question, searchMode }: SlotRequest): Promise<SlotOutcome> {
  const options = { provider, apiKey, model, system: MEASUREMENT_SYSTEM_PROMPT, prompt: question, maxTokens: MAX_TOKENS };
  if (searchMode === "web" && SEARCH_CAPABLE_PROVIDERS.includes(provider)) {
    const grounded = await generateGroundedText(options);
    return outcome(grounded.text, {
      searchMode: "web",
      searchPerformed: grounded.searchPerformed,
      citationSupported: true,
      returnedModel: grounded.returnedModel,
      citations: grounded.citations,
    });
  }
  const response = await generateText(options);
  return outcome(response, {
    searchMode: "off",
    searchPerformed: searchMode === "web" ? false : null,
    citationSupported: searchMode === "web" ? false : null,
    returnedModel: null,
    citations: [],
  });
}

export async function collectSlot(slot: SlotRequest): Promise<SlotOutcome> {
  try {
    return await request(slot);
  } catch (error) {
    if (error instanceof AppError && SLOT_FAILURE_CODES.has(error.code)) {
      return {
        status: "failed",
        response: "",
        error: error.code,
        searchMode: slot.searchMode,
        searchPerformed: null,
        citationSupported: null,
        returnedModel: null,
        citations: [],
      };
    }
    throw error;
  }
}
