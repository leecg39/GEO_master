"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
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
  Radio,
  SearchCheck,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Minus,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
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
  openai: { label: "ChatGPT", short: "GPT", color: "#27e3a2" },
  anthropic: { label: "Claude", short: "CLD", color: "#ff9d52" },
  gemini: { label: "Gemini", short: "GEM", color: "#a78bfa" },
  grok: { label: "Grok", short: "GRK", color: "#4dc8ff" },
};

const stageDescriptions: Record<string, string> = {
  "존재": "AI가 브랜드를 인지할 수 있도록 엔티티와 공식 출처 기반을 먼저 확보하세요.",
  "맥락": "브랜드가 해결하는 문제와 추천 조건을 일관된 문맥으로 정렬하세요.",
  "시의성": "최신 수치·수정일·출처를 열린 웹에 갱신해 최신성을 강화하세요.",
  "추천": "구체적인 비교·구매 질문에서 선택될 증거와 긍정 문맥을 확대하세요.",
};

const chartTooltip = {
  background: "#07142f",
  border: "1px solid rgba(125, 164, 255, 0.28)",
  borderRadius: 8,
  color: "#e6efff",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 11,
  boxShadow: "0 16px 40px rgba(0, 0, 0, 0.4)",
};

function clamp(value: number) {
  return Math.max(0, Math.min(100, value));
}

function Delta({ value, suffix = "%p" }: { value: number | null; suffix?: string }) {
  if (value === null) {
    return <span className="text-[11px] text-slate-500">비교 데이터 없음</span>;
  }
  if (value === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-bold text-slate-500">
        <Minus className="h-3.5 w-3.5" />
        0.0{suffix}
      </span>
    );
  }
  const positive = value > 0;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-bold ${positive ? "text-emerald-400" : "text-rose-400"}`}>
      {positive ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
      {positive ? "+" : ""}{value.toFixed(1)}{suffix}
    </span>
  );
}

function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`overflow-hidden rounded-xl border border-[#45629a]/45 bg-[#09142d]/90 shadow-[0_16px_48px_rgba(0,5,20,0.28)] ${className}`}>
      {children}
    </section>
  );
}

function PanelHeader({
  title,
  icon: Icon,
  meta,
}: {
  title: string;
  icon?: LucideIcon;
  meta?: ReactNode;
}) {
  return (
    <header className="flex min-h-12 items-center justify-between gap-3 border-b border-[#45629a]/35 px-4 py-3">
      <div className="flex min-w-0 items-center gap-2">
        {Icon && <Icon className="h-4 w-4 shrink-0 text-cyan-300" />}
        <h2 className="truncate text-sm font-bold tracking-tight text-slate-100">{title}</h2>
      </div>
      {meta && <div className="shrink-0 text-[10px] font-medium text-slate-400 sm:text-xs">{meta}</div>}
    </header>
  );
}

function SplitPanelHeader({
  left,
  right,
}: {
  left: { title: string; icon?: LucideIcon; meta?: ReactNode };
  right: { title: string; icon?: LucideIcon; meta?: ReactNode };
}) {
  const renderSide = (side: { title: string; icon?: LucideIcon; meta?: ReactNode }) => {
    const SideIcon = side.icon;
    return (
      <>
        <div className="flex min-w-0 items-center gap-2">
          {SideIcon && <SideIcon className="h-4 w-4 shrink-0 text-cyan-300" />}
          <h2 className="truncate text-sm font-bold tracking-tight text-slate-100">{side.title}</h2>
        </div>
        {side.meta && <div className="shrink-0 text-[10px] font-medium text-slate-400 sm:text-xs">{side.meta}</div>}
      </>
    );
  };

  return (
    <header className="grid min-h-12 grid-cols-2 border-b border-[#45629a]/35">
      <div className="flex items-center justify-between gap-3 border-r border-[#45629a]/35 px-4 py-3">
        {renderSide(left)}
      </div>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        {renderSide(right)}
      </div>
    </header>
  );
}

function HalfGauge({
  value,
  available,
  color = "#27e3a2",
  label,
  detail,
}: {
  value: number;
  available: boolean;
  color?: string;
  label: string;
  detail: ReactNode;
}) {
  const safeValue = clamp(value);
  const gaugeData = [
    { name: "value", value: safeValue },
    { name: "remaining", value: 100 - safeValue },
  ];

  return (
    <div className="px-4 pb-4 pt-2">
      <div className="relative h-36" role="img" aria-label={`${label} ${available ? `${safeValue.toFixed(1)}%` : "데이터 없음"}`}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={gaugeData}
              dataKey="value"
              cx="50%"
              cy="82%"
              startAngle={180}
              endAngle={0}
              innerRadius="61%"
              outerRadius="84%"
              stroke="none"
              isAnimationActive={available}
            >
              <Cell fill={available ? color : "#26344f"} />
              <Cell fill="#1b2945" />
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-x-0 bottom-0 text-center">
          <strong className="block text-3xl font-black tracking-[-0.06em] text-white">
            {available ? safeValue.toFixed(1) : "—"}
            {available && <span className="ml-0.5 text-xs font-bold text-slate-400">%</span>}
          </strong>
          <span className="mt-0.5 block text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">{label}</span>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-[#45629a]/25 pt-3 text-xs">
        <span className="text-slate-500">이전 측정 대비</span>
        {detail}
      </div>
    </div>
  );
}

function DonutMetric({
  value,
  available,
  label,
  color,
  footnote,
}: {
  value: number;
  available: boolean;
  label: string;
  color: string;
  footnote: ReactNode;
}) {
  const safeValue = clamp(value);
  const chartData = [
    { name: "value", value: safeValue },
    { name: "remaining", value: 100 - safeValue },
  ];

  return (
    <div className="grid grid-cols-[128px_minmax(0,1fr)] items-center gap-2 px-4 py-4">
      <div className="relative h-32" role="img" aria-label={`${label} ${available ? `${safeValue.toFixed(1)}%` : "데이터 없음"}`}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={chartData} dataKey="value" innerRadius={42} outerRadius={57} stroke="none">
              <Cell fill={available ? color : "#26344f"} />
              <Cell fill="#1b2945" />
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 grid place-items-center text-center">
          <strong className="text-xl font-black tracking-tight text-white">{available ? `${safeValue.toFixed(0)}%` : "—"}</strong>
        </div>
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">{label}</p>
        <div className="mt-2 text-xs leading-5 text-slate-300">{footnote}</div>
      </div>
    </div>
  );
}

function BigMetric({
  label,
  value,
  suffix,
  detail,
  color = "text-amber-300",
}: {
  label: string;
  value: string;
  suffix?: string;
  detail: ReactNode;
  color?: string;
}) {
  return (
    <div className="flex min-h-44 flex-col justify-center px-5 py-4 text-center">
      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">{label}</p>
      <strong className={`mt-4 text-5xl font-black tracking-[-0.07em] ${color}`}>
        {value}
        {suffix && <span className="ml-1 text-xs tracking-normal text-slate-400">{suffix}</span>}
      </strong>
      <div className="mt-4 text-xs text-slate-400">{detail}</div>
    </div>
  );
}

function EmptyData({
  title,
  description,
  compact = false,
}: {
  title: string;
  description: string;
  compact?: boolean;
}) {
  return (
    <div className={`grid place-items-center px-6 text-center ${compact ? "min-h-48 py-6" : "min-h-72 py-10"}`}>
      <div>
        <BarChart3 className="mx-auto h-7 w-7 text-slate-600" />
        <h3 className="mt-3 text-sm font-bold text-slate-300">{title}</h3>
        <p className="mx-auto mt-2 max-w-sm text-xs leading-5 text-slate-500">{description}</p>
        <Link href="/share" className="mt-4 inline-flex items-center gap-1.5 text-xs font-bold text-cyan-300">
          측정 시작 <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}

function ProviderDot({ provider, size = "md" }: { provider: string; size?: "md" | "lg" }) {
  const meta = modelMeta[provider] ?? { color: "#8b949e", short: provider, label: provider };
  const diamondClass = size === "lg" ? "h-3.5 w-3.5" : "h-3 w-3";
  return (
    <span className="inline-flex items-center gap-2 text-xs font-medium text-slate-300">
      <span className={`${diamondClass} rotate-45`} style={{ backgroundColor: meta.color }} aria-hidden="true" />
      {meta.label}
    </span>
  );
}

function ShareBar({ value, color = "#27e3a2" }: { value: number; color?: string }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-[#1b2945]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)}>
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${clamp(value)}%`, backgroundColor: color }} />
    </div>
  );
}

function RadarModelDot({
  cx,
  cy,
  index,
  models,
  faded = false,
}: {
  cx?: number;
  cy?: number;
  index?: number;
  models: DashboardData["models"];
  faded?: boolean;
}) {
  if (cx == null || cy == null || index == null) return null;
  const model = models[index];
  if (!model) return null;
  const color = modelMeta[model.provider]?.color ?? "#8b949e";

  return (
    <circle
      cx={cx}
      cy={cy}
      r={faded ? 3 : 4}
      fill={color}
      stroke="#07142f"
      strokeWidth={1.5}
      opacity={faded ? 0.55 : 1}
    />
  );
}

function RadarModelAxisTick({
  x,
  y,
  payload,
  models,
}: {
  x?: string | number;
  y?: string | number;
  payload?: { value?: string };
  models: DashboardData["models"];
}) {
  const tickX = typeof x === "number" ? x : Number(x);
  const tickY = typeof y === "number" ? y : Number(y);
  if (!Number.isFinite(tickX) || !Number.isFinite(tickY) || !payload?.value) return null;

  const model = models.find((item) => (modelMeta[item.provider]?.label ?? item.provider) === payload.value);
  const color = model ? modelMeta[model.provider]?.color ?? "#cbd5e1" : "#cbd5e1";

  return (
    <text
      x={tickX}
      y={tickY}
      textAnchor="middle"
      dominantBaseline="central"
      fill={color}
      fontSize={11}
      fontWeight={700}
    >
      {payload.value}
    </text>
  );
}

function ModelComparisonSection({
  models,
  compact = false,
}: {
  models: DashboardData["models"];
  compact?: boolean;
}) {
  const sortedModels = [...models].sort((left, right) => right.share - left.share);
  const radarData = sortedModels.map((model) => ({
    model: modelMeta[model.provider]?.label ?? model.provider,
    current: model.share,
    previous: model.previousShare ?? 0,
  }));
  const radarMax = Math.max(
    100,
    ...sortedModels.flatMap((model) => [model.share, model.previousShare ?? 0]),
  );
  const radarCeil = Math.min(100, Math.ceil(radarMax / 10) * 10);
  const chartHeight = compact ? 400 : 440;

  return (
    <div
      className="flex h-full min-h-[500px] flex-col bg-[#070f22]/70"
      role="region"
      aria-label="AI 모델 점유율 비교 — 레이더 차트와 표"
    >
      <div className="grid flex-1 lg:grid-cols-2 lg:items-stretch">
        <div className="flex flex-col border-b border-[#45629a]/30 lg:border-b-0 lg:border-r">
          <div
            className="flex flex-1 items-center px-2 pt-3 sm:px-4"
            role="img"
            aria-label="AI 모델별 현재와 이전 점유율 레이더 차트"
          >
            <ResponsiveContainer width="100%" height={chartHeight}>
              <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="78%">
                <PolarGrid stroke="#2a3548" strokeDasharray="3 3" />
                <PolarAngleAxis
                  dataKey="model"
                  tick={(props) => <RadarModelAxisTick {...props} models={sortedModels} />}
                  tickLine={false}
                />
                <PolarRadiusAxis domain={[0, radarCeil]} tick={false} axisLine={false} />
                <Radar
                  name="기존"
                  dataKey="previous"
                  stroke="#ff9d52"
                  fill="#ff9d52"
                  fillOpacity={0.1}
                  strokeWidth={2}
                  dot={(props) => <RadarModelDot {...props} models={sortedModels} faded />}
                />
                <Radar
                  name="현재"
                  dataKey="current"
                  stroke="#27e3a2"
                  fill="#27e3a2"
                  fillOpacity={0.16}
                  strokeWidth={2.5}
                  dot={(props) => <RadarModelDot {...props} models={sortedModels} />}
                />
                <Tooltip
                  contentStyle={chartTooltip}
                  formatter={(value, name) => [`${Number(value).toFixed(1)}%`, name === "current" ? "현재" : "기존"]}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-auto flex items-center justify-center gap-8 border-t border-[#45629a]/25 px-4 py-3 text-xs text-slate-400">
            <span className="inline-flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-[#ff9d52]" aria-hidden="true" />
              기존
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-[#27e3a2]" aria-hidden="true" />
              현재
            </span>
          </div>
        </div>

        <div
          className="flex flex-col justify-center overflow-x-auto px-4 py-4 outline-none focus-visible:bg-white/[0.02] sm:px-6 sm:py-5"
          aria-label="AI 모델 점유율 비교 표"
          tabIndex={0}
        >
          <table className="w-full min-w-[300px] text-left text-xs sm:text-sm">
            <thead>
              <tr className="border-b border-[#45629a]/35 text-[10px] uppercase tracking-[0.16em] text-slate-500">
                <th className="pb-3 font-semibold">모델</th>
                <th className="pb-3 text-right font-semibold">기존</th>
                <th className="pb-3 text-right font-semibold">현재</th>
                <th className="pb-3 text-right font-semibold">변화</th>
              </tr>
            </thead>
            <tbody>
              {sortedModels.map((model) => (
                <tr
                  key={model.provider}
                  className="border-b border-[#45629a]/15 transition hover:bg-white/[0.02] last:border-0"
                >
                  <td className="py-3.5 text-slate-200">
                    <ProviderDot provider={model.provider} />
                  </td>
                  <td className="py-3.5 text-right tabular-nums text-slate-400">
                    {model.previousShare === null ? "—" : `${model.previousShare.toFixed(1)}%`}
                  </td>
                  <td
                    className="py-3.5 text-right font-bold tabular-nums"
                    style={{ color: modelMeta[model.provider]?.color ?? "#f8fafc" }}
                  >
                    {model.share.toFixed(1)}%
                  </td>
                  <td className="py-3.5 text-right">
                    <Delta value={model.delta} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function DashboardView({ data }: { data: DashboardData }) {
  const [selectedQuestionText, setSelectedQuestionText] = useState<string | null>(null);
  const selectedQuestion = useMemo(
    () => data.questions.find((question) => question.text === selectedQuestionText) ?? null,
    [data.questions, selectedQuestionText],
  );

  const hasRuns = data.recentRuns.length > 0;
  const hasModelData = data.models.some((model) => model.total > 0);
  const activeIndex = Math.max(0, data.funnel.stages.indexOf(data.funnel.stage));
  const runTrend = data.runTrends.length > 0
    ? data.runTrends
    : data.trends.map((item) => ({ ...item, label: item.month.slice(5), runId: 0 }));
  const previousShare = data.overview.answerShareDelta === null
    ? null
    : Number((data.funnel.answerShare - data.overview.answerShareDelta).toFixed(1));
  const trendValues = runTrend.map((item) => item.overall);
  const trendMin = trendValues.length
    ? Math.max(0, Math.floor(Math.min(...trendValues) / 5) * 5 - 2)
    : 0;
  const trendMax = trendValues.length
    ? Math.min(100, Math.ceil(Math.max(...trendValues) / 5) * 5 + 2)
    : 100;
  const competitorData = hasRuns
    ? [
        { name: data.project.brandName, value: data.funnel.answerShare, color: "#27e3a2" },
        ...data.overview.competitors.map((item, index) => ({
          name: item.name,
          value: item.share,
          color: ["#4dc8ff", "#a78bfa", "#ff9d52", "#fb7185"][index] ?? "#64748b",
        })),
      ].filter((item) => item.value > 0)
    : [];
  const auditPercent = data.latestAudit
    ? clamp((data.latestAudit.score / Math.max(1, data.latestAudit.total)) * 100)
    : 0;
  const cycleComplete = data.cycle.filter((item) => item.done).length;

  return (
    <div className="font-mono text-slate-300">
      <header className="mb-4 rounded-xl border border-[#45629a]/45 bg-[#07142f]/95 px-4 py-4 shadow-[0_16px_50px_rgba(0,4,18,0.3)] sm:px-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-300">
              <CircleDot className="h-3.5 w-3.5" />
              GEO intelligence control room
              <span className={`ml-1 inline-flex items-center gap-1.5 rounded-full border px-2 py-1 tracking-[0.12em] ${hasRuns ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" : "border-slate-600/50 bg-slate-800/50 text-slate-400"}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${hasRuns ? "animate-pulse bg-emerald-400" : "bg-slate-500"}`} />
                {hasRuns ? "LIVE" : "STANDBY"}
              </span>
            </div>
            <h1 className="mt-2 truncate text-xl font-black tracking-[-0.04em] text-white sm:text-2xl">{data.project.name}</h1>
            <p className="mt-1.5 truncate text-xs text-slate-400">
              {data.project.brandName} · {data.project.category} · 최신 측정 {formatDate(data.funnel.measuredAt)}
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="grid grid-cols-3 divide-x divide-[#45629a]/35 rounded-lg border border-[#45629a]/35 bg-[#0b1b3c] text-center">
              <div className="px-4 py-2"><strong className="block text-sm text-white">{data.project.questionCount}</strong><span className="text-[9px] uppercase tracking-wider text-slate-500">queries</span></div>
              <div className="px-4 py-2"><strong className="block text-sm text-white">{data.project.modelCount}</strong><span className="text-[9px] uppercase tracking-wider text-slate-500">models</span></div>
              <div className="px-4 py-2"><strong className="block text-sm text-white">{data.project.recentRunCount}</strong><span className="text-[9px] uppercase tracking-wider text-slate-500">runs</span></div>
            </div>
            <div className="flex gap-2">
              <Link href="/share" className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-cyan-300 px-4 py-2 text-xs font-black text-[#041126] transition hover:bg-cyan-200 sm:flex-none">
                새 측정 <ArrowRight className="h-3.5 w-3.5" />
              </Link>
              <Link href="/reports" aria-label="리포트 열기" className="grid min-h-10 min-w-10 place-items-center rounded-lg border border-[#45629a]/45 bg-[#102247] text-slate-300 transition hover:bg-[#17305f]">
                <FileSearch className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5">
        <Panel>
          <PanelHeader title="실시간 Answer Share" icon={Gauge} meta={hasRuns ? "0–100%" : "대기"} />
          <HalfGauge
            value={data.funnel.answerShare}
            available={hasRuns}
            label="answer share"
            detail={<Delta value={data.overview.answerShareDelta} />}
          />
        </Panel>

        <Panel>
          <PanelHeader title="현재 GenRank" icon={Sparkles} meta="종합 점수" />
          <BigMetric
            label="generative rank"
            value={hasRuns ? data.funnel.genrank.toFixed(1) : "—"}
            detail={<Delta value={data.overview.genrankDelta} suffix="" />}
            color="text-amber-300"
          />
        </Panel>

        <Panel>
          <PanelHeader title="긍정 문맥 비율" icon={Activity} meta="최신 응답" />
          <DonutMetric
            value={data.overview.positiveRate}
            available={hasRuns}
            label="positive context"
            color="#4dc8ff"
            footnote={
              <>
                <strong className="block text-lg text-cyan-300">{hasRuns ? `${data.overview.positiveRate.toFixed(1)}%` : "데이터 없음"}</strong>
                브랜드 언급 중 긍정 응답 비율
              </>
            }
          />
        </Panel>

        <Panel>
          <PanelHeader title="최신 GEO 진단" icon={SearchCheck} meta={data.latestAudit?.grade ?? "미실행"} />
          <DonutMetric
            value={auditPercent}
            available={Boolean(data.latestAudit)}
            label="audit score"
            color="#a78bfa"
            footnote={
              data.latestAudit ? (
                <>
                  <strong className="block text-lg text-violet-300">{data.latestAudit.score}/{data.latestAudit.total}</strong>
                  {formatDate(data.latestAudit.createdAt)}
                </>
              ) : (
                <Link href="/audit" className="inline-flex items-center gap-1 text-violet-300">
                  첫 진단 실행 <ArrowRight className="h-3 w-3" />
                </Link>
              )
            }
          />
        </Panel>

        <Panel className="sm:col-span-2 xl:col-span-4 2xl:col-span-1">
          <PanelHeader title="관제 상태" icon={Radio} meta={hasRuns ? "정상" : "측정 필요"} />
          <div className="divide-y divide-[#45629a]/25 px-4 py-2 text-xs">
            <div className="flex items-center justify-between py-3"><span className="text-slate-500">현재 퍼널</span><strong className="text-cyan-300">{data.funnel.stage}</strong></div>
            <div className="flex items-center justify-between py-3"><span className="text-slate-500">최신 응답</span><strong className="text-white">{hasRuns ? `${data.overview.totalResponses}건` : "—"}</strong></div>
            <div className="flex items-center justify-between py-3"><span className="text-slate-500">실행 준비도</span><strong className="text-amber-300">{data.checklist.percent}%</strong></div>
            <div className="flex items-center justify-between py-3"><span className="text-slate-500">개선 사이클</span><strong className="text-emerald-300">{cycleComplete}/4</strong></div>
          </div>
        </Panel>
      </div>

      <Panel className="mt-4 overflow-hidden">
        <SplitPanelHeader
          left={{
            title: "전체 언급율",
            icon: Activity,
            meta: hasRuns ? `최근 ${runTrend.length}회 실행` : "측정 대기",
          }}
          right={{
            title: "AI 모델 언급율",
            icon: BarChart3,
            meta: hasRuns && hasModelData ? `${data.models.filter((model) => model.total > 0).length}개 모델` : "측정 대기",
          }}
        />
        {!hasRuns ? (
          <EmptyData title="측정 데이터가 아직 없습니다" description="브랜드를 포함하지 않은 핵심 질문을 여러 AI 모델에 실행하면 전체 언급율 추이와 모델별 비교가 표시됩니다." />
        ) : (
          <div className="grid lg:grid-cols-2 lg:items-stretch">
            <div className="flex min-h-[560px] flex-col border-b border-[#45629a]/30 lg:border-b-0 lg:border-r">
              <div className="flex flex-1 flex-col px-3 pb-2 pt-4 sm:px-5" role="img" aria-label="최근 실행별 전체 Answer Share 추이">
                <ResponsiveContainer width="100%" height={400}>
                  <AreaChart data={runTrend} margin={{ left: -12, right: 8, top: 8, bottom: 0 }}>
                    <defs>
                      <linearGradient id="overallMentionArea" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#27e3a2" stopOpacity={0.42} />
                        <stop offset="100%" stopColor="#27e3a2" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#26395f" strokeDasharray="2 5" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: "#7183a6", fontSize: 10 }} tickLine={false} axisLine={false} />
                    <YAxis
                      domain={[trendMin, trendMax]}
                      tick={{ fill: "#7183a6", fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(value) => `${value}%`}
                    />
                    <Tooltip contentStyle={chartTooltip} formatter={(value) => [`${Number(value).toFixed(1)}%`, "전체 언급율"]} />
                    <Area
                      type="monotone"
                      dataKey="overall"
                      stroke="#27e3a2"
                      strokeWidth={2.5}
                      fill="url(#overallMentionArea)"
                      dot={{ r: 2.5, fill: "#07142f", stroke: "#27e3a2", strokeWidth: 2 }}
                      activeDot={{ r: 4, fill: "#27e3a2" }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-[#45629a]/30 bg-[#0b1b3c] px-4 py-3 text-xs sm:justify-start sm:px-5 sm:text-sm">
                <span className="text-slate-400">전체 언급율</span>
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="text-slate-300">{previousShare === null ? "—" : `${previousShare.toFixed(1)}%`}</strong>
                  <Delta value={data.overview.answerShareDelta} />
                  <span className="text-slate-500">→</span>
                  <strong className="text-lg font-black tracking-tight text-emerald-300">{data.funnel.answerShare.toFixed(1)}%</strong>
                </div>
              </div>
            </div>

            <div className="flex min-h-[560px] flex-col">
              {!hasModelData ? (
                <EmptyData compact title="모델 측정 데이터가 없습니다" description="질문 세트를 실행하면 모델별 현재·이전 점유율이 표시됩니다." />
              ) : (
                <ModelComparisonSection compact models={data.models} />
              )}
            </div>
          </div>
        )}
      </Panel>

      <div className="mt-4 grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
        <Panel>
          <PanelHeader title="경쟁 브랜드 점유율" icon={Target} meta={`${data.overview.competitors.length}개 비교`} />
          {competitorData.length ? (
            <div className="space-y-4 px-4 py-5" role="img" aria-label="브랜드와 경쟁사별 Answer Share 비교">
              {competitorData.slice(0, 5).map((item) => (
                <div key={item.name}>
                  <div className="mb-2 flex items-center justify-between gap-2 text-[11px]">
                    <span className="flex min-w-0 items-center gap-2 text-slate-400">
                      <i className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                      <span className="truncate">{item.name}</span>
                    </span>
                    <strong className="text-white">{item.value.toFixed(1)}%</strong>
                  </div>
                  <ShareBar value={item.value} color={item.color} />
                </div>
              ))}
            </div>
          ) : (
            <EmptyData compact title="경쟁사 비교 데이터 없음" description="측정 응답에 경쟁 브랜드가 포함되면 점유율을 비교합니다." />
          )}
        </Panel>

        <Panel>
          <PanelHeader title="GEO 퍼널 상태" icon={Gauge} meta={`${activeIndex + 1}/${data.funnel.stages.length} 단계`} />
          <div className="px-4 py-4">
            <div className="grid grid-cols-4 gap-1.5">
              {data.funnel.stages.map((stage, index) => (
                <div key={stage} className={`rounded-lg border px-1 py-3 text-center ${index <= activeIndex ? "border-cyan-300/35 bg-cyan-300/10" : "border-[#45629a]/25 bg-[#0b1b3c]"}`}>
                  <span className={`block text-[9px] font-bold ${index <= activeIndex ? "text-cyan-300" : "text-slate-600"}`}>0{index + 1}</span>
                  <strong className={`mt-1 block text-[11px] ${index <= activeIndex ? "text-white" : "text-slate-500"}`}>{stage}</strong>
                </div>
              ))}
            </div>
            <div className="mt-4 rounded-lg border border-[#45629a]/25 bg-[#0b1b3c] p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-cyan-300">현재 단계 · {data.funnel.stage}</p>
              <p className="mt-2 text-xs leading-5 text-slate-400">{stageDescriptions[data.funnel.stage]}</p>
            </div>
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="실행 준비도" icon={ListFilter} meta={`${data.checklist.completed}/${data.checklist.total}`} />
          <div className="px-4 py-5">
            <div className="flex items-end justify-between">
              <div><span className="text-[10px] uppercase tracking-wider text-slate-500">체크리스트 완료율</span><strong className="mt-1 block text-4xl font-black tracking-tight text-amber-300">{data.checklist.percent}%</strong></div>
              <span className="text-xs text-slate-500">{data.checklist.total - data.checklist.completed}개 남음</span>
            </div>
            <div className="mt-5"><ShareBar value={data.checklist.percent} color="#fbbf24" /></div>
            <div className="mt-5 grid grid-cols-10 gap-1" aria-hidden="true">
              {Array.from({ length: 10 }, (_, index) => (
                <span key={index} className={`h-3 rounded-sm ${index < Math.round(data.checklist.percent / 10) ? "bg-amber-300" : "bg-[#1b2945]"}`} />
              ))}
            </div>
            <Link href="/learn" className="mt-5 inline-flex items-center gap-1.5 text-xs font-bold text-amber-300">체크 계속 <ArrowRight className="h-3.5 w-3.5" /></Link>
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="4주 개선 사이클" icon={CalendarCheck} meta={`${cycleComplete}/4 완료`} />
          <div className="divide-y divide-[#45629a]/20 px-4 py-2">
            {data.cycle.map((item) => (
              <div key={item.week} className="flex items-center gap-3 py-3 text-xs">
                {item.done ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" /> : <Circle className="h-4 w-4 shrink-0 text-slate-600" />}
                <span className={item.done ? "font-medium text-slate-200" : "text-slate-500"}>{item.label}</span>
              </div>
            ))}
            <Link href="/strategy" className="inline-flex items-center gap-1.5 py-3 text-xs font-bold text-emerald-300">사이클 관리 <ArrowRight className="h-3.5 w-3.5" /></Link>
          </div>
        </Panel>
      </div>

      <QuestionMonitor
        data={data}
        selectedQuestion={selectedQuestion}
        selectedQuestionText={selectedQuestionText}
        onSelect={setSelectedQuestionText}
      />
    </div>
  );
}

function QuestionMonitor({
  data,
  selectedQuestion,
  selectedQuestionText,
  onSelect,
}: {
  data: DashboardData;
  selectedQuestion: DashboardData["questions"][number] | null;
  selectedQuestionText: string | null;
  onSelect: (value: string | null) => void;
}) {
  return (
    <Panel className="mt-4">
      <PanelHeader title="모니터링 질문 관제" icon={Activity} meta={`${data.questions.length}개 질문`} />
      <div className="grid xl:grid-cols-[340px_minmax(0,1fr)]">
        <div className="border-b border-[#45629a]/30 p-3 xl:border-b-0 xl:border-r">
          <button
            type="button"
            onClick={() => onSelect(null)}
            aria-pressed={!selectedQuestionText}
            className={`mb-2 flex w-full items-center justify-between rounded-lg border px-3 py-3 text-left transition ${!selectedQuestionText ? "border-cyan-300/35 bg-cyan-300/10" : "border-[#45629a]/25 bg-[#0b1b3c] hover:bg-[#102247]"}`}
          >
            <span><strong className="block text-xs text-white">전체 관제 현황</strong><small className="mt-1 block text-[10px] text-slate-500">통합 KPI와 실행 상태</small></span>
            <ChevronRight className={`h-4 w-4 ${!selectedQuestionText ? "text-cyan-300" : "text-slate-600"}`} />
          </button>
          <div className="max-h-[500px] space-y-2 overflow-y-auto pr-1">
            {data.questions.map((question, index) => {
              const selected = selectedQuestionText === question.text;
              return (
                <button
                  key={question.text}
                  type="button"
                  onClick={() => onSelect(question.text)}
                  aria-pressed={selected}
                  className={`w-full rounded-lg border p-3 text-left transition ${selected ? "border-emerald-400/35 bg-emerald-400/10" : "border-[#45629a]/25 bg-[#0b1b3c] hover:border-[#5a79b4]/60 hover:bg-[#102247]"}`}
                >
                  <div className="flex items-start gap-2.5">
                    <span className="mt-0.5 text-[10px] font-black text-slate-600">Q{String(index + 1).padStart(2, "0")}</span>
                    <p className="line-clamp-2 flex-1 text-xs font-semibold leading-5 text-slate-200">{question.text}</p>
                  </div>
                  <div className="mt-2.5 grid grid-cols-3 border-t border-[#45629a]/20 pt-2 text-[10px]">
                    <span className="text-slate-500">점유율 <strong className="ml-1 text-emerald-300">{question.share}%</strong></span>
                    <span className="text-center text-slate-500">순위 <strong className="ml-1 text-cyan-300">{question.averageRank ? `${question.averageRank}위` : "—"}</strong></span>
                    <span className="text-right text-slate-500">긍정 <strong className="ml-1 text-amber-300">{question.positiveRate}%</strong></span>
                  </div>
                </button>
              );
            })}
            {!data.questions.length && (
              <div className="rounded-lg border border-dashed border-[#45629a]/35 px-4 py-8 text-center text-xs leading-5 text-slate-500">
                측정을 실행하면 질문별 GEO 성과가 표시됩니다.
              </div>
            )}
          </div>
        </div>

        <div className="min-w-0">
          {selectedQuestion ? (
            <QuestionDetail question={selectedQuestion} />
          ) : (
            <div className="grid min-h-[420px] place-items-center px-6 py-10 text-center">
              <div>
                <CircleDot className="mx-auto h-8 w-8 text-cyan-300" />
                <h3 className="mt-4 text-base font-bold text-white">질문별 상세 신호를 확인하세요</h3>
                <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-slate-500">왼쪽 질문을 선택하면 모델별 언급률, 평균 순위, 긍정 문맥과 실행별 추이를 드릴다운합니다.</p>
                <div className="mx-auto mt-6 grid max-w-lg grid-cols-3 divide-x divide-[#45629a]/30 rounded-lg border border-[#45629a]/30 bg-[#0b1b3c]">
                  <div className="px-3 py-4"><span className="text-[9px] uppercase tracking-wider text-slate-500">질문</span><strong className="mt-1 block text-xl text-white">{data.questions.length}</strong></div>
                  <div className="px-3 py-4"><span className="text-[9px] uppercase tracking-wider text-slate-500">응답</span><strong className="mt-1 block text-xl text-cyan-300">{data.overview.totalResponses}</strong></div>
                  <div className="px-3 py-4"><span className="text-[9px] uppercase tracking-wider text-slate-500">긍정</span><strong className="mt-1 block text-xl text-amber-300">{data.recentRuns.length ? `${data.overview.positiveRate}%` : "—"}</strong></div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}

function QuestionDetail({ question }: { question: DashboardData["questions"][number] }) {
  const activeModels = question.models.filter((model) => model.total > 0);

  return (
    <div>
      <div className="border-b border-[#45629a]/30 px-4 py-4 sm:px-5">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300">selected query analysis</p>
        <h3 className="mt-2 max-w-5xl text-sm font-bold leading-6 text-white sm:text-base">{question.text}</h3>
      </div>

      <div className="grid grid-cols-2 divide-x divide-y divide-[#45629a]/25 border-b border-[#45629a]/30 sm:grid-cols-4 sm:divide-y-0">
        <div className="p-4"><span className="text-[9px] uppercase tracking-wider text-slate-500">Answer Share</span><strong className="mt-1.5 block text-2xl text-emerald-300">{question.share}%</strong></div>
        <div className="p-4"><span className="text-[9px] uppercase tracking-wider text-slate-500">이전 대비</span><div className="mt-2.5"><Delta value={question.delta} /></div></div>
        <div className="p-4"><span className="text-[9px] uppercase tracking-wider text-slate-500">평균 순위</span><strong className="mt-1.5 block text-2xl text-cyan-300">{question.averageRank ? `${question.averageRank}위` : "—"}</strong></div>
        <div className="p-4"><span className="text-[9px] uppercase tracking-wider text-slate-500">긍정 문맥</span><strong className="mt-1.5 block text-2xl text-amber-300">{question.positiveRate}%</strong></div>
      </div>

      <div className="grid 2xl:grid-cols-[0.8fr_1.2fr]">
        <div className="border-b border-[#45629a]/30 p-4 2xl:border-b-0 2xl:border-r">
          <h4 className="text-xs font-bold text-slate-200">모델별 질문 성과</h4>
          <div className="mt-4 space-y-4">
            {activeModels.map((model) => (
              <div key={model.provider}>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <ProviderDot provider={model.provider} />
                  <span className="text-[10px] text-slate-500">{model.averageRank ? `평균 ${model.averageRank}위` : "순위 없음"} · <strong className="text-white">{model.share}%</strong></span>
                </div>
                <ShareBar value={model.share} color={modelMeta[model.provider]?.color} />
              </div>
            ))}
            {!activeModels.length && <p className="py-10 text-center text-xs text-slate-500">이 질문의 모델별 결과가 없습니다.</p>}
          </div>
        </div>

        <div className="min-w-0 p-4">
          <h4 className="text-xs font-bold text-slate-200">모델별 Answer Share 추이</h4>
          {question.trends.length ? (
            <div className="mt-3 h-72" role="img" aria-label="선택 질문의 최근 모델별 Answer Share 추이">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={question.trends} margin={{ left: -20, right: 10, top: 8, bottom: 0 }}>
                  <CartesianGrid stroke="#26395f" strokeDasharray="2 4" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: "#7183a6", fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fill: "#7183a6", fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(value) => `${value}%`} />
                  <Tooltip contentStyle={chartTooltip} formatter={(value, name) => [`${Number(value).toFixed(1)}%`, name === "overall" ? "전체" : modelMeta[String(name)]?.label ?? name]} />
                  <Legend iconType="line" wrapperStyle={{ fontSize: 10 }} formatter={(value) => value === "overall" ? "전체" : modelMeta[String(value)]?.label ?? value} />
                  <Line type="monotone" dataKey="overall" stroke="#f8fafc" strokeWidth={2.4} dot={{ r: 2.5 }} connectNulls />
                  {Object.entries(modelMeta).map(([provider, meta]) => (
                    <Line key={provider} type="monotone" dataKey={provider} stroke={meta.color} strokeWidth={1.7} dot={false} connectNulls />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="grid min-h-64 place-items-center text-center">
              <div><Activity className="mx-auto h-6 w-6 text-slate-600" /><p className="mt-3 text-xs text-slate-500">반복 측정하면 질문별 추이가 표시됩니다.</p></div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
