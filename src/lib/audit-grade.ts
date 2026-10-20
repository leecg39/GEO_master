/**
 * GEO 진단 등급 — 통과한 항목 수로 매긴다.
 * 서버(audit.ts)와 화면이 같은 기준을 쓰도록 이 모듈 하나에만 기준값을 둔다. (RankSEO REA L1: 화면마다 다른 등급 기준)
 */
export const AUDIT_GRADE_GOOD_MIN = 25;
export const AUDIT_GRADE_FAIR_MIN = 20;

export type AuditGradeLabel = "우수" | "보통" | "개선 필요";
export type AuditGradeTone = "good" | "warn" | "bad";

export function auditGrade(score: number): AuditGradeLabel {
  return score >= AUDIT_GRADE_GOOD_MIN ? "우수" : score < AUDIT_GRADE_FAIR_MIN ? "개선 필요" : "보통";
}

export function auditGradeTone(score: number): AuditGradeTone {
  const grade = auditGrade(score);
  return grade === "우수" ? "good" : grade === "개선 필요" ? "bad" : "warn";
}

/** 화면에 등급 옆에 붙이는 척도 설명 */
export function auditGradeScale(total: number) {
  return `${total}개 중 통과 수 기준 · ${AUDIT_GRADE_GOOD_MIN}개 이상 우수 · ${AUDIT_GRADE_FAIR_MIN}~${AUDIT_GRADE_GOOD_MIN - 1}개 보통 · ${AUDIT_GRADE_FAIR_MIN}개 미만 개선 필요`;
}
