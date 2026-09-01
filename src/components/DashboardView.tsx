"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  BarChart3,
  CalendarCheck,
  CheckCircle2,
  ChevronRight,
  Circle,
  CircleDot,
  FileSearch,
  Gauge,
  ListFilter,
  SearchCheck,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DashboardData } from "@/lib/dashboard";
import { formatDate } from "@/lib/utils";

const modelMeta: Record<string, { label: string; short: string; color: string }> = {
  openai: { label: "ChatGPT", short: "GPT", color: "#21e6a5" },
  anthropic: { label: "Claude", short: "CLD", color: "#ff9d42" },
  gemini: { label: "Gemini", short: "GEM", color: "#9b8cff" },
  grok: { label: "Grok", short: "GRK", color: "#54d8ff" },
};

const stageDescriptions: Record<string, string> = {
  "존재": "AI가 브랜드를 인지할 수 있도록 엔티티와 공식 출처 기반을 먼저 확보하세요.",
  "맥락": "브랜드가 해결하는 문제와 추천 조건을 일관된 문맥으로 정렬하세요.",
  "시의성": "최신 수치·수정일·출처를 열린 웹에 갱신해 최신성을 강화하세요.",
  "추천": "구체적인 비교·구매 질문에서 선택될 증거와 긍정 문맥을 확대하세요.",
};

const chartTooltip = {
  background: "#0c0f12",
  border: "1px solid #2a3036",
  borderRadius: 10,
  color: "#e8edf2",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 11,
};

function Delta({ value, suffix = "%p" }: { value: number | null; suffix?: string }) {
  if (value === null) return <span className="text-[10px] text-zinc-400">비교 데이터 없음</span>;
  const positive = value >= 0;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-bold ${positive ? "text-emerald-400" : "text-rose-400"}`}>
      {positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {positive ? "+" : ""}{value.toFixed(1)}{suffix}
    </span>
  );
}

function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-[18px] border border-white/[0.08] bg-[#0b0e11] ${className}`}>{children}</section>;
}

function PanelHeader({ eyebrow, title, meta }: { eyebrow: string; title: string; meta?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 border-b border-white/[0.07] px-4 py-4 sm:px-5">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-emerald-400">{eyebrow}</p>
        <h2 className="mt-1 text-sm font-bold text-zinc-100 sm:text-base">{title}</h2>
      </div>
      {meta && <div className="text-[10px] text-zinc-400">{meta}</div>}
    </header>
  );
}

function MetricCell({ label, value, detail, icon: Icon, color = "text-zinc-100" }: {
  label: string;
  value: React.ReactNode;
  detail: React.ReactNode;
  icon: typeof Activity;
  color?: string;
}) {
  return (
    <div className="min-w-0 border-white/[0.07] p-4 sm:p-5 [&:not(:last-child)]:border-r">
      <div className="flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">
        <span>{label}</span><Icon className="h-3.5 w-3.5 text-zinc-400" />
      </div>
      <div className={`mt-3 truncate text-2xl font-semibold tracking-[-0.04em] sm:text-3xl ${color}`}>{value}</div>
      <div className="mt-2 min-h-4 text-[10px] text-zinc-400">{detail}</div>
    </div>
  );
}

function ProviderDot({ provider }: { provider: string }) {
  const meta = modelMeta[provider] ?? { color: "#8b949e", short: provider, label: provider };
  return <span className="inline-flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: meta.color }} />{meta.label}</span>;
}

function ShareBar({ value, color = "#21e6a5" }: { value: number; color?: string }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.05]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)}>
      <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(0, Math.min(100, value))}%`, backgroundColor: color }} />
    </div>
  );
}

export function DashboardView({ data }: { data: DashboardData }) {
  const [selectedQuestionText, setSelectedQuestionText] = useState<string | null>(null);
  const selectedQuestion = useMemo(
    () => data.questions.find((question) => question.text === selectedQuestionText) ?? null,
    [data.questions, selectedQuestionText],
  );
  const activeIndex = Math.max(0, data.funnel.stages.indexOf(data.funnel.stage));
  const hasRuns = data.recentRuns.length > 0;
  const runTrend = data.runTrends.length > 1
    ? data.runTrends
    : data.trends.map((item) => ({ ...item, label: item.month.slice(5), runId: 0 }));
  const radarData = data.models.map((model) => ({
    model: modelMeta[model.provider]?.short ?? model.provider,
    current: model.share,
    previous: model.previousShare ?? 0,
  }));
  const activeModels = data.models.filter((model) => model.total > 0 || (model.previousShare ?? 0) > 0);
  const bestModel = [...activeModels].sort((a, b) => b.share - a.share)[0] ?? null;
  const weakestModel = [...activeModels].sort((a, b) => a.share - b.share)[0] ?? null;
  const hasModelSpread = activeModels.length > 1 && bestModel !== null && weakestModel !== null && bestModel.share !== weakestModel.share;
  const previousShare = data.overview.answerShareDelta === null ? null : data.funnel.answerShare - data.overview.answerShareDelta;

  return (
    <div className="font-mono text-zinc-300">
      <section className="overflow-hidden rounded-[18px] border border-white/[0.08] bg-[#17191c] shadow-[0_24px_80px_rgba(0,0,0,0.28)]">
        <div className="flex flex-col gap-5 p-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.26em] text-cyan-300">
              <CircleDot className="h-3 w-3" /> GEO intelligence console
            </div>
            <h1 className="mt-2 truncate text-2xl font-semibold tracking-[-0.04em] text-white sm:text-3xl">{data.project.name}</h1>
            <p className="mt-1 text-[10px] text-zinc-400">브랜드: {data.project.brandName} · 카테고리: {data.project.category} · 최신 측정: {formatDate(data.funnel.measuredAt)}</p>
          </div>
          <div className="grid grid-cols-3 divide-x divide-white/[0.07] rounded-xl border border-white/[0.07] bg-black/20 px-2 py-3 text-center sm:min-w-[330px]">
            <div><strong className="block text-sm text-zinc-100">{data.project.questionCount}</strong><span className="text-[10px] uppercase tracking-wider text-zinc-400">questions</span></div>
            <div><strong className="block text-sm text-zinc-100">{data.project.modelCount}</strong><span className="text-[10px] uppercase tracking-wider text-zinc-400">models</span></div>
            <div><strong className="block text-sm text-zinc-100">{data.project.recentRunCount}</strong><span className="text-[10px] uppercase tracking-wider text-zinc-400">recent runs</span></div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/share" className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-zinc-100 px-3 py-2 text-[10px] font-bold text-zinc-950 transition hover:bg-white">새 측정 <ArrowRight className="h-3 w-3" /></Link>
            <Link href="/reports" className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[10px] font-bold text-zinc-300 transition hover:bg-white/[0.07]"><FileSearch className="h-3 w-3" />리포트</Link>
          </div>
        </div>
        <div className="grid grid-cols-2 border-t border-white/[0.07] lg:grid-cols-4">
          <MetricCell label="Answer share" icon={Activity} value={`${data.funnel.answerShare.toFixed(1)}%`} detail={<Delta value={data.overview.answerShareDelta} />} color="text-emerald-300" />
          <MetricCell label="GenRank" icon={Sparkles} value={data.funnel.genrank.toFixed(1)} detail={<Delta value={data.overview.genrankDelta} suffix="" />} color="text-cyan-300" />
          <MetricCell label="Funnel stage" icon={Gauge} value={data.funnel.stage} detail={`${activeIndex + 1} / ${data.funnel.stages.length} 단계`} color="text-amber-300" />
          <MetricCell label="Latest audit" icon={SearchCheck} value={data.latestAudit ? `${data.latestAudit.score}/${data.latestAudit.total}` : "—"} detail={data.latestAudit?.grade ?? "진단 이력 없음"} />
        </div>
      </section>

      <div className="mt-4 grid items-start gap-4 xl:grid-cols-[330px_minmax(0,1fr)]">
        <aside className="space-y-4 xl:sticky xl:top-6">
          <Panel className="overflow-hidden">
            <PanelHeader eyebrow="monitoring query set" title="모니터링 질문 목록" meta={`${data.questions.length}개 질문`} />
            <div className="max-h-[620px] space-y-2 overflow-y-auto p-3">
              <button type="button" onClick={() => setSelectedQuestionText(null)} aria-pressed={!selectedQuestion} className={`flex w-full items-center justify-between rounded-xl border p-3 text-left transition ${!selectedQuestion ? "border-emerald-400/30 bg-emerald-400/[0.08]" : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]"}`}>
                <span><strong className="block text-xs text-zinc-100">전체 대시보드</strong><small className="mt-1 block text-[10px] text-zinc-400">모든 질문 통합 성과</small></span>
                <ChevronRight className={`h-4 w-4 ${!selectedQuestion ? "text-emerald-400" : "text-zinc-400"}`} />
              </button>
              {data.questions.map((question, index) => {
                const selected = selectedQuestion?.text === question.text;
                return (
                  <button key={question.text} type="button" onClick={() => setSelectedQuestionText(question.text)} aria-pressed={selected} className={`w-full rounded-xl border p-3 text-left transition ${selected ? "border-cyan-400/30 bg-cyan-400/[0.07]" : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.04]"}`}>
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 text-[10px] font-bold text-zinc-400">Q{String(index + 1).padStart(2, "0")}</span>
                      <p className="line-clamp-2 flex-1 text-[11px] font-medium leading-5 text-zinc-200">{question.text}</p>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 border-t border-white/[0.05] pt-2 text-[10px]">
                      <div><span className="block text-zinc-400">점유율</span><strong className="mt-0.5 block text-emerald-400">{question.share}%</strong></div>
                      <div><span className="block text-zinc-400">변화</span><strong className={`mt-0.5 block ${(question.delta ?? 0) >= 0 ? "text-cyan-400" : "text-rose-400"}`}>{question.delta === null ? "—" : `${question.delta >= 0 ? "+" : ""}${question.delta}%p`}</strong></div>
                      <div><span className="block text-zinc-400">평균 순위</span><strong className="mt-0.5 block text-zinc-300">{question.averageRank ? `${question.averageRank}위` : "—"}</strong></div>
                    </div>
                  </button>
                );
              })}
              {!data.questions.length && <div className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center"><p className="text-[10px] leading-5 text-zinc-400">측정을 실행하면 질문별 GEO 성과가 이곳에 표시됩니다.</p><Link href="/share" className="mt-3 inline-flex items-center gap-1 text-[10px] font-bold text-emerald-400">첫 측정 시작 <ArrowRight className="h-3 w-3" /></Link></div>}
            </div>
          </Panel>

          <Panel className="p-4">
            <div className="flex items-center gap-2"><CalendarCheck className="h-4 w-4 text-amber-400" /><h2 className="text-[11px] font-bold text-zinc-200">4주 개선 사이클</h2></div>
            <div className="mt-3 space-y-2">{data.cycle.map((item) => <div key={item.week} className="flex items-center gap-2 text-[10px]">{item.done ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> : <Circle className="h-3.5 w-3.5 text-zinc-400" />}<span className={item.done ? "text-zinc-300" : "text-zinc-400"}>{item.label}</span></div>)}</div>
            <Link href="/strategy" className="mt-4 inline-flex items-center gap-1 text-[10px] font-bold text-cyan-400">사이클 관리 <ArrowRight className="h-3 w-3" /></Link>
          </Panel>
        </aside>

        <main className="min-w-0 space-y-4">
          {!selectedQuestion ? (
            <>
              <Panel className="overflow-hidden">
                <PanelHeader eyebrow="overview / visibility trend" title="전체 대시보드" meta={`최근 응답 ${data.overview.totalResponses}건`} />
                {!hasRuns ? <div className="grid min-h-72 place-items-center p-8 text-center"><div><BarChart3 className="mx-auto h-7 w-7 text-zinc-400" /><h3 className="mt-3 text-sm font-bold text-zinc-300">측정 데이터가 아직 없습니다</h3><p className="mt-2 max-w-sm text-[10px] leading-5 text-zinc-400">브랜드를 포함하지 않은 핵심 질문을 여러 AI 모델에 실행하면 점유율·순위·문맥을 한 화면에서 비교할 수 있습니다.</p><Link href="/share" className="mt-4 inline-flex items-center gap-2 rounded-lg bg-emerald-400 px-3 py-2 text-[10px] font-bold text-zinc-950">측정 시작 <ArrowRight className="h-3 w-3" /></Link></div></div> : <div className="p-4 sm:p-5">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-[11px] font-bold text-zinc-200">주차별 전체 언급률</h3><p className="mt-1 text-[10px] text-zinc-400">완료된 최근 실행 기준 · 0–100%</p></div><span className="rounded-md border border-emerald-400/20 bg-emerald-400/[0.06] px-2 py-1 text-[10px] text-emerald-400">LIVE DATA</span></div>
                  <div className="h-64 sm:h-72" role="img" aria-label="최근 실행별 전체 응답 점유율 추이"><ResponsiveContainer width="100%" height="100%"><AreaChart data={runTrend} margin={{ left: -20, right: 8, top: 12, bottom: 0 }}><defs><linearGradient id="shareArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#21e6a5" stopOpacity={0.35} /><stop offset="100%" stopColor="#21e6a5" stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke="#252a2f" strokeDasharray="2 5" vertical={false} /><XAxis dataKey="label" stroke="#a1a1aa" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} /><YAxis domain={[0, 100]} stroke="#a1a1aa" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(value) => `${value}%`} /><Tooltip contentStyle={chartTooltip} formatter={(value) => [`${Number(value).toFixed(1)}%`, "전체 점유율"]} /><Area type="monotone" dataKey="overall" stroke="#21e6a5" strokeWidth={2.5} fill="url(#shareArea)" dot={{ r: 2.5, fill: "#0b0e11", strokeWidth: 2 }} activeDot={{ r: 4 }} /></AreaChart></ResponsiveContainer></div>
                  <div className="mt-4 grid divide-y divide-white/[0.06] rounded-xl border border-white/[0.06] bg-black/20 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                    <div className="p-3"><span className="text-[10px] uppercase tracking-wider text-zinc-400">previous</span><strong className="mt-1 block text-lg text-zinc-400">{previousShare === null ? "—" : `${previousShare.toFixed(1)}%`}</strong></div>
                    <div className="p-3"><span className="text-[10px] uppercase tracking-wider text-zinc-400">current</span><strong className="mt-1 block text-lg text-zinc-100">{data.funnel.answerShare.toFixed(1)}%</strong></div>
                    <div className="p-3"><span className="text-[10px] uppercase tracking-wider text-zinc-400">change</span><div className="mt-1"><Delta value={data.overview.answerShareDelta} /></div></div>
                  </div>
                </div>}
              </Panel>

              <Panel className="overflow-hidden">
                <PanelHeader eyebrow="model comparison" title="AI 모델 언급률" meta="현재 vs 이전 측정" />
                <div className="grid lg:grid-cols-[0.9fr_1.1fr]">
                  <div className="min-h-72 border-b border-white/[0.07] p-3 lg:border-b-0 lg:border-r" role="img" aria-label="AI 모델별 현재와 이전 점유율 레이더 차트">
                    <ResponsiveContainer width="100%" height={280}><RadarChart data={radarData} outerRadius="68%"><PolarGrid stroke="#32383f" /><PolarAngleAxis dataKey="model" tick={{ fill: "#9ca3af", fontSize: 10 }} /><PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} /><Radar name="이전" dataKey="previous" stroke="#ff9d42" fill="#ff9d42" fillOpacity={0.08} strokeWidth={1.5} /><Radar name="현재" dataKey="current" stroke="#21e6a5" fill="#21e6a5" fillOpacity={0.16} strokeWidth={2} /><Legend iconType="circle" wrapperStyle={{ fontSize: 10, color: "#71717a" }} /></RadarChart></ResponsiveContainer>
                  </div>
                  <div className="overflow-x-auto p-4 sm:p-5" role="region" aria-label="AI 모델 점유율 비교 표" tabIndex={0}>
                    <table className="w-full min-w-[430px] text-left text-[10px]"><thead><tr className="border-b border-white/[0.07] text-[10px] uppercase tracking-[0.12em] text-zinc-400"><th className="pb-3 font-medium">모델</th><th className="pb-3 text-right font-medium">기존</th><th className="pb-3 text-right font-medium">현재</th><th className="pb-3 text-right font-medium">변화</th><th className="pb-3 text-right font-medium">언급</th></tr></thead><tbody>{data.models.map((model) => { return <tr key={model.provider} className="border-b border-white/[0.05] last:border-0"><td className="py-3 text-zinc-300"><ProviderDot provider={model.provider} /></td><td className="py-3 text-right text-zinc-400">{model.previousShare === null ? "—" : `${model.previousShare.toFixed(1)}%`}</td><td className="py-3 text-right font-bold text-zinc-200">{model.share.toFixed(1)}%</td><td className={`py-3 text-right font-bold ${(model.delta ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{model.delta === null ? "—" : `${model.delta >= 0 ? "+" : ""}${model.delta.toFixed(1)}%p`}</td><td className="py-3 text-right text-zinc-400">{model.mentions}/{model.total}</td></tr>; })}</tbody></table>
                    <div className="mt-5 grid gap-2 sm:grid-cols-2">
                      <div className="rounded-xl border border-emerald-400/15 bg-emerald-400/[0.05] p-3"><span className="text-[10px] uppercase tracking-wider text-emerald-500">best signal</span><p className="mt-1 text-[10px] text-zinc-300">{bestModel ? `${modelMeta[bestModel.provider]?.label} ${bestModel.share.toFixed(1)}%` : "측정 필요"}</p></div>
                      <div className="rounded-xl border border-amber-400/15 bg-amber-400/[0.05] p-3"><span className="text-[10px] uppercase tracking-wider text-amber-500">attention</span><p className="mt-1 text-[10px] text-zinc-300">{hasModelSpread && weakestModel ? `${modelMeta[weakestModel.provider]?.label} ${weakestModel.share.toFixed(1)}%` : activeModels.length < 2 ? "비교 모델이 더 필요합니다" : "모델 간 점유율이 동일합니다"}</p></div>
                    </div>
                  </div>
                </div>
              </Panel>

              <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                <Panel className="p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-400">funnel diagnosis</p><h2 className="mt-1 text-sm font-bold text-zinc-100">현재 단계 · {data.funnel.stage}</h2></div><Target className="h-5 w-5 text-cyan-400" /></div>
                  <p className="mt-3 text-[10px] leading-5 text-zinc-400">{stageDescriptions[data.funnel.stage] ?? "측정 결과를 확인해 현재 퍼널 단계를 다시 진단하세요."}</p>
                  <div className="mt-5 grid grid-cols-4 gap-1.5">{data.funnel.stages.map((stage, index) => <div key={stage} className={`rounded-lg border px-2 py-3 text-center ${index <= activeIndex ? "border-cyan-400/25 bg-cyan-400/[0.07]" : "border-white/[0.05] bg-black/20"}`}><span className={`block text-[10px] ${index <= activeIndex ? "text-cyan-400" : "text-zinc-400"}`}>0{index + 1}</span><strong className={`mt-1 block text-[10px] ${index <= activeIndex ? "text-zinc-200" : "text-zinc-400"}`}>{stage}</strong></div>)}</div>
                </Panel>
                <Panel className="p-4 sm:p-5">
                  <div className="flex items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-400">execution readiness</p><h2 className="mt-1 text-sm font-bold text-zinc-100">체크리스트 {data.checklist.completed}/{data.checklist.total}</h2></div><ListFilter className="h-5 w-5 text-amber-400" /></div>
                  <div className="mt-5"><div className="mb-2 flex justify-between text-[10px]"><span className="text-zinc-400">완료율</span><strong className="text-zinc-200">{data.checklist.percent}%</strong></div><ShareBar value={data.checklist.percent} color="#ffb84d" /></div>
                  <Link href="/learn" className="mt-5 inline-flex items-center gap-1 text-[10px] font-bold text-amber-400">실행 체크 계속 <ArrowRight className="h-3 w-3" /></Link>
                </Panel>
              </div>
            </>
          ) : (
            <QuestionDashboard question={selectedQuestion} />
          )}
        </main>
      </div>
    </div>
  );
}

function QuestionDashboard({ question }: { question: DashboardData["questions"][number] }) {
  const activeQuestionModels = question.models.filter((model) => model.total > 0);
  return (
    <>
      <Panel className="overflow-hidden">
        <PanelHeader eyebrow="selected query analysis" title="선택 질문 분석" meta={`${question.total}회 응답`} />
        <div className="p-4 sm:p-5">
          <p className="max-w-4xl text-sm font-semibold leading-6 text-zinc-100 sm:text-base">{question.text}</p>
          <div className="mt-5 grid grid-cols-2 divide-x divide-y divide-white/[0.06] overflow-hidden rounded-xl border border-white/[0.06] bg-black/20 sm:grid-cols-4 sm:divide-y-0">
            <div className="p-3"><span className="text-[10px] uppercase text-zinc-400">점유율</span><strong className="mt-1 block text-xl text-emerald-300">{question.share}%</strong></div>
            <div className="p-3"><span className="text-[10px] uppercase text-zinc-400">이전 대비</span><div className="mt-2"><Delta value={question.delta} /></div></div>
            <div className="p-3"><span className="text-[10px] uppercase text-zinc-400">평균 순위</span><strong className="mt-1 block text-xl text-cyan-300">{question.averageRank ? `${question.averageRank}위` : "—"}</strong></div>
            <div className="p-3"><span className="text-[10px] uppercase text-zinc-400">긍정 문맥</span><strong className="mt-1 block text-xl text-amber-300">{question.positiveRate}%</strong></div>
          </div>
        </div>
      </Panel>

      <Panel className="overflow-hidden">
        <PanelHeader eyebrow="provider signal" title="모델별 질문 성과" meta="언급률 · 평균 순위" />
        <div className="divide-y divide-white/[0.06]">{activeQuestionModels.map((model) => { const meta = modelMeta[model.provider]; return <div key={model.provider} className="grid gap-3 p-4 sm:grid-cols-[150px_minmax(0,1fr)_64px_64px] sm:items-center sm:px-5"><div className="text-[10px] text-zinc-300"><ProviderDot provider={model.provider} /></div><ShareBar value={model.share} color={meta?.color} /><div className="text-right text-[10px] font-bold text-zinc-200">{model.share}%</div><div className="text-right text-[10px] text-zinc-400">{model.averageRank ? `${model.averageRank}위` : "순위 —"}</div></div>; })}{!activeQuestionModels.length && <div className="p-8 text-center text-[10px] text-zinc-400">이 질문의 모델별 결과가 없습니다.</div>}</div>
      </Panel>

      <Panel className="overflow-hidden">
        <PanelHeader eyebrow="query visibility trend" title="질문별 모델 추이" meta={`${question.trends.length}개 측정 시점`} />
        {question.trends.length ? <div className="p-3 sm:p-5"><div className="h-80" role="img" aria-label="선택 질문의 최근 12회 모델별 점유율 추이"><ResponsiveContainer width="100%" height="100%"><LineChart data={question.trends} margin={{ left: -18, right: 10, top: 15, bottom: 4 }}><CartesianGrid stroke="#2b3036" strokeDasharray="2 4" /><XAxis dataKey="label" stroke="#a1a1aa" tick={{ fontSize: 10 }} tickLine={false} /><YAxis domain={[0, 100]} stroke="#a1a1aa" tick={{ fontSize: 10 }} tickFormatter={(value) => `${value}%`} /><Tooltip contentStyle={chartTooltip} formatter={(value, name) => [`${Number(value).toFixed(1)}%`, modelMeta[String(name)]?.label ?? name]} /><Legend iconType="circle" wrapperStyle={{ fontSize: 10 }} formatter={(value) => modelMeta[String(value)]?.label ?? value} /><Line type="monotone" dataKey="overall" name="전체" stroke="#f4f4f5" strokeWidth={2.5} dot={{ r: 3 }} connectNulls />{Object.entries(modelMeta).map(([provider, meta]) => <Line key={provider} type="monotone" dataKey={provider} name={provider} stroke={meta.color} strokeWidth={1.5} dot={{ r: 2 }} connectNulls />)}</LineChart></ResponsiveContainer></div></div> : <div className="grid min-h-64 place-items-center p-8 text-center"><div><Activity className="mx-auto h-6 w-6 text-zinc-400" /><p className="mt-3 text-[10px] text-zinc-400">반복 측정하면 이 질문의 모델별 변화가 표시됩니다.</p></div></div>}
      </Panel>
    </>
  );
}
