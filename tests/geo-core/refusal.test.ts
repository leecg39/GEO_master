import { describe, expect, it } from 'vitest';

import { classifyRefusal } from '@/lib/geo-core';

describe('거절 패턴 분류', () => {
  it('영문 거절 감지', () => {
    expect(classifyRefusal("I'm sorry, but I can't provide that information.")).toBe(true);
    expect(classifyRefusal('I cannot access real-time information to answer this.')).toBe(
      true,
    );
  });

  it('한국어 거절 감지', () => {
    expect(classifyRefusal('죄송하지만 해당 정보를 제공할 수 없습니다.')).toBe(true);
    expect(classifyRefusal('죄송하지만 실시간 검색 정보가 없어 답변이 어렵습니다.')).toBe(
      true,
    );
  });

  it('정상 답변은 거절 아님', () => {
    expect(classifyRefusal('가상가구는 소형 아파트에 적합한 브랜드입니다.')).toBe(false);
    expect(
      classifyRefusal('The best options include IKEA, Hanssem, and local brands.'),
    ).toBe(false);
  });

  it('매우 짧은 텍스트는 거절로 보지 않음', () => {
    expect(classifyRefusal('n/a')).toBe(false);
  });
});
