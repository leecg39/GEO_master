import { describe, expect, it } from 'vitest';

import { checkDraftBlock, type DraftFact } from '@/lib/geo-core';

const FACTS: DraftFact[] = [
  { id: 'f1', attribute: 'price', value: '100000', unit: 'KRW', usable: true },
  { id: 'f2', attribute: 'warranty', value: '3', unit: 'years', usable: true },
  { id: 'f3', attribute: 'old', value: '50000', unit: 'KRW', usable: false },
];

describe('checkDraftBlock', () => {
  it('근거 없음 → needs_edit', () => {
    expect(checkDraftBlock({ text: 'x', factIds: [] }, { facts: FACTS }).check).toBe('needs_edit');
  });

  it('입력 밖 사실 → needs_edit', () => {
    expect(checkDraftBlock({ text: 'x', factIds: ['unknown'] }, { facts: FACTS }).check).toBe('needs_edit');
  });

  it('미검증 사실 → needs_edit', () => {
    expect(checkDraftBlock({ text: 'x', factIds: ['f3'] }, { facts: FACTS }).check).toBe('needs_edit');
  });

  it('사실 값과 일치하는 수치 → ok', () => {
    const r = checkDraftBlock({ text: '가격은 100,000원입니다', factIds: ['f1'] }, { facts: FACTS });
    expect(r.check).toBe('ok');
  });

  it('사실에 없는 수치 → needs_edit', () => {
    const r = checkDraftBlock({ text: '가격은 120,000원입니다', factIds: ['f1'] }, { facts: FACTS });
    expect(r.check).toBe('needs_edit');
  });

  it('경쟁사 이름 + 수치 → needs_edit, 이름만 → ok', () => {
    const opts = { facts: FACTS, competitorNames: ['한샘'] };
    expect(checkDraftBlock({ text: '한샘은 100,000원', factIds: ['f1'] }, opts).check).toBe('needs_edit');
    expect(checkDraftBlock({ text: '한샘 대비 우위', factIds: ['f2'] }, opts).check).toBe('ok');
  });
});
