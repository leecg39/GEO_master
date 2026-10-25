/**
 * 답변 구조 지표 (RankSEO REA G3, A5) — GEO 가설이며 점수에 넣지 않는다.
 * RankSEO는 첫 문단 60단어·4문장, H2 구간 80~450단어를 영어 단어 기준으로 셌다.
 * 한국어는 어절 길이가 달라 글자 수(공백 정리 후)로 센다. 기준값은 근거 데이터가 없는 추정이므로 한 곳에 모아 둔다.
 */
import * as cheerio from "cheerio";
import type { PageFinding } from "./page-snapshots";

export const ANSWER_STRUCTURE = Object.freeze({
  /** 이보다 짧은 문단은 첫 문단 후보에서 뺀다 (메뉴·짧은 안내 등) */
  firstParagraphMinChars: 20,
  firstParagraphMaxChars: 300,
  firstParagraphMaxSentences: 4,
  /** RankSEO 80~450단어를 한국어 평균 어절 길이(약 3.5자)로 옮긴 추정치 */
  sectionMinChars: 250,
  sectionMaxChars: 1600,
  minIdealSectionRatio: 0.5,
});

const SKIP = "script, style, noscript, template, nav, header, footer, aside";
const BLOCKS = "h2, p, li:not(:has(p)), td, th, blockquote:not(:has(p)), dd";

const clean = (text: string) => text.replace(/\s+/g, " ").trim();
const length = (text: string) => [...text].length;

/** 문장 끝: 마침표·물음표·느낌표 뒤가 공백이거나 끝. 숫자 사이 점(3.5)은 문장 끝이 아니다 */
export function countSentences(text: string) {
  const trimmed = clean(text);
  if (!trimmed) return 0;
  const endings = trimmed.match(/[.!?。！？](?=\s|$)/g)?.length ?? 0;
  return /[.!?。！？]$/.test(trimmed) ? endings : endings + 1;
}

export interface AnswerStructure {
  firstParagraph: { chars: number; sentences: number } | null;
  sections: Array<{ heading: string; chars: number }>;
  /** 적정 길이 구간 비율. H2가 2개 미만이면 null */
  idealRatio: number | null;
}

export function analyzeAnswerStructure(html: string): AnswerStructure {
  const $ = cheerio.load(html);
  $(SKIP).remove();
  const first = $("p").toArray().map((node) => clean($(node).text())).find((text) => length(text) >= ANSWER_STRUCTURE.firstParagraphMinChars);
  const sections: Array<{ heading: string; chars: number }> = [];
  for (const node of $("body").find(BLOCKS).toArray()) {
    const text = clean($(node).text());
    if (node.tagName === "h2") sections.push({ heading: text.slice(0, 80), chars: 0 });
    else if (sections.length) sections[sections.length - 1] = { ...sections.at(-1)!, chars: sections.at(-1)!.chars + length(text) };
  }
  const ideal = sections.filter((entry) => entry.chars >= ANSWER_STRUCTURE.sectionMinChars && entry.chars <= ANSWER_STRUCTURE.sectionMaxChars).length;
  return {
    firstParagraph: first ? { chars: length(first), sentences: countSentences(first) } : null,
    sections,
    idealRatio: sections.length >= 2 ? ideal / sections.length : null,
  };
}

export function answerStructureFinding(html: string): PageFinding {
  const result = analyzeAnswerStructure(html);
  const { firstParagraph: first, idealRatio } = result;
  const openingOk = !first || (first.chars <= ANSWER_STRUCTURE.firstParagraphMaxChars && first.sentences <= ANSWER_STRUCTURE.firstParagraphMaxSentences);
  const sectionsOk = idealRatio === null || idealRatio >= ANSWER_STRUCTURE.minIdealSectionRatio;
  const opening = first ? `첫 문단 ${first.chars}자·${first.sentences}문장` : "첫 문단 후보 없음";
  const sections = idealRatio === null ? `H2 구간 ${result.sections.length}개(비율 판정 안 함)`
    : `H2 구간 ${result.sections.length}개 중 ${Math.round(idealRatio * 100)}%가 ${ANSWER_STRUCTURE.sectionMinChars}~${ANSWER_STRUCTURE.sectionMaxChars}자`;
  const advice = [
    openingOk ? "" : `첫 문단을 ${ANSWER_STRUCTURE.firstParagraphMaxChars}자·${ANSWER_STRUCTURE.firstParagraphMaxSentences}문장 이내의 결론으로 줄여 보세요`,
    sectionsOk ? "" : "H2 구간을 하나의 질문에 답하는 길이로 나누거나 합쳐 보세요",
  ].filter(Boolean);
  return {
    code: "answer-structure", tier: "hypothesis", severity: "notice", passed: openingOk && sectionsOk,
    label: "답변 구조(결론 선행·구간 길이)",
    detail: `${opening} · ${sections}${advice.length ? ` — ${advice.join(" · ")}` : ""} (GEO 가설 — 한국어 기준값은 추정치)`,
    evidence: `${opening}; ${sections}`,
  };
}
