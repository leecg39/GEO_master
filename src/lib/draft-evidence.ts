/**
 * 콘텐츠 초안의 사실 근거 연결 — 생성 모델에는 검증된 사실 메모만 수치 근거로 주고,
 * 생성된 문장 중 근거 없는 수치는 "자료 요청"으로 표시한다. (leecg39/GEO_master2 개선 초안 원칙)
 */
import { auditDraftText, type DraftFact, type SentenceAudit } from "./geo-core";

const MAX_PROMPT_FACTS = 40;

export function factPromptBlock(facts: readonly DraftFact[]) {
  const usable = facts.filter((fact) => fact.usable).slice(0, MAX_PROMPT_FACTS);
  if (!usable.length) {
    return "<사실 메모>\n확인된 사실 메모가 없습니다. 수치·가격·기간·순위를 새로 쓰지 말고, 필요한 곳은 [자료 요청]으로 남기세요.\n</사실 메모>";
  }
  const lines = usable.map((fact) => `- ${fact.attribute}: ${fact.value}${fact.unit ? ` ${fact.unit}` : ""}`);
  return [
    "<사실 메모>",
    "아래는 공식 자료로 확인된 사실입니다. 수치·가격·기간은 이 목록의 값만 쓰고, 목록에 없는 수치가 필요하면 [자료 요청]으로 남기세요.",
    ...lines,
    "</사실 메모>",
  ].join("\n");
}

export interface StudioEvidence {
  needsEvidence: number;
  sentences: SentenceAudit[];
}

function textOf(value: unknown) {
  return typeof value === "string" ? value : "";
}

function generatedText(action: string, output: Record<string, unknown>) {
  if (action === "rewrite") return textOf(output.after);
  if (action === "intro") return textOf(output.intro);
  if (action === "faq" && Array.isArray(output.faqs)) {
    return output.faqs.map((faq) => textOf((faq as Record<string, unknown>)?.answer)).filter(Boolean).join("\n");
  }
  return null;
}

/** 생성형 출력(rewrite·intro·faq)만 감사한다. 결정적 출력(entity)은 null */
export function auditStudioOutput(
  action: string,
  output: Record<string, unknown>,
  facts: readonly DraftFact[],
  competitorNames: readonly string[] = [],
): StudioEvidence | null {
  const text = generatedText(action, output);
  return text === null ? null : auditDraftText(text, facts, competitorNames);
}
