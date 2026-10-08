"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Download, RefreshCw, Settings2, Target } from "lucide-react";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui";
import type { MonitoringData, MonitoringQuestion } from "@/lib/monitoring-types";
import { ProviderRadar, WeeklyChart, percent, runDate } from "./MonitoringCharts";
import { Comparison, Delta, Table } from "./MonitoringPresentation";
import { MonitoringQuestionDetail } from "./MonitoringQuestionDetail";
import { MonitoringQuestionList } from "./MonitoringQuestionList";
import { MonitoringConditions } from "./MonitoringConditions";
import { fieldClass, MonitoringQuestionEditor } from "./MonitoringQuestionEditor";

function RangeForm({ range, onApply }: { range: MonitoringData["range"]; onApply: (start: string, end: string) => void }) {
  const [start, setStart] = useState(range.start);
  const [end, setEnd] = useState(range.end);
  const [error, setError] = useState("");
  function apply(event: FormEvent) {
    event.preventDefault();
    const days = (Date.parse(end) - Date.parse(start)) / 86_400_000 + 1;
    if (!Number.isFinite(days) || days < 1 || days > 366) { setError("시작일부터 최대 366일까지 선택해 주세요."); return; }
    setError(""); onApply(start, end);
  }
  return <form onSubmit={apply} className="flex w-full flex-wrap items-end gap-2 sm:w-auto">
    <label className="w-full min-w-0 text-xs text-[color:var(--app-text-muted)] sm:w-auto">시작일<input aria-label="조회 시작일" type="date" required value={start} onChange={(event) => setStart(event.target.value)} className={`${fieldClass} mt-1 sm:w-40`} /></label>
    <label className="w-full min-w-0 text-xs text-[color:var(--app-text-muted)] sm:w-auto">종료일<input aria-label="조회 종료일" type="date" required min={start} value={end} onChange={(event) => setEnd(event.target.value)} className={`${fieldClass} mt-1 sm:w-40`} /></label>
    <Button type="submit" variant="secondary">기간 적용</Button>
    {error && <p className="w-full text-xs text-[color:var(--app-status-danger)]" role="alert">{error}</p>}
  </form>;
}

function Overall({ data }: { data: MonitoringData }) {
  const total = data.overview.period;
  return <Card className="min-w-0 p-4 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">전체 성과</h2><Badge>{data.questions.length}개 질문 · 완료 {data.runCount}회</Badge></div>
    <h3 className="mb-3 mt-6 text-sm font-semibold">주별 전체 언급률</h3>
    {total.succeeded ? <WeeklyChart data={data} /> : <EmptyState>선택한 기간에 집계할 성공 응답이 없습니다.</EmptyState>}
    <Comparison value={data.overview} data={data} />
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[color:var(--app-text-muted)]"><span>기간 내 성공 {total.succeeded.toLocaleString()}건</span><span>실패 {total.failed.toLocaleString()}건</span><span>거절 {total.refused.toLocaleString()}건</span></div>
    <h3 className="mt-7 text-sm font-semibold">AI 모델별 언급률</h3>
    <div className="mt-3 grid min-w-0 items-center gap-3 2xl:grid-cols-[minmax(240px,0.9fr)_minmax(0,1.1fr)]">
      <ProviderRadar data={data} />
      <Table label="AI 모델별 기준과 현재 언급률"><thead><tr><th scope="col">모델</th><th scope="col">기준</th><th scope="col">현재</th><th scope="col">변화</th></tr></thead><tbody>{data.providers.map((model) => <tr key={model.id}><td className="font-medium">{model.name}</td><td className="text-[color:var(--app-text-muted)]">{percent(model.baseline?.share)}</td><td className="font-semibold">{percent(model.current?.share)}</td><td><Delta value={model.delta} /></td></tr>)}</tbody></Table>
    </div>
    <details className="mt-6 text-sm"><summary className="cursor-pointer py-2 text-[color:var(--app-text-muted)]">주별 데이터 보기</summary><Table label="주별 언급률 데이터"><thead><tr><th scope="col">주 시작일</th><th scope="col">언급률</th><th scope="col">언급 / 성공</th><th scope="col">완료 실행</th></tr></thead><tbody>{data.weeks.map((point) => <tr key={point.week}><td>{point.week}</td><td>{percent(point.metric.share)}</td><td>{point.metric.mentions} / {point.metric.succeeded}</td><td>{point.runs}회</td></tr>)}</tbody></Table></details>
  </Card>;
}

export function MonitoringClient({ projectId, canConfigure }: { projectId: number; canConfigure: boolean }) {
  const search = useSearchParams();
  const start = search.get("start"), end = search.get("end"), question = search.get("question"), runQuery = search.get("run"), comparison = search.get("comparison");
  const params = new URLSearchParams({ projectId: String(projectId) });
  if (start) params.set("start", start);
  if (end) params.set("end", end);
  if (question) params.set("question", question);
  if (comparison) params.set("comparison", comparison);
  const query = params.toString();
  const [version, setVersion] = useState(0);
  const requestKey = `${query}:${version}`;
  const [result, setResult] = useState<{ key: string; data?: MonitoringData; error?: string }>({ key: "" });
  const [editor, setEditor] = useState<MonitoringQuestion | "new" | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const exportRequest = useRef<AbortController | null>(null);
  const loading = result.key !== requestKey;
  const data = !loading ? result.data : undefined;

  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    fetch(`/api/monitoring?${query}`, { signal: controller.signal, cache: "no-store" })
        .then(async (response) => {
          const body = await response.json();
          if (!response.ok) throw new Error(body.error ?? "모니터링 결과를 불러오지 못했습니다.");
          if (body.project.id !== projectId) throw new Error("프로젝트가 변경되었습니다. 다시 불러와 주세요.");
          if (live) setResult({ key: requestKey, data: body });
        })
        .catch((failure) => { if (live) setResult({ key: requestKey, error: failure instanceof Error ? failure.message : "조회 중 오류가 발생했습니다." }); });
    return () => { live = false; controller.abort(); exportRequest.current?.abort(); };
  }, [query, requestKey, projectId]);
  useEffect(() => {
    function changed() { setVersion((value) => value + 1); setEditor(null); setNotice(""); exportRequest.current?.abort(); }
    window.addEventListener("geo-master:project-changed", changed);
    return () => window.removeEventListener("geo-master:project-changed", changed);
  }, []);

  function navigate(updates: Record<string, string | null>, replace = false) {
    const next = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(updates)) { if (value) next.set(key, value); else next.delete(key); }
    next.delete("projectId"); next.delete("format");
    window.history[replace ? "replaceState" : "pushState"](null, "", `/monitoring${next.size ? `?${next}` : ""}`);
    setListOpen(false); setExportError("");
  }
  async function exportCsv() {
    if (exporting || !data) return;
    setExporting(true); setExportError("");
    const controller = new AbortController();
    exportRequest.current = controller;
    try {
      const exportParams = new URLSearchParams(query);
      exportParams.set("start", data.range.start); exportParams.set("end", data.range.end); exportParams.set("format", "csv");
      const response = await fetch(`/api/monitoring?${exportParams}`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) { const body = await response.json(); throw new Error(body.error ?? "내보내기에 실패했습니다."); }
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a"); link.href = url; link.download = `monitoring-${data.project.id}-${data.range.start}-${data.range.end}.csv`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) { if (!controller.signal.aborted) setExportError(failure instanceof Error ? failure.message : "내보내기에 실패했습니다."); }
    finally { setExporting(false); }
  }

  return <div className="min-w-0 text-[color:var(--app-text)]">
    <PageHeader eyebrow="AI Visibility" title="AI 언급 모니터링" description="질문에서 시작해 브랜드의 변화를 확인하세요. ChatGPT · Claude · Gemini · Grok" action={<Link href="/share" className="inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-[color:var(--app-card-border)] px-4 py-3 text-sm font-medium"><Target className="h-4 w-4" />측정하러 가기</Link>} />
    {loading ? <Card role="status" aria-live="polite" className="py-16 text-center"><RefreshCw className="mx-auto mb-3 h-5 w-5 animate-spin" />저장된 응답을 집계하고 있습니다.</Card> : result.error ? <Card><p role="alert" className="mb-4 text-[color:var(--app-status-danger)]">{result.error}</p><div className="flex flex-wrap gap-3"><Button onClick={() => setVersion((value) => value + 1)}>다시 시도</Button><Button variant="secondary" onClick={() => navigate({ start: null, end: null, question: null, run: null, comparison: null })}>최근 12주로 돌아가기</Button></div></Card> : data && <>
      <Card className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div><h2 className="text-lg font-semibold">{data.project.name}</h2><p className="mt-1 text-xs leading-6 text-[color:var(--app-text-muted)]">{data.project.brandName} · 질문 {data.questions.length}개 · {data.range.start} ~ {data.range.end}</p><p className="text-xs text-[color:var(--app-text-muted)]">완료 실행 기준 · 월별 측정 횟수</p></div>
          <div className="flex max-w-full gap-5 overflow-x-auto pb-1">{data.monthlyRuns.map((month) => <div key={month.month} className="shrink-0 text-center"><strong className="text-base tabular-nums">{month.count}</strong><p className="mt-1 text-xs text-[color:var(--app-text-muted)]">{month.month}</p></div>)}</div>
          <div className="flex flex-wrap items-center gap-2"><Button type="button" variant="secondary" onClick={exportCsv} disabled={exporting || data.selectionMissing}><Download className="h-4 w-4" />{exporting ? "내보내는 중…" : "기간 CSV 내보내기"}</Button>{canConfigure && <Link href="/settings" className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-[color:var(--app-text-muted)]"><Settings2 className="h-4 w-4" />프로젝트 설정</Link>}</div>
        </div>
        <div className="mt-5 flex flex-wrap items-end justify-between gap-4 border-t border-[color:var(--app-card-border)] pt-4"><RangeForm key={`${data.range.start}:${data.range.end}`} range={data.range} onApply={(first, last) => navigate({ start: first, end: last })} /><button type="button" className="min-h-11 text-sm text-[color:var(--app-text-muted)]" onClick={() => navigate({ start: null, end: null })}>최근 12주</button></div>
        {exportError && <p role="alert" className="mt-3 text-sm text-[color:var(--app-status-danger)]">{exportError}</p>}
      </Card>
      <MonitoringConditions conditions={data.conditions} onChange={(value) => navigate({ comparison: value, run: null })} />
      {notice && <p role="status" className="mb-4 text-sm text-[color:var(--app-status-good)]">{notice}</p>}
      <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(280px,0.42fr)_minmax(0,1fr)]">
        <MonitoringQuestionList key={projectId} questions={data.questions} selected={question} open={listOpen} onToggle={() => setListOpen(!listOpen)} onSelect={(key) => navigate({ question: key, run: null })} onAdd={() => setEditor("new")} onEdit={setEditor} />
        <section aria-label="모니터링 성과" className="min-w-0">{data.selectionMissing ? <Card><EmptyState>이 기간 또는 프로젝트에서 선택한 질문을 찾을 수 없습니다.</EmptyState><Button variant="secondary" className="mt-4" onClick={() => navigate({ question: null, run: null })}>전체 성과 보기</Button></Card> : data.selected ? <MonitoringQuestionDetail key={`${requestKey}:${data.selected.question.key}`} data={data} runQuery={runQuery} onSelectRun={(id) => navigate({ run: id === null ? null : String(id) }, true)} onReset={() => navigate({ question: null, run: null })} /> : <Overall data={data} />}</section>
      </div>
      <div className="mt-6 space-y-2 text-xs leading-6 text-[color:var(--app-text-muted)]">
        <p>현재 브랜드 설정 기준 재집계 · 기준 {runDate(data.endpoints.baseline?.at)} → 현재 {runDate(data.endpoints.current?.at)} (KST)</p>
        <p>언급률 = 브랜드를 언급한 성공 응답 ÷ 전체 성공 응답. 실패·거절은 제외합니다. 주별 수치는 응답 수로 가중 집계하며 월요일부터 시작합니다.</p>
        <p>평균 순위는 응답 안에서 등록 브랜드가 처음 등장한 순서입니다. 검색 순위가 아닙니다. —는 미측정 또는 비교할 데이터가 없음을 뜻합니다. 기간 내 첫 실행과 마지막 실행의 질문·모델 구성이 다를 수 있습니다.</p>
      </div>
      {editor && <MonitoringQuestionEditor data={data} question={editor === "new" ? undefined : editor} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); setVersion((value) => value + 1); setNotice("질문을 저장했습니다. 새 문장의 결과는 다음 측정부터 표시됩니다."); }} />}
    </>}
  </div>;
}
