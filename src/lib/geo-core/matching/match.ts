// Ported from leecg39/GEO_master2 packages/core/src/matching/match.ts
import type { DictionaryEntry } from './dictionary';
import { normalizeText, toOriginalSpan, type NormalizedText } from './normalize';

/**
 * 한국어 브랜드 식별 (TRD §5 단계 2).
 * - 최장 일치 우선
 * - 앞 글자 경계 + 뒤 조사 허용
 * - 부정문도 언급으로 식별 (추천 판정은 별도 단계)
 * - 도메인만 등장하면 언급 아님 (domainHits로만 보고)
 */

const HANGUL_RE = /[가-힣]/u;
const LATIN_RE = /[a-z0-9]/u;

/** 뒤에 올 수 있는 조사·어미 접두사 (왼쪽 긴 것 우선 매칭) */
const PARTICLE_PREFIXES = [
  '에서는', '으로서', '으로써', '이라는', '이었다', '이며', '이고', '인데',
  '에게서', '한테서', '부터', '까지', '처럼', '보다', '조차', '마저',
  '이랑', '하고', '밖에', '이라도', '이나', '라도', '라는', '이든',
  '은', '는', '이', '가', '을', '를', '의', '에', '와', '과', '도',
  '로', '만', '랑', '뿐', '나', '서', '인', '같은', '같이', '대로', '마다',
  // 서술격 조사·종결 — "한샘입니다", "한샘이었다", "한샘임에도"
  '입', '임', '였', '랐',
  // 받침형 조사·연결어미 — "가상가구으로", "한샘이면", "한샘이지만" 계열
  '으로', '으니', '으면', '으나', '으며', '음', '습',
];

export interface MatchCandidate {
  entityId: string;
  entityName: string;
  kind: 'brand' | 'product' | 'competitor';
  matchedAlias: string;
  /** 원문 오프셋 */
  start: number;
  end: number;
  ambiguous: boolean;
  confidence: number;
}

export interface MatchResult {
  mentions: MatchCandidate[];
  /** 언급 순서 (응답 내 첫 등장 순) */
  firstPositions: Map<string, number>;
  /** 본문에 등장한 엔티티 도메인 (언급 아님 — 자사 인용 판단용) */
  domainHits: Array<{ entityId: string; domain: string }>;
}

function prevOk(text: string, start: number): boolean {
  if (start === 0) return true;
  const prev = text[start - 1]!;
  return !HANGUL_RE.test(prev) && !LATIN_RE.test(prev);
}

function nextOk(text: string, end: number): boolean {
  if (end >= text.length) return true;
  const next = text[end]!;
  if (LATIN_RE.test(next)) return false;
  // 도메인/URL 내부 ("gasang.kr") → 언급 아님
  if (next === '.' && /[a-z가-힣]/u.test(text[end + 1] ?? '')) return false;
  if (!HANGUL_RE.test(next)) return true;
  const rest = text.slice(end);
  return PARTICLE_PREFIXES.some((p) => rest.startsWith(p));
}

function boundaryOk(text: string, start: number, end: number): boolean {
  return prevOk(text, start) && nextOk(text, end);
}

interface Span {
  start: number;
  end: number;
  entry: DictionaryEntry;
}

export function matchBrands(
  original: string,
  dictionary: DictionaryEntry[],
  entities: Array<{ id: string; officialDomains?: string[] }> = [],
): MatchResult {
  const norm: NormalizedText = normalizeText(original);

  // 1) 모든 경계 유효 후보 수집 (사전은 이미 최장 순 정렬)
  const candidates: Span[] = [];
  const needles = new Set(dictionary.map((e) => e.aliasNormalized));
  for (const entry of dictionary) {
    const needle = entry.aliasNormalized;
    if (!needle) continue;
    let from = 0;
    while (from <= norm.text.length - needle.length) {
      const idx = norm.text.indexOf(needle, from);
      if (idx === -1) break;
      const end = idx + needle.length;
      if (boundaryOk(norm.text, idx, end)) {
        // 같은 엔티티의 더 긴 별칭이 이 위치에서 시작되면 억제 —
        // "가상가구사는"에서 긴 별칭 경계가 깨져도 '가상'이 대신 잡히지 않는다
        const subsumed = dictionary.some(
          (e) =>
            e.entityId === entry.entityId &&
            e.length > needle.length &&
            needles.has(e.aliasNormalized) &&
            norm.text.slice(idx, idx + e.length) === e.aliasNormalized,
        );
        if (!subsumed) candidates.push({ start: idx, end, entry });
      }
      from = idx + 1;
    }
  }

  // 2) 겹침 해소 — 긴 구간 우선, 같으면 앞쪽 우선
  candidates.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  const chosen: Span[] = [];
  const occupied = new Array<boolean>(norm.text.length).fill(false);
  for (const c of candidates) {
    let overlap = false;
    for (let i = c.start; i < c.end; i++) {
      if (occupied[i]) {
        overlap = true;
        break;
      }
    }
    if (overlap) continue;
    for (let i = c.start; i < c.end; i++) occupied[i] = true;
    chosen.push(c);
  }
  chosen.sort((a, b) => a.start - b.start);

  // 3) 같은 엔티티 다중 언급은 모두 기록, first_position 계산
  const firstSeen = new Map<string, number>();
  let pos = 0;
  const seenEntity = new Set<string>();
  for (const c of chosen) {
    if (!seenEntity.has(c.entry.entityId)) {
      seenEntity.add(c.entry.entityId);
      firstSeen.set(c.entry.entityId, pos);
      pos += 1;
    }
  }

  const mentions: MatchCandidate[] = chosen.map((c) => {
    const span = toOriginalSpan(norm, original, c.start, c.end);
    return {
      entityId: c.entry.entityId,
      entityName: c.entry.entityName,
      kind: c.entry.kind,
      matchedAlias: c.entry.alias,
      start: span.start,
      end: span.end,
      ambiguous: c.entry.ambiguous,
      confidence: c.entry.ambiguous ? 0.5 : 1.0,
    };
  });

  // 4) 도메인 히트 (언급으로 세지 않는다 — PRD §3 FEAT-3)
  const domainHits: MatchResult['domainHits'] = [];
  for (const e of entities) {
    for (const d of e.officialDomains ?? []) {
      const normDomain = normalizeText(d).text;
      if (normDomain && norm.text.includes(normDomain)) {
        domainHits.push({ entityId: e.id, domain: d });
      }
    }
  }

  return { mentions, firstPositions: firstSeen, domainHits };
}
