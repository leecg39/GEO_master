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
import Link from "next/link";
import { Activity, ExternalLink, Globe2, Lightbulb, MapPin, SearchCheck, TrendingUp } from "lucide-react";
import { Badge, Card, EmptyState, Progress } from "@/components/ui";
import type { DomainAnalyticsDashboardData } from "@/lib/semforge/domain-overview";
import { cn } from "@/lib/utils";

export type { DomainAnalyticsDashboardData } from "@/lib/semforge/domain-overview";

const chartTooltip = {
  background: "#07142f",
  border: "1px solid rgba(125, 164, 255, 0.28)",
  borderRadius: 8,
  color: "#e6efff",
  fontSize: 11,
};

function HealthGauge({ score, label }: { score: number | null; label: string }) {
  const safe = score ?? 0;
  const available = score !== null;
  const color = !available ? "#64748b" : safe >= 75 ? "#34d399" : safe >= 50 ? "#22d3ee" : safe >= 30 ? "#fbbf24" : "#fb7185";
  const data = [{ value: available ? safe : 0 }, { value: 100 - (available ? safe : 0) }];
  return (
    <div className="relative h-36" role="img" aria-label={`${label} ${available ? `${safe}` : "미측정"}`}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" cx="50%" cy="78%" startAngle={180} endAngle={0} innerRadius="55%" outerRadius="80%" stroke="none">
            <Cell fill={available ? color : "#26344f"} />
            <Cell fill="#1b2945" />
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-x-0 bottom-1 text-center">
        <p className="text-2xl font-bold text-white">{available ? safe : "—"}</p>
        <p className="text-[11px] text-slate-500">{label}</p>
      </div>
    </div>
  );
}

export function AnalyticsOverviewDashboard({
  dashboard,
}: {
  dashboard: DomainAnalyticsDashboardData;
}) {
  const briefing = dashboard.position.briefing;
  const radar = briefing?.radar?.length
    ? briefing.radar
    : [
      { axis: "포지션", score: dashboard.position.primary?.visibility ?? 0, hint: "" },
      { axis: "AI SEO", score: dashboard.aiSeo.queryCount ? Math.round((dashboard.aiSeo.citedCount / Math.max(1, dashboard.aiSeo.collectedCount)) * 100) : 0, hint: "" },
      { axis: "사이트", score: dashboard.siteHealth ?? 0, hint: "" },
      { axis: "GSC", score: dashboard.gscConnected ? 80 : 10, hint: "" },
    ];

  const moduleBars = [
    { name: "포지션 캠페인", value: dashboard.position.campaignCount },
    { name: "AI SEO 질의", value: dashboard.aiSeo.queryCount },
    { name: "사이트 진단", value: dashboard.siteAudits.length },
    { name: "AIO 출현", value: dashboard.aiSeo.aioCount },
    { name: "인용", value: dashboard.aiSeo.citedCount },
  ];

  return (
    <div className="mt-5 space-y-5" aria-live="polite">
      <Card className="border-cyan-400/15">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-cyan-400/10"><Globe2 className="h-5 w-5 text-cyan-300" /></span>
            <div>
              <h2 className="text-lg font-semibold text-white">{dashboard.domain}</h2>
              <p className="mt-1 text-sm text-slate-400">도메인 분석 대시보드 · 포지션 · AI SEO · 사이트 진단 · GSC</p>
            </div>
          </div>
          <Badge tone={dashboard.gscConnected ? "good" : "default"}>GSC {dashboard.gscConnected ? "연결" : "미연결"}</Badge>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-4">
        <Card>
          <HealthGauge score={dashboard.position.primary?.visibility ?? null} label="포지션 가시성 %" />
        </Card>
        <Card>
          <HealthGauge score={dashboard.siteHealth} label="사이트 건강" />
        </Card>
        <Card>
          <p className="text-xs text-slate-500">AI SEO</p>
          <p className="mt-2 text-3xl font-semibold text-white">{dashboard.aiSeo.citedCount}<span className="text-base font-normal text-slate-500">/{dashboard.aiSeo.collectedCount || 0}</span></p>
          <p className="mt-1 text-xs text-slate-500">인용 / 수집 · 질의 {dashboard.aiSeo.queryCount}개</p>
          <Progress className="mt-3" value={dashboard.aiSeo.collectedCount ? Math.round((dashboard.aiSeo.citedCount / dashboard.aiSeo.collectedCount) * 100) : 0} />
        </Card>
        <Card>
          <p className="text-xs text-slate-500">모듈 커버리지</p>
          <div className="mt-3 h-28">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={moduleBars} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: "#64748b", fontSize: 9 }} interval={0} angle={-20} textAnchor="end" height={42} />
                <YAxis allowDecimals={false} tick={{ fill: "#64748b", fontSize: 10 }} width={28} />
                <Tooltip contentStyle={chartTooltip} />
                <Bar dataKey="value" fill="#22d3ee" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <h3 className="mb-3 font-semibold text-white">시그널 레이더</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radar}>
                <PolarGrid stroke="rgba(255,255,255,0.1)" />
                <PolarAngleAxis dataKey="axis" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                <Radar dataKey="score" stroke="#22d3ee" fill="#22d3ee" fillOpacity={0.25} />
                <Tooltip contentStyle={chartTooltip} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card>
          <h3 className="mb-3 flex items-center gap-2 font-semibold text-white"><Lightbulb className="h-4 w-4 text-amber-300" />인사이트</h3>
          {dashboard.narratives.length === 0 ? (
            <EmptyState>아직 수집된 분석이 없습니다. 포지션·AI SEO·사이트 진단을 실행하세요.</EmptyState>
          ) : (
            <ul className="space-y-2 text-sm text-slate-300">
              {dashboard.narratives.map((item) => <li key={item} className="rounded-lg bg-slate-950/40 px-3 py-2">{item}</li>)}
            </ul>
          )}
          {dashboard.recommendations.length > 0 && (
            <ul className="mt-4 space-y-2 text-xs text-slate-400">
              {dashboard.recommendations.map((item) => (
                <li key={item} className="flex gap-2"><Activity className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-400" />{item}</li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <div className="mb-3 flex items-center gap-2"><TrendingUp className="h-4 w-4 text-cyan-300" /><h3 className="font-semibold text-white">포지션 캠페인</h3></div>
          {!dashboard.position.campaigns.length ? <EmptyState>캠페인 없음</EmptyState> : (
            <ul className="space-y-2">
              {dashboard.position.campaigns.map((campaign) => (
                <li key={campaign.id} className="flex items-center justify-between rounded-lg border border-white/7 bg-slate-950/35 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate text-slate-200">{campaign.name}</p>
                    <p className="text-[11px] text-slate-500">키워드 {campaign.keywordCount}개</p>
                  </div>
                  <Badge tone="cyan">가시성 {campaign.visibility}</Badge>
                </li>
              ))}
            </ul>
          )}
          {briefing?.ready && briefing.positionBuckets.length > 0 && (
            <div className="mt-4 h-36">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={briefing.positionBuckets}>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="bucket" tick={{ fill: "#64748b", fontSize: 10 }} />
                  <YAxis allowDecimals={false} tick={{ fill: "#64748b", fontSize: 10 }} width={28} />
                  <Tooltip contentStyle={chartTooltip} />
                  <Bar dataKey="count" fill="#34d399" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
        <Card>
          <div className="mb-3 flex items-center gap-2"><SearchCheck className="h-4 w-4 text-violet-300" /><h3 className="font-semibold text-white">사이트 진단</h3></div>
          {!dashboard.siteAudits.length ? <EmptyState>진단 캠페인 없음</EmptyState> : (
            <ul className="space-y-2">
              {dashboard.siteAudits.map((audit) => (
                <li key={audit.id} className="flex items-center justify-between rounded-lg border border-white/7 bg-slate-950/35 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate text-slate-200">{audit.name}</p>
                    <p className="text-[11px] text-slate-500">{audit.lastRunAt ? new Date(audit.lastRunAt).toLocaleString("ko-KR") : "미실행"}</p>
                  </div>
                  <Badge tone={audit.siteHealth != null && audit.siteHealth >= 70 ? "good" : "default"}>{audit.siteHealth ?? "—"}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <div className="mb-3 flex items-center gap-2"><MapPin className="h-4 w-4 text-emerald-300" /><h3 className="font-semibold text-white">바로가기</h3></div>
          <ul className="space-y-2">
            {dashboard.links.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className={cn("flex items-center justify-between rounded-xl border border-white/7 bg-slate-950/35 px-3 py-2.5 transition hover:border-cyan-400/25 hover:bg-cyan-400/5")}
                >
                  <div>
                    <p className="text-sm font-medium text-white">{link.label}</p>
                    <p className="text-[11px] text-slate-500">{link.description}</p>
                  </div>
                  <ExternalLink className="h-3.5 w-3.5 text-slate-500" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
