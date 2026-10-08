import { describe, expect, it } from 'vitest';

import { assignRanks, buildDictionary, matchBrands, numberedItemPositions } from '@/lib/geo-core';

const ENTS = [
  { id: 'a', name: '알파', kind: 'brand' as const, aliases: [] },
  { id: 'b', name: '베타', kind: 'competitor' as const, aliases: [] },
  { id: 'c', name: '감마', kind: 'competitor' as const, aliases: [] },
];
const DICT = buildDictionary(ENTS);

describe('numberedItemPositions', () => {
  it('번호 목록 감지', () => {
    expect(numberedItemPositions('1. 알파\n2. 베타\n3. 감마')?.length).toBe(3);
    expect(numberedItemPositions('1) 알파\n2) 베타')).not.toBeNull();
  });

  it('불릿만 있으면 null', () => {
    expect(numberedItemPositions('- 알파\n- 베타')).toBeNull();
    expect(numberedItemPositions('알파와 베타를 추천')).toBeNull();
  });

  it('비연속 번호(1, 5)는 목록 아님', () => {
    expect(numberedItemPositions('1. 알파\n5. 베타')).toBeNull();
  });
});

describe('assignRanks', () => {
  it('번호 항목 내 언급에만 순위 부여', () => {
    const text = '추천 목록:\n1. 알파를 추천\n2. 베타도 괜찮음\n3. 감마는 보통';
    const { mentions } = matchBrands(text, DICT, ENTS);
    const ranks = assignRanks(text, mentions);
    const byEntity = new Map(mentions.map((m) => [m.entityId, ranks.get(m)]));
    expect(byEntity.get('a')).toBe(1);
    expect(byEntity.get('b')).toBe(2);
    expect(byEntity.get('c')).toBe(3);
  });

  it('번호 없는 나열은 전부 null', () => {
    const text = '알파, 베타, 감마 순으로 좋습니다.';
    const { mentions } = matchBrands(text, DICT, ENTS);
    const ranks = assignRanks(text, mentions);
    expect([...ranks.values()].every((r) => r === null)).toBe(true);
  });
});
