"use client";
import { Button } from "@/components/ui";
import type { MonitoringData } from "@/lib/monitoring-types";
import { percent, runDate } from "./MonitoringCharts";
import { fieldClass } from "./MonitoringQuestionEditor";
import { MonitoringModelResponseCard } from "./MonitoringModelResponseCard";
import { useMonitoringResponses } from "./useMonitoringResponses";

function ResponseEvidence({ query }: { query: string }) {
  const { data, loading, error, retry } = useMonitoringResponses(query);
  if (loading) return <p role="status" className="py-8 text-sm text-[color:var(--app-text-muted)]">선택 실행의 AI 응답을 불러오는 중입니다.</p>;
  if (error) return <div className="py-5"><p role="alert" className="mb-3 text-sm text-[color:var(--app-status-danger)]">{error}</p><Button variant="secondary" onClick={retry}>응답 다시 불러오기</Button></div>;
  if (!data) return null;
  return <>
    <div className="my-4 flex flex-wrap gap-x-6 gap-y-2 rounded-xl bg-[color:var(--app-badge-bg)] p-4 text-sm tabular-nums"><span>선택 시점 언급률 <strong>{data.summary.mentions} / 성공 {data.summary.succeeded} · {percent(data.summary.share)}</strong></span><span>언급 서비스 <strong>{data.summary.mentionedProviderCount} / 4</strong></span><span className="text-xs text-[color:var(--app-text-muted)]">측정 서비스 {data.summary.measuredProviderCount} / 4 · 실패 {data.summary.failed} · 거절 {data.summary.refused}</span></div>
    <p role="status" aria-live="polite" className="mb-4 text-xs leading-6 text-[color:var(--app-text-muted)]">{runDate(data.run.at)} (KST) · 실행 #{data.run.id}의 응답입니다. 위의 기간 비교와 현재 실행 현황은 유지됩니다.</p>
    <div className="grid min-w-0 items-start gap-3 md:grid-cols-2">{data.providers.map((provider) => <MonitoringModelResponseCard key={`${query}:${provider.id}`} provider={provider} query={query} requested={data.run.requestedSearchMode} rawAnswerCount={data.run.rawAnswerCount} />)}</div>
  </>;
}
export function MonitoringResponsePanel({ data, selectedRunId, onSelectRun }: { data: MonitoringData; selectedRunId: number; onSelectRun: (id: number) => void }) {
  const selected = data.selected!;
  const runs = selected.trends;
  const index = runs.findIndex((item) => item.id === selectedRunId);
  const params = new URLSearchParams({ projectId: String(data.project.id), question: selected.question.key, runId: String(selectedRunId), start: data.range.start, end: data.range.end, comparison: data.conditions.mode, limit: "1" });
  return <section aria-label="선택 실행의 AI 응답" className="mt-6 min-w-0 border-t border-[color:var(--app-card-border)] pt-6">
    <h3 className="text-lg font-semibold">선택 실행의 AI 응답</h3>
    <div className="mt-4 flex min-w-0 flex-wrap items-end gap-2"><Button variant="secondary" aria-label="이전 실행 응답" disabled={index <= 0} onClick={() => onSelectRun(runs[index - 1].id)}>←</Button><label className="min-w-0 flex-1 text-xs text-[color:var(--app-text-muted)]">측정 시점 (KST)<select aria-label="응답을 볼 측정 시점" value={selectedRunId} onChange={(event) => onSelectRun(Number(event.target.value))} className={`${fieldClass} mt-1`}>{runs.map((run) => <option key={run.id} value={run.id}>{runDate(run.at)} · #{run.id}{run.brands.own ? "" : " · 질문 미측정"}</option>)}</select></label><Button variant="secondary" aria-label="다음 실행 응답" disabled={index < 0 || index === runs.length - 1} onClick={() => onSelectRun(runs[index + 1].id)}>→</Button></div>
    <ResponseEvidence key={params.toString()} query={params.toString()} />
  </section>;
}
