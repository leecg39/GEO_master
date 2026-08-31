import { desc, eq } from "drizzle-orm";
import { getDatabase } from "./db";
import { audits, measureResults, measureRuns } from "./db/schema";
import { AppError } from "./errors";
import type { AuditItemResult } from "./audit";

export type ReportKind = "audit" | "share";

function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

export function buildAuditReport(id?: number) {
  const { orm } = getDatabase();
  const row = id
    ? orm.select().from(audits).where(eq(audits.id, id)).get()
    : orm.select().from(audits).orderBy(desc(audits.createdAt)).limit(1).get();
  if (!row) throw new AppError("내보낼 진단 결과가 없습니다.", 404, "REPORT_NOT_FOUND");
  const items = parseJson<AuditItemResult[]>(row.items, []);
  const categoryMap = new Map<string, { passed: number; total: number }>();
  for (const item of items) {
    const entry = categoryMap.get(item.category) ?? { passed: 0, total: 0 };
    entry.total += 1;
    if (item.passed) entry.passed += 1;
    categoryMap.set(item.category, entry);
  }
  return {
    schemaVersion: 1,
    kind: "audit" as const,
    generatedAt: new Date().toISOString(),
    audit: {
      id: row.id,
      url: row.url,
      score: row.score,
      total: items.length,
      grade: row.grade,
      createdAt: row.createdAt,
      metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
      categories: [...categoryMap.entries()].map(([category, score]) => ({ category, ...score })),
      items,
    },
  };
}

export function buildShareReport(id?: number) {
  const { orm } = getDatabase();
  const run = id
    ? orm.select().from(measureRuns).where(eq(measureRuns.id, id)).get()
    : orm.select().from(measureRuns).where(eq(measureRuns.status, "completed")).orderBy(desc(measureRuns.createdAt)).limit(1).get();
  if (!run) throw new AppError("내보낼 응답 점유율 결과가 없습니다.", 404, "REPORT_NOT_FOUND");
  if (run.status !== "completed") throw new AppError("완료된 응답 점유율 측정만 내보낼 수 있습니다.", 409, "REPORT_NOT_READY");
  const results = orm.select().from(measureResults).where(eq(measureResults.runId, run.id)).all().map((row) => ({
    question: row.questionText,
    provider: row.provider,
    model: row.model,
    repetition: row.repetition,
    response: row.response,
    brandMentioned: row.brandMentioned,
    sentiment: row.sentiment,
    mentionRank: row.mentionRank,
    competitorMentions: parseJson<string[]>(row.competitorMentions, []),
    createdAt: row.createdAt,
  }));
  return {
    schemaVersion: 1,
    kind: "share" as const,
    generatedAt: new Date().toISOString(),
    run: {
      id: run.id,
      status: run.status,
      models: parseJson<unknown[]>(run.models, []),
      repetitions: run.repetitions,
      totalQueries: run.totalQueries,
      answerShare: run.answerShare,
      genrank: run.genrank,
      funnelStage: run.funnelStage,
      summary: parseJson<Record<string, unknown>>(run.summary, {}),
      createdAt: run.createdAt,
      completedAt: run.completedAt,
      results,
    },
  };
}

function csvCell(value: unknown) {
  let text = value == null ? "" : typeof value === "string" ? value : JSON.stringify(value);
  if (/^[\t\r\n ]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function reportToCsv(report: ReturnType<typeof buildAuditReport> | ReturnType<typeof buildShareReport>) {
  const rows: unknown[][] = report.kind === "audit"
    ? [
        ["audit_id", "url", "score", "total", "grade", "created_at", "category", "code", "label", "passed", "manual", "detail", "recommendation"],
        ...report.audit.items.map((item) => [report.audit.id, report.audit.url, report.audit.score, report.audit.total, report.audit.grade, report.audit.createdAt, item.category, item.code, item.label, item.passed, item.manual, item.detail, item.recommendation]),
      ]
    : [
        ["run_id", "answer_share", "genrank", "funnel_stage", "created_at", "question", "provider", "model", "repetition", "brand_mentioned", "sentiment", "mention_rank", "competitors", "response"],
        ...report.run.results.map((item) => [report.run.id, report.run.answerShare, report.run.genrank, report.run.funnelStage, report.run.createdAt, item.question, item.provider, item.model, item.repetition, item.brandMentioned, item.sentiment, item.mentionRank, item.competitorMentions.join(" | "), item.response]),
      ];
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export function reportFilename(kind: ReportKind, id: number, format: "json" | "csv") {
  const date = new Date().toISOString().slice(0, 10);
  return `geo-${kind}-${id}-${date}.${format}`;
}
