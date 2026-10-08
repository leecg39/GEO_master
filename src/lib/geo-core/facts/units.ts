// Ported from leecg39/GEO_master2 packages/core/src/facts/units.ts
/**
 * 숫자·단위 정규화 — 사실 대조 시 값 비교용.
 * "1,200원" → {value:1200, unit:'원'}; "12만 원" → 120000.
 */

export interface NormalizedValue {
  numeric: number | null;
  unit: string | null;
  /** 단위 호환성 — 같은 계열이면 비교 가능 */
  unitKind: 'currency' | 'count' | 'time' | 'size' | 'none' | 'unknown';
}

const KOREAN_MAGNITUDE: Record<string, number> = {
  만: 10_000,
  억: 100_000_000,
  천: 1_000,
};

const UNIT_KIND: Record<string, NormalizedValue['unitKind']> = {
  원: 'currency',
  KRW: 'currency',
  '$': 'currency',
  USD: 'currency',
  '₩': 'currency',
  개: 'count',
  명: 'count',
  건: 'count',
  회: 'count',
  번: 'count',
  분: 'time',
  시간: 'time',
  일: 'time',
  주: 'time',
  개월: 'time',
  년: 'time',
  mm: 'size',
  cm: 'size',
  m: 'size',
  km: 'size',
  g: 'size',
  kg: 'size',
  ml: 'size',
  l: 'size',
};

const NUM_UNIT_RE = /^([\d,.]+)\s*(만|억|천)?\s*([가-힣a-zA-Z$₩]+)?$/u;
const ISO_UNIT_RE = /^([A-Z$₩]+)\s*([\d,.]+)$/;

export function normalizeValue(input: string): NormalizedValue {
  const s = input.trim();
  if (!s) return { numeric: null, unit: null, unitKind: 'none' };

  // "$120" / "USD 120" 형태
  const iso = ISO_UNIT_RE.exec(s);
  if (iso) {
    const num = Number(iso[2]!.replace(/,/g, ''));
    return { numeric: Number.isFinite(num) ? num : null, unit: iso[1]!, unitKind: UNIT_KIND[iso[1]!] ?? 'unknown' };
  }

  const m = NUM_UNIT_RE.exec(s);
  if (!m) return { numeric: null, unit: s, unitKind: 'unknown' };

  const base = Number(m[1]!.replace(/,/g, ''));
  if (!Number.isFinite(base)) return { numeric: null, unit: s, unitKind: 'unknown' };
  const magnitude = m[2] ? KOREAN_MAGNITUDE[m[2]]! : 1;
  const unit = m[3] ?? null;
  return {
    numeric: base * magnitude,
    unit,
    unitKind: unit ? UNIT_KIND[unit] ?? 'unknown' : 'none',
  };
}

/** 두 값이 같은 단위 계열이고 수치가 같으면 true. 단위가 다르면 null(판정 보류). */
export function valuesComparable(a: NormalizedValue, b: NormalizedValue): boolean | null {
  if (a.numeric === null || b.numeric === null) return null;
  const kindA = a.unitKind === 'none' ? b.unitKind : a.unitKind;
  const kindB = b.unitKind === 'none' ? a.unitKind : b.unitKind;
  if (kindA !== kindB) return null; // 단위 불일치 → needs_review
  if (a.unit && b.unit && a.unit !== b.unit) return null;
  return a.numeric === b.numeric;
}
