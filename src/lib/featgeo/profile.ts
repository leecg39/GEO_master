/**
 * 결정적 피처 프로필 — 텍스트에서 13개 피처를 휴리스틱으로 추정한다 (LLM 호출 없음).
 * FeatGEO 원본은 LLM으로 추출하지만, 여기서는 비용 없이 반복 가능한 추정을 쓰고 결과를 "추정치"로 표시한다.
 */
import { clampConfig, type FeatureConfig } from "./feature-schema";

const HEADING_RE = /^\s{0,3}#{1,6}\s+\S/;
const LIST_RE = /^\s*(?:[-*+•]|\d{1,2}[.)])\s+\S/;
const SOURCE_RE = /에 따르면|according to|출처[:：]|https?:\/\//i;
const QUOTE_RE = /["“][^"”]{2,200}["”]/g;
const ASSERTIVE_RE = /반드시|확실히|분명히|입증|전문가|공식|검증된|권장합니다|해야 합니다/g;
const CONNECTIVE_RE = /그리고|또한|따라서|그러나|하지만|즉|예를 들어|반면|게다가|결국|이처럼/g;
const TECHNICAL_RE = /^(?:[A-Z]{2,}[A-Za-z0-9-]*|[A-Za-z]+\d+[A-Za-z0-9]*|\d+(?:\.\d+)?(?:GB|MB|ms|Hz|kW|mAh|nm))$/;

function sentencesOf(text: string) {
  return text.split(/\n+|(?<=[.!?。])\s+/).map((sentence) => sentence.trim()).filter((sentence) => sentence && !HEADING_RE.test(sentence));
}

function wordsOf(text: string) {
  return text.replace(/[#*>\[\]()"“”'‘’.,!?:;]/g, " ").split(/\s+/).filter((word) => [...word].length >= 2);
}

function ratio(part: number, whole: number) {
  return whole > 0 ? part / whole : 0;
}

export function profileText(text: string): FeatureConfig {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const paragraphs = text.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
  const bodyParagraphs = paragraphs.filter((paragraph) => !HEADING_RE.test(paragraph));
  const sentences = sentencesOf(text);
  const words = wordsOf(text);
  const headings = lines.filter((line) => HEADING_RE.test(line)).length;
  const firstParagraph = bodyParagraphs[0]?.replace(/^#.*\n/, "") ?? "";
  const counts = new Map<string, number>();
  for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
  const topFrequency = Math.max(0, ...counts.values());
  const averageSentence = ratio(sentences.reduce((sum, sentence) => sum + sentence.length, 0), sentences.length);

  return clampConfig({
    has_intro_summary: firstParagraph ? 0.3 + 0.7 * Math.min(1, ratio(firstParagraph.length, 0.4 * text.length) * 2) : 0,
    headings_level: 1 + Math.min(2, Math.max(0, headings - 1)),
    list_density: 3 * Math.min(1, ratio(lines.filter((line) => LIST_RE.test(line)).length, lines.length) / 0.7),
    length_level: 1 + 2 * Math.min(1, words.length / 1000),
    statistics_level: 3 * ratio(sentences.filter((sentence) => /\d/.test(sentence)).length, sentences.length),
    cite_sources_level: 3 * ratio(bodyParagraphs.filter((paragraph) => SOURCE_RE.test(paragraph)).length, bodyParagraphs.length),
    quotation_level: Math.min(3, (text.match(QUOTE_RE) ?? []).length),
    unique_info_level: 3 * ratio(counts.size, words.length),
    technical_terms_level: 3 * Math.min(1, ratio(words.filter((word) => TECHNICAL_RE.test(word)).length, words.length) * 5),
    authoritative_level: 3 * Math.min(1, ratio((text.match(ASSERTIVE_RE) ?? []).length, sentences.length)),
    easy_to_understand_level: 1 + 2 * Math.min(1, Math.max(0, averageSentence - 30) / 50),
    fluency_level: 1 + 2 * Math.min(1, ratio((text.match(CONNECTIVE_RE) ?? []).length, sentences.length) * 2),
    keyword_focus_level: 1 + 2 * Math.min(1, ratio(topFrequency, Math.max(1, words.length / 20))),
  });
}
