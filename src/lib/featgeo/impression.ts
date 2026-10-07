/**
 * 인용 노출도 — FeatGEO/GEO 논문의 impression 지표를 TS로 이식 (featgeo/utils.py).
 * - wordPos: 인용 문장의 단어 수 × 위치 감쇠 exp(-i/(N-1)), 공동 인용은 균등 분할
 * - wordCount: 위치 감쇠 없이 단어 수만
 * - posCount: 단어 수 없이 위치 감쇠만
 * 한국어 적응: 원본은 3자 이상 영어 토큰만 세지만, 어절 기준 2자 이상을 센다.
 */
export interface CitedSentence {
  sentence: string;
  words: number;
  /** 1부터 시작하는 출처 번호 */
  cites: number[];
}

const CITATION_RE = /\[[^\w\s]*(\d+)[^\w\s]*\]/g;

function wordCount(sentence: string) {
  return sentence
    .replace(CITATION_RE, " ")
    .replace(/[.,!?;:()"“”'‘’]/g, " ")
    .split(/\s+/)
    .filter((word) => [...word].length >= 2).length;
}

export function extractCitedSentences(text: string): CitedSentence[] {
  return text
    .split(/\n\s*\n/)
    .flatMap((paragraph) => paragraph.split(/\n+|(?<=[.!?。])\s+(?=\S)/))
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .map((sentence) => ({
      sentence,
      words: wordCount(sentence),
      cites: [...sentence.matchAll(CITATION_RE)].map((match) => Number(match[1])),
    }));
}

function impression(sentences: readonly CitedSentence[], n: number, useWords: boolean, usePosition: boolean) {
  const scores = new Array<number>(n).fill(0);
  sentences.forEach((sentence, index) => {
    for (const cite of sentence.cites) {
      if (cite < 1 || cite > n) continue; // 존재하지 않는 출처 번호(환각 인용)는 무시
      let score = useWords ? sentence.words : 1;
      if (usePosition && sentences.length > 1) score *= Math.exp(-index / (sentences.length - 1));
      scores[cite - 1]! += score / sentence.cites.length;
    }
  });
  const total = scores.reduce((sum, value) => sum + value, 0);
  return total > 0 ? scores.map((value) => value / total) : scores.map(() => 1 / n);
}

export function impressionWordPos(sentences: readonly CitedSentence[], n: number) {
  return impression(sentences, n, true, true);
}

export function impressionWordCount(sentences: readonly CitedSentence[], n: number) {
  return impression(sentences, n, true, false);
}

export function impressionPosCount(sentences: readonly CitedSentence[], n: number) {
  return impression(sentences, n, false, true);
}
