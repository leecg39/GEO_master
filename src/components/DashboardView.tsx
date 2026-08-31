"use client";

import Link from "next/link";
import { ArrowRight, CalendarCheck, CheckCircle2, Circle, Radar, SearchCheck, Sparkles, Target } from "lucide-react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge, Card, EmptyState, Progress } from "@/components/ui";
import { formatDate } from "@/lib/utils";

interface DashboardData {
  funnel: { stage: string; stages: string[]; answerShare: number; genrank: number; measuredAt: string | null };
  trends: { month: string; overall: number; openai: number | null; anthropic: number | null; gemini: number | null }[];
  latestAudit: { id: number; url: string; score: number; grade: string; createdAt: string } | null;
  checklist: { completed: number; total: number; percent: number };
  cycle: { week: number; label: string; done: boolean }[];
  recentRuns: { id: number; answerShare: number; genrank: number; funnelStage: string; createdAt: string }[];
}

const stageDescriptions: Record<string, string> = {
  "존재": "AI가 브랜드를 인지하도록 엔티티 기반을 만드세요.",
  "맥락": "브랜드가 어떤 문제를 해결하는지 문맥을 정렬하세요.",
  "시의성": "최신 근거와 수정일을 열린 웹에 갱신하세요.",
  "추천": "구체적인 추천 조건에서 선택될 근거를 강화하세요.",
};

export function DashboardView({ data }: { data: DashboardData }) {
  const activeIndex = data.funnel.stages.indexOf(data.funnel.stage);
  return (
    <div>
      <div className="mb-8 flex flex-col justify-between gap-5 md:flex-row md:items-end">
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.22em] text-cyan-400">Command center</p>
          <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">브랜드가 AI 답변에서<br className="hidden sm:block" /> 선택되는 과정을 관리하세요.</h1>
          <p className="mt-3 text-sm text-slate-400">마지막 측정 {formatDate(data.funnel.measuredAt)}</p>
        </div>
        <Link href="/share" className="inline-flex items-center gap-2 self-start rounded-xl bg-cyan-400 px-4 py-2.5 text-sm font-bold text-slate-950 hover:bg-cyan-300">새 측정 실행 <ArrowRight className="h-4 w-4" /></Link>
      </div>

      <Card className="relative overflow-hidden border-cyan-400/12 bg-gradient-to-br from-cyan-400/[0.07] via-slate-900/70 to-violet-500/[0.06]">
        <div className="absolute -right-14 -top-16 h-56 w-56 rounded-full bg-cyan-400/5 blur-3xl" />
        <div className="relative flex flex-col gap-6 xl:flex-row xl:items-center xl:justify-between">
          <div className="max-w-md"><Badge tone="cyan">현재 퍼널 · {data.funnel.stage}</Badge><h2 className="mt-4 text-2xl font-semibold text-white">{stageDescriptions[data.funnel.stage]}</h2></div>
          <div className="grid flex-1 grid-cols-4 gap-2 xl:max-w-3xl">
            {data.funnel.stages.map((stage, index) => <div key={stage} className="relative">
              <div className={`rounded-xl border p-3 text-center transition ${index <= activeIndex ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-200" : "border-white/7 bg-slate-950/30 text-slate-600"}`}>
                <div className="mx-auto mb-2 grid h-7 w-7 place-items-center rounded-full border border-current text-xs font-bold">{index + 1}</div><span className="text-xs font-bold sm:text-sm">{stage}</span>
              </div>
              {index < 3 && <span className="absolute -right-2.5 top-1/2 z-10 hidden h-px w-3 bg-slate-700 sm:block" />}
            </div>)}
          </div>
        </div>
      </Card>

      <section className="mt-5 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <Card><div className="flex items-center justify-between"><span className="text-sm text-slate-400">응답 점유율</span><Radar className="h-5 w-5 text-cyan-400" /></div><strong className="mt-4 block text-3xl text-white">{data.funnel.answerShare.toFixed(1)}%</strong><p className="mt-1 text-xs text-slate-500">브랜드 언급 / 전체 응답</p></Card>
        <Card><div className="flex items-center justify-between"><span className="text-sm text-slate-400">GenRank</span><Sparkles className="h-5 w-5 text-violet-400" /></div><strong className="mt-4 block text-3xl text-white">{data.funnel.genrank.toFixed(1)}</strong><p className="mt-1 text-xs text-slate-500">모델 가중·순위 할인 지수</p></Card>
        <Card><div className="flex items-center justify-between"><span className="text-sm text-slate-400">최근 진단</span><SearchCheck className="h-5 w-5 text-emerald-400" /></div><strong className="mt-4 block text-3xl text-white">{data.latestAudit ? `${data.latestAudit.score}/32` : "—"}</strong><p className="mt-1 text-xs text-slate-500">{data.latestAudit?.grade ?? "진단을 실행해 보세요"}</p></Card>
        <Card><div className="flex items-center justify-between"><span className="text-sm text-slate-400">실행 체크</span><Target className="h-5 w-5 text-amber-400" /></div><strong className="mt-4 block text-3xl text-white">{data.checklist.percent}%</strong><Progress value={data.checklist.percent} className="mt-3" /></Card>
      </section>

      <section className="mt-5 grid gap-5 xl:grid-cols-[1.55fr_0.85fr]">
        <Card><div className="mb-5 flex items-center justify-between"><div><h2 className="font-semibold text-white">모델별 응답 점유율 추이</h2><p className="mt-1 text-xs text-slate-500">월별 측정 평균 · %</p></div><Badge>최근 12개월</Badge></div>
          {data.trends.length ? <div className="h-72"><ResponsiveContainer width="100%" height="100%"><LineChart data={data.trends} margin={{ left: -18, right: 10, top: 10 }}><CartesianGrid stroke="#1e293b" strokeDasharray="4 4" vertical={false} /><XAxis dataKey="month" stroke="#64748b" tick={{ fontSize: 11 }} /><YAxis domain={[0, 100]} stroke="#64748b" tick={{ fontSize: 11 }} /><Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 12, fontSize: 12 }} /><Legend wrapperStyle={{ fontSize: 11 }} /><Line type="monotone" dataKey="overall" name="전체" stroke="#22d3ee" strokeWidth={3} dot={false} connectNulls /><Line type="monotone" dataKey="openai" name="GPT" stroke="#34d399" strokeWidth={2} dot={false} connectNulls /><Line type="monotone" dataKey="anthropic" name="Claude" stroke="#f59e0b" strokeWidth={2} dot={false} connectNulls /><Line type="monotone" dataKey="gemini" name="Gemini" stroke="#a78bfa" strokeWidth={2} dot={false} connectNulls /></LineChart></ResponsiveContainer></div> : <EmptyState>첫 응답 점유율 측정 후 모델별 추이가 표시됩니다.</EmptyState>}
        </Card>
        <Card><div className="mb-5 flex items-center gap-3"><CalendarCheck className="h-5 w-5 text-cyan-400" /><div><h2 className="font-semibold text-white">4주 모니터링 사이클</h2><p className="text-xs text-slate-500">매월 반복하는 개선 루프</p></div></div><div className="space-y-3">{data.cycle.map((item) => <div key={item.week} className="flex items-center gap-3 rounded-xl bg-slate-950/45 p-3">{item.done ? <CheckCircle2 className="h-5 w-5 text-emerald-400" /> : <Circle className="h-5 w-5 text-slate-600" />}<span className={item.done ? "text-sm text-slate-300" : "text-sm text-slate-500"}>{item.label}</span></div>)}</div><Link href="/strategy" className="mt-5 inline-flex items-center gap-2 text-xs font-bold text-cyan-300">사이클 관리 <ArrowRight className="h-3.5 w-3.5" /></Link></Card>
      </section>
    </div>
  );
}
