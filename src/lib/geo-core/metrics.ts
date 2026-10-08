/**
 * 측정 슬롯 지표 — 분자·분모를 함께 보존하고 결측(N/A)과 0을 구분한다.
 * 원칙 출처: leecg39/GEO_master2 PRD §5 (질문별 k/n, 수집 완료율, 거절률).
 * - 분모 = 정상 답변(succeeded)만. 거절·실패는 분모에서 제외하고 따로 센다.
 * - 수집 완료율 = (정상 + 명시 거절) ÷ 예정 슬롯
 */

export const METRIC_VERSION = "m1.0";

export type SlotStatus = "succeeded" | "refused" | "failed";

export interface SlotRow {
  question: string;
  provider: string;
  status: SlotStatus;
  brandMentioned: boolean;
}

export interface Ratio {
  numerator: number;
  denominator: number;
  /** 백분율(소수 1자리). 분모가 0이면 null(N/A) */
  value: number | null;
}

export interface QuestionCell {
  question: string;
  provider: string;
  mentioned: number;
  valid: number;
  refused: number;
  failed: number;
  planned: number;
  /** "k/n" 또는 유효 답변이 없으면 "N/A" */
  label: string;
}

export interface CollectionQuality {
  planned: number;
  succeeded: number;
  refused: number;
  failed: number;
  completionRate: Ratio;
  refusalRate: Ratio;
}

export function ratio(numerator: number, denominator: number): Ratio {
  return {
    numerator,
    denominator,
    value: denominator > 0 ? Number(((numerator / denominator) * 100).toFixed(1)) : null,
  };
}

function countStatus(rows: readonly SlotRow[], status: SlotStatus) {
  return rows.filter((row) => row.status === status).length;
}

export function questionMatrix(rows: readonly SlotRow[]): QuestionCell[] {
  const groups = new Map<string, SlotRow[]>();
  for (const row of rows) {
    const key = JSON.stringify([row.question, row.provider]);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()].map((group) => {
    const valid = countStatus(group, "succeeded");
    const mentioned = group.filter((row) => row.status === "succeeded" && row.brandMentioned).length;
    return {
      question: group[0]!.question,
      provider: group[0]!.provider,
      mentioned,
      valid,
      refused: countStatus(group, "refused"),
      failed: countStatus(group, "failed"),
      planned: group.length,
      label: valid > 0 ? `${mentioned}/${valid}` : "N/A",
    };
  });
}

export function collectionQuality(rows: readonly SlotRow[]): CollectionQuality {
  const succeeded = countStatus(rows, "succeeded");
  const refused = countStatus(rows, "refused");
  return {
    planned: rows.length,
    succeeded,
    refused,
    failed: countStatus(rows, "failed"),
    completionRate: ratio(succeeded + refused, rows.length),
    refusalRate: ratio(refused, succeeded + refused),
  };
}
