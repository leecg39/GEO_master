import type { MonitoringConditionComparison } from "@/lib/monitoring-types";
import { fieldClass } from "./MonitoringQuestionEditor";

export function MonitoringConditions({ conditions, onChange }: { conditions: MonitoringConditionComparison; onChange: (mode: "all" | "same") => void }) {
  return <div className="mb-5 rounded-xl border border-[color:var(--app-card-border)] bg-[color:var(--app-card-bg)] p-4 text-xs text-[color:var(--app-text-muted)]">
    <div className="flex flex-wrap items-center justify-between gap-3"><label className="flex min-w-0 flex-wrap items-center gap-2">비교 조건<select aria-label="측정 비교 조건" className={`${fieldClass} max-w-full sm:w-auto`} value={conditions.mode} onChange={(event) => onChange(event.target.value as "all" | "same")}><option value="all">전체 조건</option><option value="same" disabled={!conditions.current?.known}>최근 실행과 같은 조건</option></select></label><span>{conditions.mode === "same" ? `조건이 다른 ${conditions.excludedRuns}회 제외 · CSV에도 적용` : "질문·모델·검색·반복 조건을 확인하세요."}</span></div>
    {conditions.differences.length > 0 && <p className="mt-3 leading-6">{conditions.differences.join(" ")}</p>}
    {!conditions.current?.known && <p className="mt-2 leading-6">최근 실행의 조건 기록이 부족해 동일 조건 비교를 사용할 수 없습니다.</p>}
    {conditions.current && <details className="mt-2"><summary className="min-h-11 cursor-pointer py-3">측정 조건 보기</summary><div className="grid min-w-0 gap-4 pt-2 md:grid-cols-2">{(["baseline", "current"] as const).map((key) => {
      const item = conditions[key];
      return <div key={key} className="min-w-0"><h3 className="font-semibold text-[color:var(--app-text)]">{key === "baseline" ? "기준 실행" : "최근 실행"}</h3>{item ? <><p className="mt-2">질문 {item.questionCount}개 · 검색 요청 {item.requestedSearchMode === "web" ? "사용" : item.requestedSearchMode === "off" ? "사용 안 함" : "기록 없음"}</p><p className="mt-1 break-words leading-6">{item.models.join(" / ") || "모델 기록 없음"}</p><p className="mt-1 break-words leading-6">적용 조건: {item.searchModes.map((mode) => mode.replace(": off", ": 일반 응답").replace(": web", ": 웹검색 요청")).join(" / ") || "기록 없음"}</p></> : <p>비교할 기준 실행이 없습니다.</p>}</div>;
    })}</div><p className="mt-3 leading-6">동일 조건은 저장된 질문·서비스·모델 버전·검색 설정·반복 구성 기준입니다. 실제 검색 결과나 답변까지 같음을 뜻하지 않습니다.</p></details>}
  </div>;
}
