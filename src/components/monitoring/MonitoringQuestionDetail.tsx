"use client";
import { useState } from "react";
import { ArrowLeft, ChevronDown, TrendingUp } from "lucide-react";
import { Badge, Card, EmptyState, Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { MonitoringData } from "@/lib/monitoring-types";
import { BrandTrendChart, brandColor, percent, rank, runDate } from "./MonitoringCharts";
import { Delta, Table } from "./MonitoringPresentation";
import { MonitoringResponsePanel } from "./MonitoringResponsePanel";

export function MonitoringQuestionDetail({ data, runQuery, onSelectRun, onReset }: { data: MonitoringData; runQuery: string | null; onSelectRun: (id: number | null) => void; onReset: () => void }) {
  const selected = data.selected!;
  const [showAll, setShowAll] = useState(false);
  const [visible, setVisible] = useState(() => selected.brands.slice(0, 6).map((brand) => brand.id));
  const current = selected.question.current;
  const latestMeasured = selected.trends.findLast((run) => run.brands.own !== null) ?? selected.trends.at(-1);
  const parsedRun = runQuery !== null && /^\d+$/.test(runQuery) && Number.isSafeInteger(Number(runQuery)) ? Number(runQuery) : null;
  const activeRun = runQuery === null ? latestMeasured : selected.trends.find((run) => run.id === parsedRun);
  const invalidRun = runQuery !== null && !activeRun;
  return <Card className="min-w-0 p-4 sm:p-6">
    <button type="button" onClick={onReset} className="mb-4 inline-flex min-h-10 items-center gap-2 text-sm text-[color:var(--app-text-muted)] hover:text-[color:var(--app-text)]"><ArrowLeft className="h-4 w-4" />전체 성과</button>
    <h2 className="break-words text-lg font-semibold leading-8">{selected.question.text}</h2>
    <div className="mb-5 mt-4 flex flex-wrap items-center gap-3"><Badge tone="good">{data.project.brandName}</Badge><span className="text-sm text-[color:var(--app-text-muted)]">기간의 기준 {percent(selected.question.baseline?.share)} → 현재</span><strong className="text-2xl">{percent(current?.share)}</strong><Delta value={selected.question.delta} /></div>
    {!selected.question.measuredRuns && <div className="mb-5"><EmptyState>아직 측정되지 않은 질문입니다. 응답 점유율에서 이 질문을 측정해 주세요.</EmptyState></div>}
    <details open><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">브랜드 언급 현황 펼치기 / 접기</summary>
    <h3 className="text-sm font-semibold">브랜드 언급 현황 <span className="font-normal text-[color:var(--app-text-muted)]">· 현재 실행</span></h3>
    <p className="mb-3 mt-2 text-xs text-[color:var(--app-text-muted)]">체크한 브랜드를 추이에 표시합니다. 자사는 항상 표시됩니다.</p>
    <Table label="질문별 브랜드 언급 현황"><thead><tr><th scope="col">추이 / 브랜드</th><th scope="col">언급률</th><th scope="col">모델</th><th scope="col">평균 순위</th></tr></thead><tbody>{(showAll ? selected.brands : selected.brands.slice(0, 10)).map((brand) => <tr key={brand.id} className={cn(brand.own && "bg-[color:var(--app-badge-bg)] font-semibold")}><td><label className="flex min-h-11 cursor-pointer items-center gap-2"><input type="checkbox" aria-label={`${brand.name} 추이 표시`} checked={visible.includes(brand.id)} disabled={brand.own} onChange={(event) => setVisible((ids) => event.target.checked ? [...ids, brand.id] : ids.filter((id) => id !== brand.id))} className="h-4 w-4 shrink-0 accent-[color:var(--app-chart-current)]" /><span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: brandColor(brand) }} /><span className="max-w-60 break-words">{brand.name}{brand.own && <span className="ml-2 text-xs text-[color:var(--app-text-muted)]">자사</span>}</span></label></td><td className="whitespace-nowrap font-semibold">{percent(brand.current?.share)}</td><td className="whitespace-nowrap">{brand.current?.providerCount == null ? "—" : `${brand.current.providerCount} / 4`}</td><td className="whitespace-nowrap">{rank(brand.current?.averageRank)}</td></tr>)}</tbody></Table>
    {selected.brands.length > 10 && <button type="button" className="min-h-11 text-sm text-[color:var(--app-text-muted)]" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>{showAll ? "접기" : `${selected.brands.length - 10}개 브랜드 더보기`} <ChevronDown className={cn("inline h-4 w-4", showAll && "rotate-180")} /></button>}
    </details>
    <h3 className="mb-2 mt-7 flex items-center gap-2 text-sm font-semibold"><TrendingUp className="h-4 w-4" />모니터링 추이</h3>
    <p className="mb-4 text-xs text-[color:var(--app-text-muted)]">각 완료 실행 시점의 언급률 · KST · 미측정 구간은 연결하지 않습니다. 자사 포인트를 선택하면 해당 시점의 응답을 확인합니다.</p>
    {selected.trends.length ? <BrandTrendChart selected={selected} visible={visible} selectedRunId={activeRun?.id ?? null} onSelectRun={onSelectRun} /> : <EmptyState>측정 후 브랜드별 추이를 확인할 수 있습니다.</EmptyState>}
    <div className="mt-3 flex flex-wrap gap-3 text-xs">{selected.brands.map((brand) => visible.includes(brand.id) && <span key={brand.id} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: brandColor(brand) }} />{brand.name}</span>)}</div>
    <details className="mt-5 text-sm"><summary className="cursor-pointer py-2 text-[color:var(--app-text-muted)]">실행별 데이터 보기</summary><Table label="선택 브랜드의 실행별 언급률"><thead><tr><th scope="col">측정 시점 (KST)</th>{selected.brands.filter((brand) => visible.includes(brand.id)).map((brand) => <th key={brand.id} scope="col">{brand.name}</th>)}<th scope="col">성공 / 실패 / 거절</th></tr></thead><tbody>{selected.trends.map((point) => <tr key={point.id}><td className="whitespace-nowrap"><button type="button" className="min-h-11 text-left underline underline-offset-4" onClick={() => onSelectRun(point.id)} aria-label={`${runDate(point.at)} 실행 ${point.id} 응답 보기`}>{runDate(point.at)} · #{point.id}</button></td>{selected.brands.filter((brand) => visible.includes(brand.id)).map((brand) => <td key={brand.id}>{percent(point.brands[brand.id]?.share)}</td>)}<td>{point.brands.own ? `${point.brands.own.succeeded} / ${point.brands.own.failed} / ${point.brands.own.refused}` : "—"}</td></tr>)}</tbody></Table></details>
    {invalidRun ? <div className="mt-6 rounded-xl border border-[color:var(--app-card-border)] p-4"><p role="alert" className="mb-3 text-sm">선택한 실행이 조회 기간 또는 비교 조건 밖에 있거나 존재하지 않습니다.</p><Button variant="secondary" onClick={() => onSelectRun(null)}>최근 실행 응답 보기</Button></div> : activeRun ? <>
      {runQuery === null && activeRun.id !== data.endpoints.current?.id && <p className="mt-5 text-xs text-[color:var(--app-text-muted)]">기간의 마지막 실행에는 이 질문이 없어 가장 최근에 측정된 실행의 응답을 표시합니다.</p>}
      <MonitoringResponsePanel data={data} selectedRunId={activeRun.id} onSelectRun={onSelectRun} />
    </> : <p className="mt-5 text-sm text-[color:var(--app-text-muted)]">선택한 기간에 응답을 확인할 완료 실행이 없습니다.</p>}
  </Card>;
}
