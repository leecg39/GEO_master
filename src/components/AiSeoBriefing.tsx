"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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
import { ExternalLink, Lightbulb, Sparkles } from "lucide-react";
import { Badge, Card, EmptyState } from "@/components/ui";
import type { AiSeoQueryBriefingData } from "@/lib/semforge/ai-visibility/briefing";
import { cn } from "@/lib/utils";

const chartTooltip = {
  background: "#07142f",
  border: "1px solid rgba(125, 164, 255, 0.28)",
  borderRadius: 8,
  color: "#e6efff",
  fontSize: 11,
};

const gradeToneClass: Record<string, string> = {
  good: "text-emerald-300",
  cyan: "text-cyan-300",
  warn: "text-amber-300",
  bad: "text-rose-300",
  default: "text-slate-300",
};

function VisibilityGauge({ score, label }: { score: number; label: string }) {
  const safe = Math.max(0, Math.min(100, score));
  const color = safe >= 80 ? "#34d399" : safe >= 60 ? "#22d3ee" : safe >= 40 ? "#fbbf24" : "#fb7185";
  const data = [{ value: safe }, { value: 100 - safe }];

  return (
    <div className="relative h-40" role="img" aria-label={`${label} ${safe}점`}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" cx="50%" cy="78%" startAngle={180} endAngle={0} innerRadius="58%" outerRadius="82%" stroke="none">
            <Cell fill={color} />
            <Cell fill="#1b2945" />
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-x-0 bottom-2 text-center">
        <p className="text-3xl font-bold text-white">{safe}</p>
        <p className="text-xs text-slate-500">{label}</p>
      </div>
    </div>
  );
}

export function AiSeoBriefing({
  briefing,
  loading,
}: {
  briefing: AiSeoQueryBriefingData | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <Card className="mt-5 border-cyan-400/15">
        <EmptyState>분석 리포트를 불러오는 중…</EmptyState>
      </Card>
    );
  }

  if (!briefing) return null;

  if (!briefing.ready) {
    return (
      <Card className="mt-5 border-white/8">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-slate-800"><Sparkles className="h-5 w-5 text-slate-400" /></span>
          <div>
            <h3 className="font-semibold text-white">{briefing.query}</h3>
            <p className="mt-1 text-sm text-slate-400">{briefing.domain} · 아직 실측 데이터가 없습니다.</p>
            <p className="mt-2 text-xs text-slate-500">실측 수집 후 AIO·인용·오가닉 분석 리포트가 표시됩니다.</p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="mt-5 space-y-5">
      <Card className="border-cyan-400/15 bg-gradient-to-br from-slate-900/90 to-cyan-950/20">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Sparkles className="h-4 w-4 text-cyan-300" />
              <h3 className="text-lg font-semibold text-white">{briefing.query} · SERP 분석</h3>
              <Badge tone={briefing.grade.tone}>{briefing.grade.label}</Badge>
            </div>
            <p className="mt-2 text-sm text-slate-400">
              {briefing.domain} · {briefing.countryCode} · {briefing.device} · {new Date(briefing.capturedAt).toLocaleString("ko-KR")} 수집
            </p>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300">{briefing.narratives[0]}</p>
          </div>
          <div className="w-full max-w-xs shrink-0 rounded-xl border border-white/8 bg-slate-950/50 p-3">
            <VisibilityGauge score={briefing.visibilityScore} label="SERP 가시성" />
            <p className={cn("text-center text-sm font-semibold", gradeToneClass[briefing.grade.tone] ?? "text-slate-300")}>
              AIO {briefing.aioPresent ? "출현" : "없음"} · 인용 {briefing.cited === true ? "있음" : briefing.cited === false ? "없음" : "—"} · 오가닉 {briefing.organicPosition ?? "—"}위
            </p>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "AI Overview", value: briefing.aioPresent ? "출현" : "없음", tone: briefing.aioPresent ? "good" as const : "default" as const },
          { label: "자사 인용", value: briefing.cited === true ? "인용" : briefing.cited === false ? "미인용" : "판정불가", tone: briefing.cited === true ? "good" as const : briefing.cited === false ? "warn" as const : "default" as const },
          { label: "오가닉 순위", value: briefing.organicPosition ?? "—", tone: "cyan" as const },
          { label: "데이터 소스", value: briefing.source, tone: "default" as const },
        ].map((metric) => (
          <Card key={metric.label} className="border-white/8 bg-slate-950/35">
            <p className="text-xs text-slate-500">{metric.label}</p>
            <p className="mt-2">
              {metric.label === "데이터 소스" ? (
                <span className="text-sm font-semibold text-white">{metric.value}</span>
              ) : (
                <Badge tone={metric.tone}>{metric.value}</Badge>
              )}
            </p>
          </Card>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <h4 className="mb-4 text-sm font-semibold text-white">가시성 점수 산출</h4>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={briefing.scoreFactors.filter((factor) => factor.kind !== "total").map((factor) => ({
                    name: factor.label,
                    value: factor.points,
                    fill: factor.kind === "penalty" ? "#fb7185" : "#22d3ee",
                  }))}
                  layout="vertical"
                  margin={{ left: 8, right: 8, top: 4, bottom: 4 }}
                >
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" horizontal={false} />
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" width={110} tick={{ fill: "#94a3b8", fontSize: 11 }} />
                  <Tooltip contentStyle={chartTooltip} formatter={(value) => [`${value ?? 0}점`, "점수"]} />
                  <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                    {briefing.scoreFactors.filter((factor) => factor.kind !== "total").map((factor) => (
                      <Cell key={factor.key} fill={factor.kind === "penalty" ? "#fb7185" : "#22d3ee"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <ul className="space-y-2 text-sm">
              {briefing.scoreFactors.map((factor) => (
                <li key={factor.key} className="flex items-center justify-between rounded-lg border border-white/6 bg-slate-950/40 px-3 py-2">
                  <span className="text-slate-400">{factor.label}</span>
                  <span className={cn("font-semibold", factor.points >= 0 ? "text-cyan-300" : "text-rose-300")}>
                    {factor.kind === "total" ? `${factor.points}점` : `${factor.points > 0 ? "+" : ""}${factor.points}`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Card>

        <Card>
          <h4 className="mb-4 text-sm font-semibold text-white">5축 SERP 레이더</h4>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={briefing.radar} outerRadius="72%">
                <PolarGrid stroke="rgba(255,255,255,0.08)" />
                <PolarAngleAxis dataKey="axis" tick={{ fill: "#94a3b8", fontSize: 10 }} />
                <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} axisLine={false} />
                <Radar dataKey="score" stroke="#22d3ee" fill="#22d3ee" fillOpacity={0.25} />
                <Tooltip
                  contentStyle={chartTooltip}
                  formatter={(value) => [`${value ?? 0}점`, "점수"]}
                  labelFormatter={(_label, payload) => (payload?.[0]?.payload as { hint?: string } | undefined)?.hint ?? ""}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <h4 className="mb-4 text-sm font-semibold text-white">수집 이력 추이</h4>
          {briefing.history.length < 2 ? (
            <EmptyState>2회 이상 수집하면 추이 차트가 표시됩니다.</EmptyState>
          ) : (
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={briefing.history}>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                  <YAxis domain={[0, 100]} tick={{ fill: "#64748b", fontSize: 10 }} />
                  <Tooltip contentStyle={chartTooltip} />
                  <Line type="monotone" dataKey="visibilityScore" stroke="#22d3ee" strokeWidth={2} dot={{ r: 3 }} name="가시성" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card>
          <h4 className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
            <Lightbulb className="h-4 w-4 text-amber-300" />
            실행 권장
          </h4>
          {briefing.recommendations.length === 0 ? (
            <EmptyState>현재 SERP 신호가 양호합니다.</EmptyState>
          ) : (
            <ul className="space-y-2 text-sm leading-6 text-slate-300">
              {briefing.recommendations.map((item) => (
                <li key={item} className="rounded-lg border border-white/6 bg-slate-950/40 px-3 py-2">{item}</li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <h4 className="mb-4 text-sm font-semibold text-white">SERP 기능</h4>
          {briefing.featureChart.length === 0 ? (
            <EmptyState>감지된 SERP 기능이 없습니다.</EmptyState>
          ) : (
            <div className="flex flex-wrap gap-2">
              {briefing.featureChart.map((item) => (
                <Badge key={item.name} tone="cyan">{item.name}</Badge>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <h4 className="mb-4 text-sm font-semibold text-white">AIO 인용 도메인</h4>
          {briefing.citedDomains.length === 0 ? (
            <EmptyState>인용 도메인 데이터가 없습니다.</EmptyState>
          ) : (
            <ul className="space-y-2 text-sm text-slate-300">
              {briefing.citedDomains.map((item) => (
                <li key={item} className="rounded-lg border border-white/6 bg-slate-950/40 px-3 py-2">{item}</li>
              ))}
            </ul>
          )}
          {briefing.citedUrl && (
            <a href={briefing.citedUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs text-cyan-300 hover:underline">
              자사 인용 URL <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </Card>
      </div>

      {briefing.narratives.length > 1 && (
        <Card className="border-white/8">
          <h4 className="mb-3 text-sm font-semibold text-white">분석 요약</h4>
          <ul className="space-y-2 text-sm leading-6 text-slate-400">
            {briefing.narratives.slice(1).map((line) => (
              <li key={line} className="flex gap-2"><span className="text-cyan-400">·</span>{line}</li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
