import type { SeoAnalysis, FindingStatus } from "@/lib/seo/contracts";
import { Button } from "@/components/ui";

const STATUS: Record<FindingStatus, string> = { pass: "확인", fail: "수정 검토", unknown: "미확인", not_applicable: "해당 없음" };
export function SeoFindingsPanel({
  analysis,
  onRegisterWorkCards,
  onCreateBrief,
  busy = false,
}: {
  analysis: SeoAnalysis | null;
  onRegisterWorkCards?: () => void;
  onCreateBrief?: (mode: "improve" | "new") => void;
  busy?: boolean;
}) {
  if (!analysis) return <p className="mt-3 text-xs text-slate-400">이전 검사 결과입니다. 다시 수집하면 근거와 검사 범위가 포함된 진단을 확인할 수 있습니다.</p>;
  const confirmedFails = analysis.findings.filter((finding) => finding.status === "fail" && finding.evidenceRefs.length > 0).length;
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
    {(onRegisterWorkCards || onCreateBrief) && <div className="mt-4 flex flex-wrap gap-2">
      {onRegisterWorkCards && <Button type="button" variant="secondary" disabled={busy || confirmedFails === 0} onClick={onRegisterWorkCards}>근거 있는 결함 {confirmedFails}건을 작업 카드로</Button>}
      {onCreateBrief && <>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => onCreateBrief("improve")}>기존 페이지 개선 기획</Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => onCreateBrief("new")}>신규 페이지 기획</Button>
      </>}
    </div>}
    <p className="mt-2 text-[11px] leading-5 text-slate-600">작업 카드는 전략 워크스페이스에, 기획 브리프는 스튜디오 이력에 저장됩니다. 근거가 없는 확정 결함은 등록하지 않습니다.</p>
  </details>;
}
