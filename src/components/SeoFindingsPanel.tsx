import type { SeoAnalysis, FindingStatus } from "@/lib/seo/contracts";

const STATUS: Record<FindingStatus, string> = { pass: "확인", fail: "수정 검토", unknown: "미확인", not_applicable: "해당 없음" };
export function SeoFindingsPanel({ analysis }: { analysis: SeoAnalysis | null }) {
  if (!analysis) return <p className="mt-3 text-xs text-slate-400">이전 검사 결과입니다. 다시 수집하면 근거와 검사 범위가 포함된 진단을 확인할 수 있습니다.</p>;
  return <details className="mb-5 rounded-xl border border-white/10 p-4 text-sm">
    <summary className="cursor-pointer text-slate-200">
      근거 기반 기술 진단 · {analysis.score.value === null ? "미측정" : `${analysis.score.value}점`}
      {" "}· 검사 범위 {analysis.score.coverage === null ? "해당 없음" : `${analysis.score.coverage}%`}
    </summary>
    <p className="mt-3 text-xs leading-5 text-slate-400">자체 기술 검사입니다. 미확인·해당 없음은 점수에서 제외하며, 권고와 검색 성과는 별도로 봅니다. 규칙 {analysis.version}</p>
    <ul className="mt-3 space-y-3">
      {analysis.findings.map((finding) => <li key={finding.id} className="text-xs leading-5 text-slate-400">
        <p><span className={finding.status === "fail" ? "text-amber-300" : "text-slate-200"}>{STATUS[finding.status]}</span> · {finding.explanation}</p>
        <p className="break-all text-slate-500">{finding.category === "technical" ? "기술 검사" : "유형별 권고"} · {finding.ruleVersion} · {finding.evidenceRefs.join(", ") || "수집 근거 없음"}</p>
      </li>)}
    </ul>
  </details>;
}
