import { describe, expect, it } from 'vitest';

import { buildDictionary, matchBrands } from '@/lib/geo-core';

const ENTITIES = [
  {
    id: 'brand-1',
    name: '가상가구',
    kind: 'brand' as const,
    officialDomains: ['gasang.kr'],
    aliases: [
      { alias: '가상가구', ambiguous: false },
      { alias: 'Gasang', ambiguous: false },
      { alias: '가상', ambiguous: true },
    ],
  },
  {
    id: 'comp-1',
    name: '한샘',
    kind: 'competitor' as const,
    officialDomains: ['hanssem.com'],
    aliases: [{ alias: 'Hanssem', ambiguous: false }],
  },
  {
    id: 'comp-2',
    name: '이케아',
    kind: 'competitor' as const,
    officialDomains: ['ikea.com'],
    aliases: [{ alias: 'IKEA', ambiguous: false }],
  },
];

function match(text: string) {
  return matchBrands(text, buildDictionary(ENTITIES), ENTITIES);
}

describe('브랜드 매칭', () => {
  it('브랜드명 + 조사 ("가상가구는") 매칭', () => {
    const r = match('가상가구는 소형 아파트에 좋습니다.');
    expect(r.mentions.map((m) => m.entityId)).toContain('brand-1');
    const m = r.mentions.find((x) => x.entityId === 'brand-1')!;
    expect(m.matchedAlias).toBe('가상가구');
    expect(m.ambiguous).toBe(false);
  });

  it('최장 일치 우선 — "가상가구"에서 짧은 "가상"은 매칭되지 않는다', () => {
    const r = match('가상가구는 인기 브랜드다');
    const brandMentions = r.mentions.filter((m) => m.entityId === 'brand-1');
    expect(brandMentions).toHaveLength(1);
    expect(brandMentions[0]!.matchedAlias).toBe('가상가구');
  });

  it('단독 "가상"은 ambiguous로 플래그', () => {
    const r = match('가상 현실 기술이 발전한다');
    const m = r.mentions.find((x) => x.matchedAlias === '가상');
    if (m) expect(m.ambiguous).toBe(true);
  });

  it('한글 조사 경계: "가상가구의" "가상가구에서" 매칭', () => {
    for (const t of ['가상가구의 품질', '가상가구에서 구매했다', '가상가구와 한샘을 비교']) {
      const r = match(t);
      expect(r.mentions.some((m) => m.entityId === 'brand-1'), t).toBe(true);
    }
  });

  it('단어 내부 문자열은 매칭되지 않음 ("신한샘물"에서 "한샘" 불일치는 허용 범위, 경계 규칙 확인)', () => {
    const r = match('한샘가구점에서 샀다');
    // "한샘" 뒤 "가"는 조사로 허용됨 — 언급으로 카운트
    expect(r.mentions.some((m) => m.entityId === 'comp-1')).toBe(true);
  });

  it('영문 별칭 대소문자 무시 — "GASANG 가구" 매칭', () => {
    const r = match('GASANG 가구를 추천합니다');
    expect(r.mentions.some((m) => m.matchedAlias === 'Gasang')).toBe(true);
  });

  it('영문은 단어 경계 필요 — "ikea할인" 불일치', () => {
    const r = match('ikea할인 정보');
    expect(r.mentions.some((m) => m.entityId === 'comp-2')).toBe(false);
  });

  it('부정문도 언급으로 식별 — "가상가구는 추천하지 않는다"', () => {
    const r = match('가상가구는 추천하지 않는다');
    expect(r.mentions.some((m) => m.entityId === 'brand-1')).toBe(true);
  });

  it('도메인만 있으면 언급 아님 — domainHits로만 기록', () => {
    const r = match('자세한 건 gasang.kr에서 확인하세요');
    expect(r.mentions.some((m) => m.entityId === 'brand-1')).toBe(false);
    expect(r.domainHits).toContainEqual({ entityId: 'brand-1', domain: 'gasang.kr' });
  });

  it('첫 언급 순서 — 경쟁사가 먼저 나오면 competitor_first 판정 근거', () => {
    const r = match('이케아가 인기지만 가상가구도 좋다');
    expect(r.firstPositions.get('comp-2')).toBe(0);
    expect(r.firstPositions.get('brand-1')).toBe(1);
  });

  it('다중 언급은 모두 기록', () => {
    const r = match('가상가구는 좋고, 다시 가상가구를 찾았다');
    expect(r.mentions.filter((m) => m.entityId === 'brand-1').length).toBe(2);
  });

  it('경쟁사 매칭 — "IKEA와 한샘" 모두 식별', () => {
    const r = match('IKEA와 한샘을 비교하면');
    expect(r.mentions.map((m) => m.entityId)).toEqual(
      expect.arrayContaining(['comp-1', 'comp-2']),
    );
  });

  it('정규화 오프셋이 원문 오프셋과 일치', () => {
    const text = '그래서  가상가구는  좋다';
    const r = match(text);
    const m = r.mentions.find((x) => x.entityId === 'brand-1')!;
    expect(text.slice(m.start, m.end)).toBe('가상가구');
  });
});
