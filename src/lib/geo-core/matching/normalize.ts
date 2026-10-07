// Ported from leecg39/GEO_master2 packages/core/src/matching/normalize.ts
/**
 * 텍스트 정규화: NFKC + 제로폭 문자 제거 + 공백 정리 + 라틴 소문자화.
 * 정규화 인덱스 → 원문 오프셋 매핑을 함께 보존한다 (TRD §5 단계 1).
 */

export interface NormalizedText {
  text: string;
  /** normToOrig[i]: 정규화 i번째 문자가 나온 원문 인덱스 */
  normToOrig: number[];
}

const ZERO_WIDTH_RE = /\u200B|\u200C|\u200D|\uFEFF/u;
const WHITESPACE_RE = /\s/u;

export function normalizeText(input: string): NormalizedText {
  const chars: string[] = [];
  const normToOrig: number[] = [];

  let pos = 0;
  let pendingSpace = false;
  let pendingSpaceOrig = -1;

  for (const ch of input) {
    const cpLen = ch.length;
    if (ZERO_WIDTH_RE.test(ch)) {
      pos += cpLen;
      continue;
    }
    const normalized = ch.normalize('NFKC');
    for (const nc of normalized) {
      if (WHITESPACE_RE.test(nc)) {
        if (chars.length > 0 && !pendingSpace) {
          pendingSpace = true;
          pendingSpaceOrig = pos;
        }
        continue;
      }
      if (pendingSpace) {
        chars.push(' ');
        normToOrig.push(pendingSpaceOrig);
        pendingSpace = false;
      }
      // 라틴 소문자화 (NFKC가 전각→반각을 먼저 바꿔 준다)
      const lower = nc >= 'A' && nc <= 'Z' ? nc.toLowerCase() : nc;
      chars.push(lower);
      normToOrig.push(pos);
    }
    pos += cpLen;
  }

  return { text: chars.join(''), normToOrig };
}

/** 정규화 구간 [start, end) → 원문 구간 [start, end) */
export function toOriginalSpan(
  norm: NormalizedText,
  original: string,
  start: number,
  end: number,
): { start: number; end: number } {
  if (start < 0 || end > norm.text.length || start >= end) {
    return { start: 0, end: 0 };
  }
  const origStart = norm.normToOrig[start]!;
  const origEnd =
    end < norm.text.length ? norm.normToOrig[end]! : original.length;
  return { start: origStart, end: origEnd };
}

/** 별칭 정규화 (매칭용) */
export function normalizeAlias(alias: string): string {
  return normalizeText(alias).text;
}
