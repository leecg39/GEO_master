import { Badge, Card } from "@/components/ui";
import { formatRatio, type MeasurementEvidence } from "@/lib/measurement-evidence";

const providerLabels: Record<string, string> = { openai: "GPT", anthropic: "Claude", gemini: "Gemini", grok: "Grok" };

function cellTone(label: string, mentioned: number, valid: number) {
  if (label === "N/A") return "text-slate-600";
  if (mentioned === 0) return "text-rose-300";
  return mentioned === valid ? "text-emerald-300" : "text-amber-300";
}

export function MeasurementEvidencePanel({ evidence, className }: { evidence: MeasurementEvidence; className?: string }) {
  if (evidence.legacy) {
    return (
      <Card className={className}>
        <h2 className="font-semibold text-white">분모 근거</h2>
        <p className="mt-2 text-xs text-slate-500">이 실행은 슬롯 상태 기록 이전(legacy 산식)에 저장되어 거절·실패 구분과 질문별 k/n을 제공하지 않습니다.</p>
      </Card>
    );
  }
  const { quality, questionMatrix, questions, providers } = evidence;
  const cell = (question: string, provider: string) => questionMatrix.find((item) => item.question === question && item.provider === provider);
  return (
    <Card className={className}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-white">분모 근거</h2>
        <Badge tone="cyan">산식 {evidence.metricVersion}</Badge>
      </div>
      {quality && (
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div><dt className="text-xs text-slate-500">예정 슬롯</dt><dd className="text-white">{quality.planned}</dd></div>
          <div><dt className="text-xs text-slate-500">정상 답변</dt><dd className="text-white">{quality.succeeded}</dd></div>
          <div><dt className="text-xs text-slate-500">명시 거절</dt><dd className="text-white">{quality.refused}</dd></div>
          <div><dt className="text-xs text-slate-500">수집 실패(결측)</dt><dd className="text-white">{quality.failed}</dd></div>
          <div className="col-span-2"><dt className="text-xs text-slate-500">수집 완료율</dt><dd className="text-white">{formatRatio(quality.completionRate)}</dd></div>
          <div className="col-span-2"><dt className="text-xs text-slate-500">거절률</dt><dd className="text-white">{formatRatio(quality.refusalRate)}</dd></div>
        </dl>
      )}
      <p className="mt-3 text-xs text-slate-500">점유율 분모는 정상 답변만 사용합니다. 거절·실패는 0으로 세지 않고 따로 표시합니다.</p>
      {questions.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[420px] text-left text-xs">
            <caption className="sr-only">질문별·모델별 브랜드 언급 횟수 / 정상 답변 수</caption>
            <thead>
              <tr className="text-slate-500">
                <th scope="col" className="py-2 pr-3 font-medium">질문</th>
                {providers.map((provider) => <th scope="col" key={provider} className="px-2 py-2 text-center font-medium">{providerLabels[provider] ?? provider}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {questions.map((question) => (
                <tr key={question}>
                  <th scope="row" className="py-2 pr-3 font-normal text-slate-300">{question}</th>
                  {providers.map((provider) => {
                    const item = cell(question, provider);
                    if (!item) return <td key={provider} className="px-2 py-2 text-center text-slate-600">-</td>;
                    const missing = item.refused + item.failed;
                    return (
                      <td key={provider} className={`px-2 py-2 text-center font-semibold ${cellTone(item.label, item.mentioned, item.valid)}`}>
                        {item.label}
                        {missing > 0 && <span className="block font-normal text-slate-600">결측 {missing}</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
