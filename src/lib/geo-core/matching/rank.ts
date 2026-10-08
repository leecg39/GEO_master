// Ported from leecg39/GEO_master2 packages/core/src/matching/rank.ts
import type { MatchCandidate } from './match';

/**
 * 명시 순위 판정 (TRD §6): 번호 목록이 있을 때만 순위를 부여한다.
 * 불릿·문장 나열은 "언급 순서"일 뿐 "추천 순위"가 아니므로 null.
 */

const NUMBERED_ITEM_RE = /(?:^|\n)\s*(\d{1,2})\s*[.)]\s+/g;

/**
 * 텍스트의 번호 목록 항목 시작 위치 → 항목 번호 맵.
 * 번호가 연속(1,2,3…)에 가까울 때만 목록으로 인정한다.
 */
export function numberedItemPositions(text: string): Array<{ rank: number; start: number }> | null {
  const items: Array<{ rank: number; start: number }> = [];
  for (const m of text.matchAll(NUMBERED_ITEM_RE)) {
    items.push({ rank: Number(m[1]), start: m.index + m[0].length });
  }
  if (items.length < 2) return null;
  // 번호가 1부터 연속하지 않으면 문서의 임의 숫자일 수 있으므로 목록 아님
  const ranks = items.map((i) => i.rank).sort((a, b) => a - b);
  if (ranks[0] !== 1) return null;
  const contiguous = ranks.every((r, i) => i === 0 || r === ranks[i - 1]! + 1 || r === ranks[i - 1]!);
  return contiguous ? items : null;
}

/**
 * 언급에 순위 부여 — 번호 항목 안에 있는 언급만 rank, 나머지는 null.
 * 한 항목에 여러 언급이 있으면 항목 번호를 공유한다.
 */
export function assignRanks(
  text: string,
  mentions: MatchCandidate[],
): Map<MatchCandidate, number | null> {
  const items = numberedItemPositions(text);
  const out = new Map<MatchCandidate, number | null>();
  if (!items) {
    for (const m of mentions) out.set(m, null);
    return out;
  }
  const bounds = items
    .map((it, i) => ({ rank: it.rank, start: it.start, end: items[i + 1]?.start ?? text.length }));
  for (const m of mentions) {
    const bucket = bounds.find((b) => m.start >= b.start && m.start < b.end);
    out.set(m, bucket?.rank ?? null);
  }
  return out;
}
