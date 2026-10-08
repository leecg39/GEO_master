import { describe, expect, it } from 'vitest';

import { computePrecisionRecall, evalSplitForKey, exceptionModeEligible } from '@/lib/geo-core';

describe('computePrecisionRecall', () => {
  it('정밀도·재현율 계산', () => {
    const labels = [
      { responseId: 'r1', entityId: 'a', goldMentioned: true },
      { responseId: 'r1', entityId: 'b', goldMentioned: true },
      { responseId: 'r2', entityId: 'a', goldMentioned: false },
    ];
    const detected = [
      { responseId: 'r1', entityId: 'a' },
      { responseId: 'r2', entityId: 'a' },
    ];
    const m = computePrecisionRecall(labels, detected);
    expect(m.recall).toBeCloseTo(0.5); // 1/2
    expect(m.precision).toBeCloseTo(0.5); // 탐지 2건 중 1건 gold positive
  });

  it('분모 0 → null (N/A)', () => {
    const m = computePrecisionRecall([], []);
    expect(m.precision).toBeNull();
    expect(m.recall).toBeNull();
  });
});

describe('exceptionModeEligible', () => {
  it('임계 충족', () => {
    expect(exceptionModeEligible({ sampleCount: 250, precision: 0.98, recall: 0.92 })).toBe(true);
    expect(exceptionModeEligible({ sampleCount: 199, precision: 1, recall: 1 })).toBe(false);
    expect(exceptionModeEligible({ sampleCount: 250, precision: 0.96, recall: 0.95 })).toBe(false);
  });
});

describe('evalSplitForKey', () => {
  it('결정적 — 같은 키는 같은 분할', () => {
    expect(evalSplitForKey('prompt-a')).toBe(evalSplitForKey('prompt-a'));
    const splits = new Set([...Array(40)].map((_, i) => evalSplitForKey(`key-${i}`)));
    expect(splits.size).toBe(2);
  });
});
