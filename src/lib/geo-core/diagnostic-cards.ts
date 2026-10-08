/**
 * 진단 카드 4종 — GEO 퍼널(존재·맥락·시의성·추천)과 같은 축.
 * leecg39/GEO_master2 cards/suggest.ts를 브랜드 미포함 질문 측정에 맞게 조정했다.
 * - 사실 기반 카드(맥락·시의성)는 사실 메모가 있고 판정 가능 주장이 3건 이상일 때만 판정한다
 * - 근거가 부족하면 "자료 부족(insufficient)"으로 남기고 추정하지 않는다
 */
import { checkDraftBlock, type DraftFact } from "./evidence-check";

export type CardName = "존재" | "맥락" | "시의성" | "추천";
export type CardVerdict = "pass" | "issue" | "insufficient";

export interface ClaimCounts {
  match: number;
  conflict: number;
  insufficient: number;
  timeUnknown: number;
  needsReview: number;
}

export interface CardInput {
  /** 정상 답변 수 */
  valid: number;
  brandMentioned: number;
  /** 모호 별칭으로만 잡힌 브랜드 언급 수 */
  ambiguousMentions: number;
  positiveMentions: number;
  /** 가장 많이 언급된 경쟁사의 언급 답변 수 (경쟁사 없으면 null) */
  topCompetitorMentions: number | null;
  hasFacts: boolean;
  claims: ClaimCounts;
}

export interface DiagnosticCard {
  card: CardName;
  verdict: CardVerdict;
  rationale: string;
}

const MIN_JUDGEABLE_CLAIMS = 3;
const MIN_RATE = 0.3;

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function presence(input: CardInput): DiagnosticCard {
  if (input.valid === 0) return { card: "존재", verdict: "insufficient", rationale: "정상 답변이 없습니다" };
  const rate = input.brandMentioned / input.valid;
  return {
    card: "존재",
    verdict: rate < MIN_RATE || input.ambiguousMentions > 0 ? "issue" : "pass",
    rationale: `언급 ${input.brandMentioned}/${input.valid} (${percent(rate)}), 모호 별칭 언급 ${input.ambiguousMentions}건`,
  };
}

function factCards(input: CardInput): DiagnosticCard[] {
  const { match, conflict, timeUnknown } = input.claims;
  const judgeable = match + conflict + timeUnknown;
  if (!input.hasFacts || judgeable < MIN_JUDGEABLE_CLAIMS) {
    const rationale = `사실 메모가 없거나 판정 가능한 주장이 ${MIN_JUDGEABLE_CLAIMS}건 미만입니다 (현재 ${judgeable}건)`;
    return [
      { card: "맥락", verdict: "insufficient", rationale },
      { card: "시의성", verdict: "insufficient", rationale },
    ];
  }
  const stale = conflict + timeUnknown;
  return [
    { card: "맥락", verdict: conflict > 0 ? "issue" : "pass", rationale: `주장 일치 ${match}건, 충돌 ${conflict}건` },
    { card: "시의성", verdict: stale > 0 ? "issue" : "pass", rationale: `시의성 문제 주장 ${stale}건 (충돌 ${conflict}, 시점 불명 ${timeUnknown})` },
  ];
}

function recommendation(input: CardInput): DiagnosticCard {
  if (input.valid === 0) return { card: "추천", verdict: "insufficient", rationale: "정상 답변이 없습니다" };
  const rate = input.positiveMentions / input.valid;
  const competitorRate = (input.topCompetitorMentions ?? 0) / input.valid;
  return {
    card: "추천",
    verdict: rate < competitorRate || rate < MIN_RATE ? "issue" : "pass",
    rationale: `긍정 문맥 언급률 ${percent(rate)} (최다 경쟁사 언급률 ${percent(competitorRate)})`,
  };
}

export function suggestDiagnosticCards(input: CardInput): DiagnosticCard[] {
  const [context, freshness] = factCards(input);
  return [presence(input), context!, freshness!, recommendation(input)];
}

export type SentenceCheck = "ok" | "needs_evidence";

export interface SentenceAudit {
  text: string;
  check: SentenceCheck;
  factIds: string[];
  reason: string | null;
}

const EVIDENCE_REQUEST_MARKER = "[자료 요청]";
const NUMBER_RE = /\d[\d,]*\.?\d*/g;

function numbers(text: string) {
  return (text.match(NUMBER_RE) ?? []).map((value) => value.replace(/,/g, ""));
}

function splitSentences(text: string) {
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?。])\s+/))
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function auditSentence(sentence: string, facts: readonly DraftFact[], competitorNames: readonly string[]): SentenceAudit {
  if (sentence.includes(EVIDENCE_REQUEST_MARKER)) {
    return { text: sentence, check: "needs_evidence", factIds: [], reason: "자료 요청으로 표시된 문장입니다" };
  }
  const sentenceNumbers = numbers(sentence);
  if (!sentenceNumbers.length) return { text: sentence, check: "ok", factIds: [], reason: null };
  const factIds = facts
    .filter((fact) => fact.usable && numbers(`${fact.value} ${fact.unit ?? ""}`).some((value) => sentenceNumbers.includes(value)))
    .map((fact) => fact.id);
  const result = checkDraftBlock({ text: sentence, factIds }, { facts, competitorNames });
  return result.check === "ok"
    ? { text: sentence, check: "ok", factIds, reason: null }
    : { text: sentence, check: "needs_evidence", factIds, reason: result.reason ?? "근거 확인이 필요합니다" };
}

/**
 * 문장 단위 초안 근거 감사 — 수치가 있는 문장은 검증된(미만료) 사실 메모의 값과 연결돼야 한다.
 * 연결되지 않으면 "자료 요청"으로 표시해 사람이 근거를 붙이거나 문장을 고치게 한다.
 */
export function auditDraftText(text: string, facts: readonly DraftFact[], competitorNames: readonly string[] = []) {
  const sentences = splitSentences(text).map((sentence) => auditSentence(sentence, facts, competitorNames));
  return { sentences, needsEvidence: sentences.filter((sentence) => sentence.check === "needs_evidence").length };
}
