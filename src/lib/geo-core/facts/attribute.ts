// Ported from leecg39/GEO_master2 packages/core/src/facts/attribute.ts
/** 사실 메모 속성 — 자유 입력 + 추천 키 자동완성 (06-screens S-05) */
export const RECOMMENDED_ATTRIBUTES = [
  '가격',
  '규격',
  '소재',
  '인증',
  '배송',
  '최소주문',
  'A/S',
  '소재지',
  '설립연도',
] as const;

/** 속성 정규화 — 앞뒤 공백 제거, 소문자화(영문) */
export function normalizeAttribute(attr: string): string {
  return attr.trim().toLowerCase();
}

export function suggestAttributes(prefix: string): string[] {
  const p = prefix.trim().toLowerCase();
  if (!p) return [...RECOMMENDED_ATTRIBUTES];
  return RECOMMENDED_ATTRIBUTES.filter((a) => a.toLowerCase().includes(p));
}
