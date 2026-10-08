// Ported from leecg39/GEO_master2 packages/core/src/quality/precision-recall.ts
/**
 * 탐지 품질 — eval 스플릿 골드 라벨 대비 정밀도·재현율.
 * 분모 0은 null (0%가 아니라 N/A로 보여야 한다).
 */

export interface EvalLabelInput {
  responseId: string;
  entityId: string;
  goldMentioned: boolean;
}

export interface QualityMetrics {
  sampleCount: number;
  precision: number | null;
  recall: number | null;
}

export function computePrecisionRecall(
  labels: EvalLabelInput[],
  detected: ReadonlyArray<{ responseId: string; entityId: string }>,
): QualityMetrics {
  const detectedSet = new Set(detected.map((d) => `${d.responseId}:${d.entityId}`));
  const goldPositives = labels.filter((l) => l.goldMentioned);
  const tp = goldPositives.filter((l) => detectedSet.has(`${l.responseId}:${l.entityId}`)).length;
  // 탐지된 것 중 골드 라벨 범위 안의 true positive — precision 분모는 "라벨이 붙은 쌍 중 탐지됨"
  const detectedInLabels = labels.filter((l) => detectedSet.has(`${l.responseId}:${l.entityId}`)).length;
  return {
    sampleCount: labels.length,
    precision: detectedInLabels === 0 ? null : tp / detectedInLabels,
    recall: goldPositives.length === 0 ? null : tp / goldPositives.length,
  };
}

/** 예외 검수 모드 전환 자격 — 표본·정밀도·재현율 동시 충족 */
export const EXCEPTION_THRESHOLDS = {
  minSamples: 200,
  minPrecision: 0.97,
  minRecall: 0.9,
} as const;

export function exceptionModeEligible(m: QualityMetrics): boolean {
  return (
    m.sampleCount >= EXCEPTION_THRESHOLDS.minSamples &&
    m.precision !== null &&
    m.precision >= EXCEPTION_THRESHOLDS.minPrecision &&
    m.recall !== null &&
    m.recall >= EXCEPTION_THRESHOLDS.minRecall
  );
}

/** group_key 기반 결정적 dev/eval 분할 — 같은 키는 항상 같은 쪽 */
export function evalSplitForKey(groupKey: string): 'dev' | 'eval' {
  let hash = 0;
  for (let i = 0; i < groupKey.length; i += 1) {
    hash = (hash * 31 + groupKey.charCodeAt(i)) >>> 0;
  }
  return hash % 10 < 8 ? 'dev' : 'eval'; // 80/20
}
