// Ported from leecg39/GEO_master2 packages/core/src/refusal/classify.ts
/**
 * 거절 패턴 분류 (TRD §5 단계 6).
 * 답변 본문이 사실상 거절이면 refused — 지표 분모에서 제외한다.
 */

const REFUSAL_PATTERNS: RegExp[] = [
  /i can'?t\b/i,
  /i cannot\b/i,
  /i'?m unable to\b/i,
  /i don'?t have (access|the ability|enough information)\b/i,
  /i apologize.{0,80}(can'?t|cannot|unable)/i,
  /as an ai.{0,60}(can'?t|cannot|unable)/i,
  /i'?m not able to\b/i,
  /cannot (access|browse|retrieve|search)\b/i,
  /unable to (access|browse|retrieve|search)\b/i,
  /no real[- ]?time\b/i,
  /i do not have access\b/i,
  // 한국어
  /죄송하지만.{0,80}(할 수 없|어렵|제공할 수 없|찾을 수 없)/u,
  /실시간.{0,30}(정보|검색).{0,30}(없|불가)/u,
  /접근할 수 없/u,
  /제공할 수 없습니다/u,
  /답변.{0,20}어렵/u,
  /정보를 (찾을|확인할) 수 없/u,
];

const MIN_LEN = 20;

export function classifyRefusal(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < MIN_LEN) return false;
  // 충분히 긴 본문에서 앞쪽 일부에만 거절 패턴이 있으면 거절 아님 — 전체 검사
  return REFUSAL_PATTERNS.some((p) => p.test(trimmed));
}
