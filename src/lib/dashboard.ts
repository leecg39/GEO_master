import { desc, eq, inArray } from "drizzle-orm";
import { getDatabase } from "./db";
import { audits, checklistStates, measureResults, measureRuns, projects, strategyItems } from "./db/schema";
import { providers, type Provider } from "./settings";

const cycleLabels = ["1주차 · 모니터링", "2주차 · 분석", "3주차 · 우선순위", "4주차 · 콘텐츠 개선"];

type TrendRun = Pick<typeof measureRuns.$inferSelect, "createdAt" | "answerShare" | "summary">;
export type QuestionMetricInput = Pick<typeof measureResults.$inferSelect, "questionText" | "provider" | "brandMentioned" | "sentiment" | "mentionRank">;
interface ModelSummary { share?: number; total?: number; mentions?: number }
interface ShareSummary {
  total?: number;
  mentions?: number;
  positiveRate?: number;
  perModel?: Partial<Record<Provider, ModelSummary>>;
  competitorComparison?: { name?: string; share?: number; mentions?: number }[];
}

function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function numeric(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function parseDashboardSummary(value?: string): ShareSummary {
  const raw = asRecord(value ? parseJson<unknown>(value, {}) : {});
  const rawModels = asRecord(raw.perModel);
  const perModel: Partial<Record<Provider, ModelSummary>> = {};
  for (const provider of providers) {
    const model = asRecord(rawModels[provider]);
    if (!Object.keys(model).length) continue;
    perModel[provider] = {
      share: numeric(model.share),
      total: Math.max(0, numeric(model.total)),
      mentions: Math.max(0, numeric(model.mentions)),
    };
  }
  const competitorComparison = Array.isArray(raw.competitorComparison)
    ? raw.competitorComparison.map((value) => {
        const item = asRecord(value);
        return { name: String(item.name ?? "경쟁사"), share: numeric(item.share), mentions: Math.max(0, numeric(item.mentions)) };
      })
    : [];
  return {
    total: raw.total === undefined ? undefined : Math.max(0, numeric(raw.total)),
    mentions: raw.mentions === undefined ? undefined : Math.max(0, numeric(raw.mentions)),
    positiveRate: raw.positiveRate === undefined ? undefined : Math.max(0, Math.min(100, numeric(raw.positiveRate))),
    perModel,
    competitorComparison,
  };
}

function summarizeQuestionRows(rows: QuestionMetricInput[]) {
  const mentioned = rows.filter((row) => row.brandMentioned);
  const ranked = mentioned.filter((row) => typeof row.mentionRank === "number");
  return {
    total: rows.length,
    mentions: mentioned.length,
    share: rows.length ? Number(((mentioned.length / rows.length) * 100).toFixed(1)) : 0,
    averageRank: ranked.length ? Number((ranked.reduce((sum, row) => sum + (row.mentionRank ?? 0), 0) / ranked.length).toFixed(1)) : null,
    positiveRate: mentioned.length ? Number(((mentioned.filter((row) => row.sentiment === "positive").length / mentioned.length) * 100).toFixed(1)) : 0,
  };
}

export function aggregateQuestionPerformance(currentRows: QuestionMetricInput[], previousRows: QuestionMetricInput[] = []) {
  const current = new Map<string, QuestionMetricInput[]>();
  const previous = new Map<string, QuestionMetricInput[]>();
  for (const row of currentRows) current.set(row.questionText, [...(current.get(row.questionText) ?? []), row]);
  for (const row of previousRows) previous.set(row.questionText, [...(previous.get(row.questionText) ?? []), row]);
  return [...current.entries()].map(([text, rows]) => {
    const metric = summarizeQuestionRows(rows);
    const previousMetric = previous.has(text) ? summarizeQuestionRows(previous.get(text)!) : null;
    return {
      text,
      ...metric,
      previousShare: previousMetric?.share ?? null,
      delta: previousMetric ? Number((metric.share - previousMetric.share).toFixed(1)) : null,
    };
  });
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
      providers: Object.fromEntries(providers.map((provider) => [provider, { total: 0, mentions: 0 }])) as Record<Provider, { total: number; mentions: number }>,
    };
    const summary = parseDashboardSummary(run.summary);
    const total = typeof summary.total === "number" && summary.total > 0 ? summary.total : 1;
    const mentions = typeof summary.mentions === "number" ? summary.mentions : run.answerShare / 100;
    entry.total += total;
    entry.mentions += Math.max(0, Math.min(total, mentions));
    for (const provider of providers) {
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
    ...Object.fromEntries(providers.map((provider) => {
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
  const previousRun = runs[1] ?? null;
  const detailRuns = runs.slice(0, 12);
  const runIds = detailRuns.map((run) => run.id);
  const resultRows = runIds.length
    ? orm.select({
        runId: measureResults.runId,
        questionText: measureResults.questionText,
        provider: measureResults.provider,
        brandMentioned: measureResults.brandMentioned,
        sentiment: measureResults.sentiment,
        mentionRank: measureResults.mentionRank,
      }).from(measureResults).where(inArray(measureResults.runId, runIds)).orderBy(measureResults.id).all()
    : [];
  const latestRows = latestRun ? resultRows.filter((row) => row.runId === latestRun.id) : [];
  const previousRows = previousRun ? resultRows.filter((row) => row.runId === previousRun.id) : [];
  const latestAudit = orm.select().from(audits).orderBy(desc(audits.createdAt)).limit(1).get() ?? null;
  const checklist = orm.select().from(checklistStates).where(eq(checklistStates.scope, "learn-38")).all();
  const cycleRows = orm.select().from(strategyItems).where(eq(strategyItems.type, "cycle")).all();
  const project = latestRun?.projectId
    ? orm.select().from(projects).where(eq(projects.id, latestRun.projectId)).get()
    : orm.select().from(projects).orderBy(desc(projects.updatedAt)).limit(1).get();

  const trends = aggregateMonthlyTrends(runs);
  const latestSummary = parseDashboardSummary(latestRun?.summary);
  const previousSummary = parseDashboardSummary(previousRun?.summary);
  const fallbackCurrentModels = Object.fromEntries(providers.map((provider) => {
    const rows = latestRows.filter((row) => row.provider === provider);
    return [provider, summarizeQuestionRows(rows)];
  })) as Record<Provider, ReturnType<typeof summarizeQuestionRows>>;
  const fallbackPreviousModels = Object.fromEntries(providers.map((provider) => {
    const rows = previousRows.filter((row) => row.provider === provider);
    return [provider, summarizeQuestionRows(rows)];
  })) as Record<Provider, ReturnType<typeof summarizeQuestionRows>>;

  const models = providers.map((provider) => {
    const current = latestSummary.perModel?.[provider];
    const previous = previousSummary.perModel?.[provider];
    const share = current?.total ? current.share ?? 0 : fallbackCurrentModels[provider].share;
    const previousShare = previous?.total ? previous.share ?? 0 : previousRun ? fallbackPreviousModels[provider].share : null;
    return {
      provider,
      share: Number(share.toFixed(1)),
      previousShare: previousShare === null ? null : Number(previousShare.toFixed(1)),
      delta: previousShare === null ? null : Number((share - previousShare).toFixed(1)),
      mentions: current?.mentions ?? fallbackCurrentModels[provider].mentions,
      total: current?.total ?? fallbackCurrentModels[provider].total,
    };
  });

  const rowsByRunQuestion = new Map<string, QuestionMetricInput[]>();
  for (const row of resultRows) {
    const key = `${row.runId}\u0000${row.questionText}`;
    rowsByRunQuestion.set(key, [...(rowsByRunQuestion.get(key) ?? []), row]);
  }
  const questions = aggregateQuestionPerformance(latestRows, previousRows).map((question) => ({
    ...question,
    models: providers.map((provider) => {
      const rows = latestRows.filter((row) => row.questionText === question.text && row.provider === provider);
      return { provider, ...summarizeQuestionRows(rows) };
    }),
    trends: detailRuns.toReversed().flatMap((run) => {
      const rows = rowsByRunQuestion.get(`${run.id}\u0000${question.text}`);
      if (!rows?.length) return [];
      const overall = summarizeQuestionRows(rows);
      return [{
        runId: run.id,
        label: run.createdAt.slice(5, 10),
        overall: overall.share,
        ...Object.fromEntries(providers.map((provider) => {
          const providerRows = rows.filter((row) => row.provider === provider);
          return [provider, providerRows.length ? summarizeQuestionRows(providerRows).share : null];
        })) as Record<Provider, number | null>,
      }];
    }),
  }));

  const cycle = cycleLabels.map((label, index) => {
    const row = cycleRows.find((item) => {
      try { return (JSON.parse(item.data) as { week?: number }).week === index + 1; } catch { return false; }
    });
    return { week: index + 1, label, done: row?.status === "완료" };
  });
  const auditItems = latestAudit ? parseJson<unknown[]>(latestAudit.items, []) : [];
  const positiveRate = typeof latestSummary.positiveRate === "number"
    ? latestSummary.positiveRate
    : summarizeQuestionRows(latestRows).positiveRate;

  return {
    project: {
      name: project?.name || project?.brandName || "GEO Master",
      brandName: project?.brandName || "브랜드 미설정",
      category: project?.category || "카테고리 미설정",
      recentRunCount: runs.length,
      questionCount: questions.length,
      modelCount: models.filter((model) => model.total > 0).length,
    },
    funnel: {
      stage: latestRun?.funnelStage ?? "존재",
      stages: ["존재", "맥락", "시의성", "추천"],
      answerShare: latestRun?.answerShare ?? 0,
      genrank: latestRun?.genrank ?? 0,
      measuredAt: latestRun?.completedAt ?? null,
    },
    overview: {
      answerShareDelta: previousRun ? Number(((latestRun?.answerShare ?? 0) - previousRun.answerShare).toFixed(1)) : null,
      genrankDelta: previousRun ? Number(((latestRun?.genrank ?? 0) - previousRun.genrank).toFixed(1)) : null,
      positiveRate: Number(positiveRate.toFixed(1)),
      totalResponses: latestRows.length,
      competitors: (latestSummary.competitorComparison ?? []).map((item) => ({
        name: String(item.name ?? "경쟁사"),
        share: Number((item.share ?? 0).toFixed(1)),
        mentions: item.mentions ?? 0,
      })).slice(0, 4),
    },
    trends,
    runTrends: detailRuns.toReversed().map((run) => {
      const summary = parseDashboardSummary(run.summary);
      return {
        runId: run.id,
        label: run.createdAt.slice(5, 10),
        overall: run.answerShare,
        ...Object.fromEntries(providers.map((provider) => [provider, summary.perModel?.[provider]?.total ? summary.perModel[provider]?.share ?? null : null])) as Record<Provider, number | null>,
      };
    }),
    models,
    questions,
    latestAudit: latestAudit ? {
      id: latestAudit.id,
      url: latestAudit.url,
      score: latestAudit.score,
      total: auditItems.length || 32,
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

export type DashboardData = ReturnType<typeof getDashboardData>;
