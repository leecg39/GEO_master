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
import { AlertTriangle, FileSearch, Lightbulb, Sparkles } from "lucide-react";
import { Badge, Card, EmptyState, Progress } from "@/components/ui";
import { cn } from "@/lib/utils";

export interface SiteAuditBriefingData {
  ready: boolean;
  score: number | null;
  grade: { label: string; tone: "default" | "good" | "warn" | "bad" | "cyan" };
  pageCount: number;
  issueCount: number;
  hasLlmsTxt: boolean;
  scoreFactors: Array<{ key: string; label: string; points: number; kind: "base" | "penalty" | "total" }>;
  severityCounts: Record<string, number>;
  radar: Array<{ axis: string; score: number; hint: string }>;
  narratives: string[];
  recommendations: string[];
  issues: Array<{ id: number; url: string; severity: string; category: string; title: string; detail: string }>;
  pages: Array<{ url: string; statusCode: number; depth: number }>;
  depthBuckets: Array<{ depth: string; count: number }>;
}

const chartTooltip = {
  background: "#07142f",
  border: "1px solid rgba(125, 164, 255, 0.28)",
  borderRadius: 8,
  color: "#e6efff",
  fontSize: 11,
};

const severityTone: Record<string, "bad" | "warn" | "default"> = {
  critical: "bad",
  warning: "warn",
  notice: "default",
};

const severityLabel: Record<string, string> = {
  critical: "치명",
  warning: "경고",
  notice: "알림",
};

const gradeToneClass: Record<string, string> = {
  good: "text-emerald-300",
  cyan: "text-cyan-300",
  warn: "text-amber-300",
  bad: "text-rose-300",
  default: "text-slate-300",
};

function scoreColor(score: number | null) {
  if (score === null) return "#64748b";
  if (score >= 90) return "#34d399";
  if (score >= 75) return "#22d3ee";
  if (score >= 60) return "#fbbf24";
  return "#fb7185";
}

function HealthGauge({ score, label }: { score: number | null; label: string }) {
  const safe = score ?? 0;
  const available = score !== null;
  const color = scoreColor(score);
  const data = [{ value: safe }, { value: 100 - safe }];

  return (
    <div className="relative h-40" role="img" aria-label={`${label} ${available ? `${safe}점` : "미측정"}`}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" cx="50%" cy="78%" startAngle={180} endAngle={0} innerRadius="58%" outerRadius="82%" stroke="none" isAnimationActive={available}>
            <Cell fill={available ? color : "#26344f"} />
            <Cell fill="#1b2945" />
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-x-0 bottom-2 text-center">
        <p className="text-3xl font-bold text-white">{available ? safe : "—"}</p>
        <p className="text-xs text-slate-500">{label}</p>
      </div>
    </div>
  );
}

export function SiteAuditBriefing({
  campaignName,
  domain,
  lastRunAt,
  briefing,
  loading,
}: {
  campaignName: string;
  domain: string;
  lastRunAt: string | null;
  briefing: SiteAuditBriefingData | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <Card className="mt-5 border-cyan-400/15">
        <EmptyState>분석 브리핑을 불러오는 중…</EmptyState>
      </Card>
    );
  }

  if (!briefing) return null;

  if (!briefing.ready) {
    return (
      <Card className="mt-5 border-white/8">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-slate-800"><FileSearch className="h-5 w-5 text-slate-400" /></span>
          <div>
            <h3 className="font-semibold text-white">{campaignName}</h3>
            <p className="mt-1 text-sm text-slate-400">{domain} · 아직 크롤 결과가 없습니다.</p>
            <p className="mt-2 text-xs text-slate-500">크롤 실행 후 건강 점수 산출 근거와 이슈 브리핑이 여기에 표시됩니다.</p>
          </div>
        </div>
      </Card>
    );
  }

  const factorChart = briefing.scoreFactors
    .filter((factor) => factor.kind !== "total")
    .map((factor) => ({
      name: factor.label,
      value: Math.abs(factor.points),
      fill: factor.kind === "base" ? "#22d3ee" : "#fb7185",
      signed: factor.points,
    }));

  const severityChart = Object.entries(briefing.severityCounts).map(([severity, count]) => ({
    name: severityLabel[severity] ?? severity,
    count,
    fill: severity === "critical" ? "#fb7185" : severity === "warning" ? "#fbbf24" : "#94a3b8",
  }));

  return (
    <div className="mt-5 space-y-5">
      <Card className="border-cyan-400/15 bg-gradient-to-br from-slate-900/90 to-cyan-950/20">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Sparkles className="h-4 w-4 text-cyan-300" />
              <h3 className="text-lg font-semibold text-white">{campaignName} · 분석 브리핑</h3>
              <Badge tone={briefing.grade.tone}>{briefing.grade.label}</Badge>
            </div>
            <p className="mt-2 text-sm text-slate-400">{domain} · {lastRunAt ? new Date(lastRunAt).toLocaleString("ko-KR") : "—"} 수집</p>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300">{briefing.narratives[0]}</p>
          </div>
          <div className="w-full max-w-xs shrink-0 rounded-xl border border-white/8 bg-slate-950/50 p-3">
            <HealthGauge score={briefing.score} label="사이트 건강 점수" />
            <p className={cn("text-center text-sm font-semibold", gradeToneClass[briefing.grade.tone] ?? "text-slate-300")}>
              {briefing.grade.label} · {briefing.pageCount}페이지 · 이슈 {briefing.issueCount}건
            </p>
          </div>
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <h4 className="mb-4 text-sm font-semibold text-white">점수 산출 근거</h4>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={factorChart} layout="vertical" margin={{ left: 8, right: 8, top: 4, bottom: 4 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" horizontal={false} />
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" width={120} tick={{ fill: "#94a3b8", fontSize: 11 }} />
                  <Tooltip
                    contentStyle={chartTooltip}
                    formatter={(value, _name, item) => {
                      const signed = (item.payload as { signed: number }).signed;
                      return [`${signed > 0 ? "+" : ""}${signed}점`, "영향"];
                    }}
                  />
                  <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                    {factorChart.map((entry) => <Cell key={entry.name} fill={entry.fill} />)}
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
          <h4 className="mb-4 text-sm font-semibold text-white">5축 진단 레이더</h4>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={briefing.radar} outerRadius="72%">
                <PolarGrid stroke="rgba(255,255,255,0.08)" />
                <PolarAngleAxis dataKey="axis" tick={{ fill: "#94a3b8", fontSize: 10 }} />
                <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} axisLine={false} />
                <Radar dataKey="score" stroke="#22d3ee" fill="#22d3ee" fillOpacity={0.25} />
                <Tooltip contentStyle={chartTooltip} formatter={(value) => [`${value ?? 0}점`, "점수"]} labelFormatter={(_label, payload) => (payload?.[0]?.payload as { hint?: string } | undefined)?.hint ?? ""} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card>
          <h4 className="mb-4 text-sm font-semibold text-white">크롤 깊이 분포</h4>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={briefing.depthBuckets}>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="depth" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fill: "#64748b", fontSize: 10 }} />
                <Tooltip contentStyle={chartTooltip} />
                <Bar dataKey="count" fill="#a78bfa" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <h4 className="mb-4 text-sm font-semibold text-white">이슈 심각도</h4>
          {severityChart.length === 0 ? (
            <EmptyState>발견된 이슈가 없습니다.</EmptyState>
          ) : (
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={severityChart}>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fill: "#64748b", fontSize: 10 }} />
                  <Tooltip contentStyle={chartTooltip} />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                    {severityChart.map((entry) => <Cell key={entry.name} fill={entry.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card>
          <h4 className="mb-4 text-sm font-semibold text-white">AI 검색 신호</h4>
          <div className="space-y-4">
            <div>
              <div className="mb-1 flex justify-between text-xs"><span className="text-slate-500">llms.txt</span><span className={briefing.hasLlmsTxt ? "text-emerald-300" : "text-rose-300"}>{briefing.hasLlmsTxt ? "발견" : "미발견"}</span></div>
              <Progress value={briefing.hasLlmsTxt ? 100 : 35} ariaLabel="llms.txt 준비도" />
            </div>
            <div>
              <div className="mb-1 flex justify-between text-xs"><span className="text-slate-500">크롤 범위</span><span className="text-cyan-300">{briefing.pageCount} URL</span></div>
              <Progress value={Math.min(100, briefing.pageCount * 10)} ariaLabel="크롤 범위" />
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <div className="mb-4 flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-300" /><h4 className="text-sm font-semibold text-white">왜 이 점수인가 — 핵심 근거</h4></div>
          <ul className="space-y-3">
            {briefing.narratives.map((line, index) => (
              <li key={index} className="rounded-lg border border-white/6 bg-slate-950/35 px-3 py-2.5 text-sm leading-6 text-slate-300">{line}</li>
            ))}
          </ul>
        </Card>

        <Card>
          <div className="mb-4 flex items-center gap-2"><Lightbulb className="h-4 w-4 text-cyan-300" /><h4 className="text-sm font-semibold text-white">우선 개선 액션</h4></div>
          {briefing.recommendations.length === 0 ? (
            <EmptyState>추가 권장 사항이 없습니다.</EmptyState>
          ) : (
            <ol className="space-y-2">
              {briefing.recommendations.map((item, index) => (
                <li key={item} className="flex gap-3 rounded-lg border border-cyan-400/10 bg-cyan-400/5 px-3 py-2.5 text-sm text-slate-300">
                  <span className="font-bold text-cyan-300">{index + 1}.</span>
                  <span>{item}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <h4 className="mb-4 text-sm font-semibold text-white">발견 이슈</h4>
          {briefing.issues.length === 0 ? (
            <EmptyState>이슈가 없습니다.</EmptyState>
          ) : (
            <ul className="space-y-2">
              {briefing.issues.map((issue) => (
                <li key={issue.id} className="rounded-lg border border-white/6 bg-slate-950/35 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={severityTone[issue.severity] ?? "default"}>{severityLabel[issue.severity] ?? issue.severity}</Badge>
                    <span className="text-sm font-medium text-white">{issue.title}</span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-slate-400">{issue.detail}</p>
                  <p className="mt-1 truncate text-[11px] text-slate-600">{issue.url}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h4 className="mb-4 text-sm font-semibold text-white">수집 URL 샘플</h4>
          <ul className="max-h-72 space-y-1 overflow-y-auto text-xs">
            {briefing.pages.map((page) => (
              <li key={page.url} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-white/5">
                <Badge tone="default">d{page.depth}</Badge>
                <span className="truncate text-slate-400">{page.url}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
