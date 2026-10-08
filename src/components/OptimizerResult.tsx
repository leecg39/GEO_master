"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { Check, Clipboard } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui";
import { FEATURE_KEYS, FEATURES, type FeatureConfig, type OptimizationResult } from "@/lib/featgeo";

function pct(value: number | null) {
  return value === null ? "N/A" : `${(value * 100).toFixed(1)}%`;
}

function normalized(config: FeatureConfig, key: (typeof FEATURE_KEYS)[number]) {
  const [lo, hi] = FEATURES[key].range;
  return (config[key] - lo) / (hi - lo);
}

function FeatureComparison({ baseline, target }: { baseline: FeatureConfig; target: FeatureConfig }) {
  return (
    <div className="space-y-2">
      {FEATURE_KEYS.map((key) => (
        <div key={key} className="grid grid-cols-[88px_1fr] items-center gap-2 text-xs">
          <span className="text-slate-400">{FEATURES[key].label}</span>
          <div className="space-y-1" aria-label={`${FEATURES[key].label}: 현재 ${Math.round(normalized(baseline, key) * 100)}%, 추천 ${Math.round(normalized(target, key) * 100)}%`}>
            <div className="h-1.5 rounded-full bg-slate-800"><div className="h-full rounded-full bg-[color:var(--app-chart-previous)]" style={{ width: `${normalized(baseline, key) * 100}%` }} /></div>
            <div className="h-1.5 rounded-full bg-slate-800"><div className="h-full rounded-full bg-[color:var(--app-chart-current)]" style={{ width: `${normalized(target, key) * 100}%` }} /></div>
          </div>
        </div>
      ))}
      <p className="pt-1 text-[11px] text-slate-500"><span className="text-[color:var(--app-chart-previous)]">■</span> 현재 원문(휴리스틱 추정) · <span className="text-[color:var(--app-chart-current)]">■</span> 추천 후보의 목표 설정</p>
    </div>
  );
}

export function OptimizerResult({ result }: { result: OptimizationResult }) {
  const [openId, setOpenId] = useState<number | null>(result.recommendedId);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const recommended = result.candidates.find((candidate) => candidate.id === result.recommendedId) ?? null;
  const points = useMemo(() => {
    const feasible = result.candidates.filter((candidate) => candidate.feasible);
    return {
      pareto: feasible.filter((candidate) => result.paretoIds.includes(candidate.id)).map((candidate) => ({ x: (candidate.quality ?? 0) * 100, y: (candidate.visibility ?? 0) * 100, id: candidate.id })),
      others: feasible.filter((candidate) => !result.paretoIds.includes(candidate.id)).map((candidate) => ({ x: (candidate.quality ?? 0) * 100, y: (candidate.visibility ?? 0) * 100, id: candidate.id })),
      baseline: [{ x: (result.baseline.quality ?? 0) * 100, y: result.baseline.visibility * 100, id: 0 }],
    };
  }, [result]);
  const infeasible = result.candidates.filter((candidate) => !candidate.feasible).length;

  async function copy(id: number, text: string) {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    window.setTimeout(() => setCopiedId(null), 1_500);
  }

  return (
    <div className="space-y-5">
      <Card className="border-amber-400/20 bg-amber-400/5">
        <p className="text-xs leading-5 text-amber-200">시뮬레이션 추정치입니다. 입력한 경쟁 출처와 내 콘텐츠만으로 만든 가상 답변에서의 인용 비중이며, 실제 AI 답변 측정(응답 점유율)과 합산하지 않습니다. 적용한 뒤에는 응답 점유율 측정으로 효과를 확인하세요.</p>
      </Card>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card><span className="text-xs text-slate-500">현재 원문 인용 비중</span><strong className="mt-2 block text-2xl text-white">{pct(result.baseline.visibility)}</strong><p className="mt-1 text-xs text-slate-500">품질 {pct(result.baseline.quality)}</p></Card>
        <Card><span className="text-xs text-slate-500">추천 후보 인용 비중</span><strong className="mt-2 block text-2xl text-[color:var(--app-status-good)]">{pct(recommended?.visibility ?? null)}</strong><p className="mt-1 text-xs text-slate-500">품질 {pct(recommended?.quality ?? null)}</p></Card>
        <Card><span className="text-xs text-slate-500">평가 후보</span><strong className="mt-2 block text-2xl text-white">{result.candidates.length}개</strong><p className="mt-1 text-xs text-slate-500">근거 없는 수치로 제외 {infeasible}개 · 호출 {result.callsUsed}회{result.stoppedReason === "budget" ? " · 예산 도달로 조기 종료" : result.stoppedReason === "canceled" ? " · 취소됨" : ""}</p></Card>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <h3 className="font-semibold text-white">노출 × 품질 (Pareto 전선)</h3>
          <p className="mt-1 text-xs text-slate-500">위·오른쪽일수록 좋습니다. 다른 후보에게 두 축 모두 밀리지 않는 후보가 전선입니다.</p>
          <div className="mt-3 h-64" role="img" aria-label={`후보 ${points.pareto.length + points.others.length}개의 품질과 인용 비중 산점도`}>
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 8, right: 12, bottom: 16, left: 0 }}>
                <CartesianGrid stroke="var(--color-dash-line)" />
                <XAxis type="number" dataKey="x" name="품질" unit="%" domain={[0, 100]} tick={{ fontSize: 11 }} />
                <YAxis type="number" dataKey="y" name="인용 비중" unit="%" domain={[0, "auto"]} tick={{ fontSize: 11 }} />
                <ZAxis range={[60, 60]} />
                <Tooltip formatter={(value) => `${Number(value).toFixed(1)}%`} />
                <Scatter name="원문" data={points.baseline} fill="var(--app-chart-previous)" shape="diamond" />
                <Scatter name="기타 후보" data={points.others} fill="var(--color-accent-violet)" />
                <Scatter name="Pareto 후보" data={points.pareto} fill="var(--app-chart-current)" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[11px] text-slate-500"><span className="text-[color:var(--app-chart-previous)]">◆</span> 원문 · <span className="text-[color:var(--app-chart-current)]">●</span> Pareto 후보 · <span className="text-[color:var(--color-accent-violet)]">●</span> 기타 후보</p>
        </Card>
        <Card>
          <h3 className="font-semibold text-white">피처 프로필</h3>
          <p className="mb-3 mt-1 text-xs text-slate-500">FeatGEO 13개 피처(구조·내용·언어). 높을수록 해당 성질이 강합니다.</p>
          {recommended ? <FeatureComparison baseline={result.baseline.profile} target={recommended.config} /> : <p className="text-sm text-slate-500">조건을 만족한 후보가 없습니다. 사실 메모를 보강하거나 실행 설정을 바꿔 보세요.</p>}
        </Card>
      </div>
      <Card>
        <h3 className="font-semibold text-white">후보 문안</h3>
        <ul className="mt-3 divide-y divide-white/5">
          {[...result.candidates].sort((a, b) => (b.visibility ?? -1) - (a.visibility ?? -1)).map((candidate) => (
            <li key={candidate.id} className="py-3">
              <button type="button" className="flex w-full flex-wrap items-center gap-2 text-left text-sm" aria-expanded={openId === candidate.id} onClick={() => setOpenId(openId === candidate.id ? null : candidate.id)}>
                <span className="text-slate-300">#{candidate.id} · {candidate.generation}세대</span>
                {candidate.id === result.recommendedId && <Badge tone="good">추천</Badge>}
                {result.paretoIds.includes(candidate.id) && <Badge tone="cyan">Pareto</Badge>}
                {!candidate.feasible && <Badge tone="warn">근거 없는 수치 {candidate.flaggedSentences.length}</Badge>}
                <span className="ml-auto text-xs text-slate-400">인용 {pct(candidate.visibility)} · 품질 {pct(candidate.quality)}</span>
              </button>
              {openId === candidate.id && (
                <div className="mt-3 space-y-3">
                  {candidate.flaggedSentences.length > 0 && <ul className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-xs text-amber-200">{candidate.flaggedSentences.map((sentence) => <li key={sentence}>자료 요청: {sentence}</li>)}</ul>}
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-950/50 p-4 text-sm leading-6 text-slate-200">{candidate.text}</pre>
                  {candidate.sampleAnswer && <details className="text-xs text-slate-400"><summary className="cursor-pointer">시뮬레이션 답변 예시 (내 출처 = 마지막 번호)</summary><p className="mt-2 whitespace-pre-wrap">{candidate.sampleAnswer}</p></details>}
                  <Button type="button" variant="secondary" disabled={!candidate.feasible} onClick={() => void copy(candidate.id, candidate.text)}>{copiedId === candidate.id ? <Check className="h-4 w-4" /> : <Clipboard className="h-4 w-4" />}{copiedId === candidate.id ? "복사됨" : "문안 복사"}</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
