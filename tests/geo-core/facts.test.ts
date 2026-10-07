import { describe, expect, it } from 'vitest';

import { compareClaim, normalizeValue, valuesComparable, type FactForCompare } from '@/lib/geo-core';

const FACTS: FactForCompare[] = [
  {
    id: 'f1',
    entityId: 'b1',
    attributeNormalized: '가격',
    value: '12000',
    unit: '원',
    status: 'verified',
  },
  {
    id: 'f2',
    entityId: 'b1',
    attributeNormalized: '배송',
    value: '3',
    unit: '일',
    status: 'expired',
  },
];

describe('normalizeValue', () => {
  it.each([
    ['1,200원', 1200, '원', 'currency'],
    ['1200', 1200, null, 'none'],
    ['12만 원', 120000, '원', 'currency'],
    ['3일', 3, '일', 'time'],
    ['$99', 99, '$', 'currency'],
    ['10 kg', 10, 'kg', 'size'],
  ] as const)('%s → %j', (input, num, unit, kind) => {
    const r = normalizeValue(input);
    expect(r.numeric).toBe(num);
    expect(r.unit).toBe(unit);
    expect(r.unitKind).toBe(kind);
  });
});

describe('valuesComparable', () => {
  it('같은 수치·단위 계열 → true', () => {
    expect(valuesComparable(normalizeValue('1,200원'), normalizeValue('1200원'))).toBe(true);
    expect(valuesComparable(normalizeValue('12만 원'), normalizeValue('120000원'))).toBe(true);
  });
  it('다른 수치 → false', () => {
    expect(valuesComparable(normalizeValue('1500원'), normalizeValue('1200원'))).toBe(false);
  });
  it('단위 불일치 → null', () => {
    expect(valuesComparable(normalizeValue('3일'), normalizeValue('3개'))).toBe(null);
  });
});

describe('compareClaim', () => {
  it('일치 → match', () => {
    const r = compareClaim({ entityId: 'b1', attribute: '가격', value: '12,000', unit: '원' }, FACTS);
    expect(r).toEqual({ verdict: 'match', factId: 'f1' });
  });

  it('충돌 → conflict', () => {
    const r = compareClaim({ entityId: 'b1', attribute: '가격', value: '15000', unit: '원' }, FACTS);
    expect(r.verdict).toBe('conflict');
  });

  it('사실 없음 → insufficient', () => {
    const r = compareClaim({ entityId: 'b1', attribute: '소재', value: '원목' }, FACTS);
    expect(r.verdict).toBe('insufficient');
  });

  it('만료 사실만 있음 → time_unknown', () => {
    const r = compareClaim({ entityId: 'b1', attribute: '배송', value: '2일' }, FACTS);
    expect(r).toEqual({ verdict: 'time_unknown', factId: 'f2' });
  });

  it('단위 불일치 → needs_review', () => {
    const facts: FactForCompare[] = [
      { id: 'f3', entityId: 'b1', attributeNormalized: '배송', value: '3', unit: '일', status: 'verified' },
    ];
    const r = compareClaim({ entityId: 'b1', attribute: '배송', value: '72', unit: '시간' }, facts);
    expect(r.verdict).toBe('needs_review');
  });
});
