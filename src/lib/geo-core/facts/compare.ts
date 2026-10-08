// Ported from leecg39/GEO_master2 packages/core/src/facts/compare.ts
export type ClaimVerdict = 'match' | 'conflict' | 'insufficient' | 'time_unknown' | 'needs_review';

import { normalizeAttribute } from './attribute';
import { normalizeValue, valuesComparable } from './units';

/**
 * 사실 대조 (TRD §7): 추출된 주장을 사실 메모와 비교.
 * - 대응 사실 없음 → insufficient
 * - 만료 사실만 있음 → time_unknown
 * - 단위 불일치 → needs_review
 */

export interface ExtractedClaim {
  entityId: string | null;
  attribute: string | null;
  value: string | null;
  unit?: string | null;
}

export interface FactForCompare {
  id: string;
  entityId: string | null;
  attributeNormalized: string;
  value: string;
  unit: string | null;
  status: 'unverified' | 'verified' | 'expired';
}

export interface ClaimComparison {
  verdict: ClaimVerdict;
  factId: string | null;
}

export function compareClaim(
  claim: ExtractedClaim,
  facts: FactForCompare[],
): ClaimComparison {
  if (!claim.attribute || claim.value === null) {
    return { verdict: 'insufficient', factId: null };
  }
  const attrNorm = normalizeAttribute(claim.attribute);
  const candidates = facts.filter(
    (f) =>
      f.attributeNormalized === attrNorm &&
      (claim.entityId === null || f.entityId === null || f.entityId === claim.entityId),
  );
  if (candidates.length === 0) return { verdict: 'insufficient', factId: null };

  const active = candidates.filter((f) => f.status !== 'expired');
  if (active.length === 0) {
    // 만료 사실만 존재 — 시점 불명 판정
    return { verdict: 'time_unknown', factId: candidates[0]!.id };
  }

  const claimNorm = normalizeValue(
    claim.unit ? `${claim.value} ${claim.unit}` : claim.value,
  );

  let sawUnitMismatch = false;
  for (const fact of active) {
    const factNorm = normalizeValue(fact.unit ? `${fact.value} ${fact.unit}` : fact.value);
    const comparable = valuesComparable(claimNorm, factNorm);
    if (comparable === true) return { verdict: 'match', factId: fact.id };
    if (comparable === null) sawUnitMismatch = true;
    // comparable === false → 후보는 계속 둔다 (조건이 다른 사실이 있을 수 있음)
  }
  if (sawUnitMismatch) {
    return { verdict: 'needs_review', factId: active[0]!.id };
  }
  return { verdict: 'conflict', factId: active[0]!.id };
}
