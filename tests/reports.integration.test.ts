import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDatabase, closeDatabase } from "@/lib/db";
import { audits, measureResults, measureRuns } from "@/lib/db/schema";
import { buildAuditReport, buildShareReport, reportToCsv } from "@/lib/reports";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-report-test-"));
const databasePath = path.join(tempDir, "geo.db");
const previousDb = process.env.GEO_DB_PATH;
let auditId = 0; let runId = 0; let failedRunId = 0;
beforeAll(() => {
  process.env.GEO_DB_PATH = databasePath;
  const { orm } = getDatabase(); const now = "2026-09-01T00:00:00.000Z";
  auditId = orm.insert(audits).values({ url: "https://example.com", score: 1, grade: "개선 필요", items: JSON.stringify([{ code: "x", category: "기반 SEO", label: "=위험", passed: false, manual: false, detail: "+수식", recommendation: "수정" }]), metadata: "{}", createdAt: now }).returning({ id: audits.id }).get().id;
  runId = orm.insert(measureRuns).values({ status: "completed", models: "[]", repetitions: 1, totalQueries: 1, answerShare: 100, genrank: 100, funnelStage: "추천", summary: JSON.stringify({ total: 1, mentions: 1 }), createdAt: now, completedAt: now }).returning({ id: measureRuns.id }).get().id;
  failedRunId = orm.insert(measureRuns).values({ status: "failed", models: "[]", repetitions: 1, totalQueries: 1, answerShare: 0, genrank: 0, funnelStage: "존재", summary: JSON.stringify({ error: "LLM_REQUEST_FAILED" }), createdAt: now, completedAt: now }).returning({ id: measureRuns.id }).get().id;
  orm.insert(measureResults).values({ runId, questionText: " =SUM(A1)", provider: "openai", model: "test", repetition: 1, response: "@응답", brandMentioned: true, sentiment: "positive", mentionRank: 1, competitorMentions: "[]", createdAt: now }).run();
});
afterAll(() => { closeDatabase(databasePath); fs.rmSync(tempDir, { recursive: true, force: true }); if (previousDb === undefined) delete process.env.GEO_DB_PATH; else process.env.GEO_DB_PATH = previousDb; });

describe("portable reports", () => {
  it("builds an audit report with category totals", () => { const report = buildAuditReport(auditId); expect(report.audit).toMatchObject({ score: 1, total: 1, categories: [{ category: "기반 SEO", passed: 0, total: 1 }] }); });
  it("builds a share report with evidence rows", () => { const report = buildShareReport(runId); expect(report.run.results).toHaveLength(1); expect(report.run.results[0]).toMatchObject({ brandMentioned: true, mentionRank: 1 }); });
  it("rejects failed or incomplete share runs", () => { expect(() => buildShareReport(failedRunId)).toThrow(/완료된 응답 점유율 측정만/); });
  it("writes UTF-8 BOM CSV and neutralizes spreadsheet formulas", () => { const csv = reportToCsv(buildShareReport(runId)); expect(csv.startsWith("\uFEFF")).toBe(true); expect(csv).toContain("\"' =SUM(A1)\""); expect(csv).toContain("\"'@응답\""); });
});
