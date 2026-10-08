"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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
import { Lightbulb, Minus, Sparkles, Target, TrendingDown, TrendingUp } from "lucide-react";
import { Badge, Card, EmptyState } from "@/components/ui";
import type { PositionTrackingBriefingData } from "@/lib/semforge/position-tracking/briefing";
import { cn } from "@/lib/utils";

const chartTooltip = {
  background: "#07142f",
  border: "1px solid rgba(125, 164, 255, 0.28)",
  borderRadius: 8,
  color: "#e6efff",
  fontSize: 11,
};

function VisibilityGauge({ value, label }: { value: number; label: string }) {
  const safe = Math.max(0, Math.min(100, value));
  const color = safe >= 75 ? "#34d399" : safe >= 50 ? "#22d3ee" : safe >= 30 ? "#fbbf24" : "#fb7185";
  const data = [{ value: safe }, { value: 100 - safe }];

  return (
    <div className="relative h-40" role="img" aria-label={`${label} ${safe}%`}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" cx="50%" cy="78%" startAngle={180} endAngle={0} innerRadius="58%" outerRadius="82%" stroke="none">
            <Cell fill={color} />
            <Cell fill="#1b2945" />
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-x-0 bottom-2 text-center">
        <p className="text-3xl font-bold text-white">{safe}%</p>
        <p className="text-xs text-slate-500">{label}</p>
      </div>
    </div>
  );
}

function TrendBadge({ trend, delta }: { trend: "up" | "down" | "stable" | "new"; delta: number | null }) {
  if (trend === "new") return <Badge>신규</Badge>;
  if (trend === "stable") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-slate-500">
        <Minus className="h-3 w-3" />0
      </span>
    );
  }
  const positive = trend === "up";
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-semibold", positive ? "text-emerald-300" : "text-rose-300")}>
      {positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {positive ? "+" : ""}{delta}
    </span>
  );
}

export function PositionTrackingBriefing({
  campaignName,
  domain,
  updatedAt,
  briefing,
}: {
  campaignName: string;
  domain: string;
  updatedAt: string | null;
  briefing: PositionTrackingBriefingData;
}) {
  if (!briefing.ready) {
    return (
      <Card className="mt-5 border-white/8">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-slate-800"><Target className="h-5 w-5 text-slate-400" /></span>
          <div>
            <h3 className="font-semibold text-white">{campaignName}</h3>
            <p className="mt-1 text-sm text-slate-400">{domain} · 아직 순위 데이터가 없습니다.</p>
            <p className="mt-2 text-xs text-slate-500">키워드를 추가하고 순위 수집을 실행하면 분석 대시보드가 표시됩니다.</p>
          </div>
        </div>
      </Card>
    );
  }

  const momentumChart = [
    { name: "상승", count: briefing.improved, fill: "#34d399" },
    { name: "하락", count: briefing.declined, fill: "#fb7185" },
    { name: "유지", count: briefing.stable, fill: "#94a3b8" },
  ].filter((item) => item.count > 0);

  return (
    <div className="mt-5 space-y-5">
      <Card className="border-cyan-400/15 bg-gradient-to-br from-slate-900/90 to-cyan-950/20">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Sparkles className="h-4 w-4 text-cyan-300" />
              <h3 className="text-lg font-semibold text-white">{campaignName} · 순위 분석</h3>
              <Badge tone="cyan">가시성 {briefing.visibility}%</Badge>
            </div>
            <p className="mt-2 text-sm text-slate-400">
              {domain} · {updatedAt ? new Date(updatedAt).toLocaleString("ko-KR") : "—"} 수집
            </p>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300">{briefing.narratives[0]}</p>
          </div>
          <div className="w-full max-w-xs shrink-0 rounded-xl border border-white/8 bg-slate-950/50 p-3">
            <VisibilityGauge value={briefing.visibility} label="SERP 가시성" />
            <p className="text-center text-sm font-semibold text-cyan-300">
              {briefing.rankedCount}/{briefing.totalKeywords} 키워드 노출 · 평균 {briefing.avgPosition ?? "—"}위
            </p>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Top 3", value: briefing.top3Count, sub: "1–3위 키워드" },
          { label: "Top 10", value: briefing.top10Count, sub: "4–10위 포함" },
          { label: "평균 순위", value: briefing.avgPosition ?? "—", sub: "노출 키워드 기준" },
          { label: "순위 변동", value: `${briefing.improved}↑ ${briefing.declined}↓`, sub: "최근 수집 대비" },
        ].map((metric) => (
          <Card key={metric.label} className="border-white/8 bg-slate-950/35">
            <p className="text-xs text-slate-500">{metric.label}</p>
            <p className="mt-2 text-2xl font-semibold text-white">{metric.value}</p>
            <p className="mt-1 text-xs text-slate-500">{metric.sub}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <h4 className="mb-4 text-sm font-semibold text-white">순위 구간 분포</h4>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={briefing.positionBuckets}>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="bucket" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fill: "#64748b", fontSize: 10 }} />
                <Tooltip contentStyle={chartTooltip} />
                <Bar dataKey="count" fill="#22d3ee" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
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
          <h4 className="mb-4 text-sm font-semibold text-white">순위 변동 요약</h4>
          {momentumChart.length === 0 ? (
            <EmptyState>변동 데이터가 없습니다.</EmptyState>
          ) : (
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={momentumChart}>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fill: "#64748b", fontSize: 10 }} />
                  <Tooltip contentStyle={chartTooltip} />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                    {momentumChart.map((entry) => <Cell key={entry.name} fill={entry.fill} />)}
                  </Bar>
                </BarChart>
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
            <EmptyState>현재 추적 상태가 양호합니다.</EmptyState>
          ) : (
            <ul className="space-y-2 text-sm leading-6 text-slate-300">
              {briefing.recommendations.map((item) => (
                <li key={item} className="rounded-lg border border-white/6 bg-slate-950/40 px-3 py-2">{item}</li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <h4 className="mb-4 text-sm font-semibold text-white">키워드 순위표</h4>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <thead>
              <tr className="border-b border-white/8 text-xs text-slate-500">
                <th className="pb-3 pr-4 font-medium">키워드</th>
                <th className="pb-3 pr-4 font-medium">현재</th>
                <th className="pb-3 pr-4 font-medium">이전</th>
                <th className="pb-3 font-medium">변동</th>
              </tr>
            </thead>
            <tbody>
              {briefing.keywords.map((item) => (
                <tr key={item.id} className="border-b border-white/5 text-slate-300">
                  <td className="py-3 pr-4 text-white">{item.keyword}</td>
                  <td className="py-3 pr-4 font-semibold text-cyan-300">{item.position ?? "—"}</td>
                  <td className="py-3 pr-4 text-slate-500">{item.previousPosition ?? "—"}</td>
                  <td className="py-3"><TrendBadge trend={item.trend} delta={item.delta} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

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
