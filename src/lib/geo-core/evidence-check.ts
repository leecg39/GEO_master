// Ported from leecg39/GEO_master2 packages/core/src/drafts/evidence-check.ts
export type DraftBlockCheck = 'ok' | 'needs_edit';

export interface DraftFact {
  id: string;
  attribute: string;
  value: string;
  unit: string | null;
  /** verified && 미만료만 true */
  usable: boolean;
}

export interface BlockCheckResult {
  check: DraftBlockCheck;
  reason?: string;
}

/** 텍스트에서 숫자 토큰(쉼표·소수점 포함) 추출 */
function extractNumbers(text: string): string[] {
  return text.match(/\d[\d,]*\.?\d*/g) ?? [];
}

function normalizeNum(s: string): string {
  return s.replace(/,/g, '');
}

/**
 * 초안 블록 근거 검사 (TRD §8):
 * - factIds 비어 있음 → needs_edit
 * - 입력 밖/미검증 사실 참조 → needs_edit
 * - 숫자가 참조 사실 값에 없으면 needs_edit
 * - 경쟁사 이름 + 숫자 동시 등장 → needs_edit
 */
export function checkDraftBlock(
  block: { text: string; factIds: string[] },
  input: { facts: readonly DraftFact[]; competitorNames?: readonly string[] },
): BlockCheckResult {
  if (block.factIds.length === 0) {
    return { check: 'needs_edit', reason: '근거 사실이 없습니다' };
  }
  const referenced = block.factIds.map((id) => input.facts.find((f) => f.id === id));
  if (referenced.some((f) => !f)) {
    return { check: 'needs_edit', reason: '입력에 없는 사실을 참조했습니다' };
  }
  if (referenced.some((f) => !f!.usable)) {
    return { check: 'needs_edit', reason: '만료되었거나 미검증인 사실을 참조했습니다' };
  }

  const factNums = new Set(
    referenced.flatMap((f) => extractNumbers(`${f!.value} ${f!.unit ?? ''}`).map(normalizeNum)),
  );
  const blockNums = extractNumbers(block.text).map(normalizeNum);
  if (blockNums.some((n) => !factNums.has(n))) {
    return { check: 'needs_edit', reason: '참조 사실에 없는 수치가 포함되어 있습니다' };
  }

  const hasCompetitor = (input.competitorNames ?? []).some(
    (n) => n.length > 0 && block.text.includes(n),
  );
  if (hasCompetitor && blockNums.length > 0) {
    return { check: 'needs_edit', reason: '경쟁사 이름과 수치가 함께 있습니다 — 수동 확인 필요' };
  }

  return { check: 'ok' };
}
