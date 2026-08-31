import { desc, eq } from "drizzle-orm";
import { getDatabase } from "./db";
import { audits, checklistStates, measureRuns, strategyItems } from "./db/schema";
import type { Provider } from "./settings";

const cycleLabels = ["1주차 · 모니터링", "2주차 · 분석", "3주차 · 우선순위", "4주차 · 콘텐츠 개선"];

type TrendRun = Pick<typeof measureRuns.$inferSelect, "createdAt" | "answerShare" | "summary">;
interface ShareSummary {
  total?: number;
  mentions?: number;
  perModel?: Partial<Record<Provider, { share?: number; total: number; mentions?: number }>>;
}

export function aggregateMonthlyTrends(runs: TrendRun[]) {
  const monthly = new Map<string, {
    total: number;
    mentions: number;
    providers: Record<Provider, { total: number; mentions: number }>;
  }>();
  for (const run of runs.toReversed()) {
    const month = run.createdAt.slice(0, 7);
    const entry = monthly.get(month) ?? {
      total: 0,
      mentions: 0,
      providers: {
        openai: { total: 0, mentions: 0 },
        anthropic: { total: 0, mentions: 0 },
        gemini: { total: 0, mentions: 0 },
      },
    };
    let summary: ShareSummary = {};
    try { summary = JSON.parse(run.summary) as ShareSummary; } catch { /* 이전 손상 데이터는 아래 호환 폴백으로 집계한다. */ }
    const total = typeof summary.total === "number" && summary.total > 0 ? summary.total : 1;
    const mentions = typeof summary.mentions === "number" ? summary.mentions : run.answerShare / 100;
    entry.total += total;
    entry.mentions += Math.max(0, Math.min(total, mentions));
    for (const provider of ["openai", "anthropic", "gemini"] as const) {
      const model = summary.perModel?.[provider];
      if (!model?.total) continue;
      entry.providers[provider].total += model.total;
      entry.providers[provider].mentions += typeof model.mentions === "number"
        ? model.mentions
        : (model.share ?? 0) * model.total / 100;
    }
    monthly.set(month, entry);
  }
  return [...monthly.entries()].slice(-12).map(([month, entry]) => ({
    month,
    overall: entry.total ? Number(((entry.mentions / entry.total) * 100).toFixed(1)) : 0,
    ...Object.fromEntries((["openai", "anthropic", "gemini"] as const).map((provider) => {
      const model = entry.providers[provider];
      return [provider, model.total ? Number(((model.mentions / model.total) * 100).toFixed(1)) : null];
    })) as Record<Provider, number | null>,
  }));
}

export function getDashboardData() {
  const { orm } = getDatabase();
  const runs = orm.select().from(measureRuns)
    .where(eq(measureRuns.status, "completed"))
    .orderBy(desc(measureRuns.createdAt))
    .limit(100)
    .all();
  const latestRun = runs[0] ?? null;
  const latestAudit = orm.select().from(audits).orderBy(desc(audits.createdAt)).limit(1).get() ?? null;
  const checklist = orm.select().from(checklistStates).where(eq(checklistStates.scope, "learn-38")).all();
  const cycleRows = orm.select().from(strategyItems).where(eq(strategyItems.type, "cycle")).all();

  const trends = aggregateMonthlyTrends(runs);

  const cycle = cycleLabels.map((label, index) => {
    const row = cycleRows.find((item) => {
      try { return (JSON.parse(item.data) as { week?: number }).week === index + 1; } catch { return false; }
    });
    return { week: index + 1, label, done: row?.status === "완료" };
  });

  return {
    funnel: {
      stage: latestRun?.funnelStage ?? "존재",
      stages: ["존재", "맥락", "시의성", "추천"],
      answerShare: latestRun?.answerShare ?? 0,
      genrank: latestRun?.genrank ?? 0,
      measuredAt: latestRun?.completedAt ?? null,
    },
    trends,
    latestAudit: latestAudit ? {
      id: latestAudit.id,
      url: latestAudit.url,
      score: latestAudit.score,
      grade: latestAudit.grade,
      createdAt: latestAudit.createdAt,
    } : null,
    checklist: {
      completed: checklist.filter((item) => item.checked).length,
      total: 38,
      percent: Math.round((checklist.filter((item) => item.checked).length / 38) * 100),
    },
    cycle,
    recentRuns: runs.slice(0, 5).map((run) => ({
      id: run.id,
      answerShare: run.answerShare,
      genrank: run.genrank,
      funnelStage: run.funnelStage,
      createdAt: run.createdAt,
    })),
  };
}
