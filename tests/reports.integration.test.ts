import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET as getReport } from "@/app/api/reports/route";
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
  runId = orm.insert(measureRuns).values({ status: "completed", models: "[]", repetitions: 1, totalQueries: 2, answerShare: 100, genrank: 100, funnelStage: "추천", summary: JSON.stringify({ total: 1, mentions: 1 }), createdAt: now, completedAt: now }).returning({ id: measureRuns.id }).get().id;
  failedRunId = orm.insert(measureRuns).values({ status: "failed", models: "[]", repetitions: 1, totalQueries: 1, answerShare: 0, genrank: 0, funnelStage: "존재", summary: JSON.stringify({ error: "LLM_REQUEST_FAILED" }), createdAt: now, completedAt: now }).returning({ id: measureRuns.id }).get().id;
  orm.insert(measureResults).values([
    { runId, questionText: " =SUM(A1)", provider: "openai", model: "test", repetition: 1, response: "@응답", brandMentioned: true, sentiment: "positive", mentionRank: 1, competitorMentions: "[]", createdAt: now },
    { runId, questionText: "두 번째 질문", provider: "anthropic", model: "test", repetition: 1, response: "두 번째 응답", brandMentioned: false, sentiment: "neutral", mentionRank: null, competitorMentions: "[]", createdAt: now },
  ]).run();
});
afterAll(() => { closeDatabase(databasePath); fs.rmSync(tempDir, { recursive: true, force: true }); if (previousDb === undefined) delete process.env.GEO_DB_PATH; else process.env.GEO_DB_PATH = previousDb; });

describe("portable reports", () => {
  it("builds an audit report with category totals", () => { const report = buildAuditReport(auditId); expect(report.audit).toMatchObject({ score: 1, total: 1, categories: [{ category: "기반 SEO", passed: 0, total: 1 }] }); });
  it("builds a share report with evidence rows and applies only an explicit PDF limit", () => {
    const report = buildShareReport(runId);
    expect(report.run.results).toHaveLength(2);
    expect(report.run.results[0]).toMatchObject({ brandMentioned: true, mentionRank: 1 });
    expect(buildShareReport(runId, 1).run.results).toHaveLength(1);
  });
  it("rejects failed or incomplete share runs", () => { expect(() => buildShareReport(failedRunId)).toThrow(/완료된 응답 점유율 측정만/); });
  it("writes UTF-8 BOM CSV and neutralizes spreadsheet formulas", () => { const csv = reportToCsv(buildShareReport(runId)); expect(csv.startsWith("\uFEFF")).toBe(true); expect(csv).toContain("\"' =SUM(A1)\""); expect(csv).toContain("\"'@응답\""); });
  it("hardens JSON and CSV attachment responses without changing their formats", () => {
    for (const format of ["json", "csv"] as const) {
      const response = getReport(new NextRequest(`http://localhost/api/reports?type=audit&id=${auditId}&format=${format}`));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-disposition")).toContain(`.${format}`);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    }
  });
  it("returns stable route errors for incomplete, invalid, and missing reports", async () => {
    const incomplete = getReport(new NextRequest(`http://localhost/api/reports?type=share&id=${failedRunId}&format=pdf`));
    expect(incomplete.status).toBe(409);
    expect(await incomplete.json()).toMatchObject({ code: "REPORT_NOT_READY" });
    expect(incomplete.headers.get("cache-control")).toBe("no-store");
    expect(incomplete.headers.get("x-content-type-options")).toBe("nosniff");

    const invalid = getReport(new NextRequest(`http://localhost/api/reports?type=audit&id=${auditId}&format=xml`));
    expect(invalid.status).toBe(422);
    expect(await invalid.json()).toMatchObject({ code: "VALIDATION_ERROR" });

    const missing = getReport(new NextRequest("http://localhost/api/reports?type=audit&id=999999&format=pdf"));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ code: "REPORT_NOT_FOUND" });
  });
  it("serves a dedicated PDF attachment with hardened headers", async () => {
    const response = getReport(new NextRequest(`http://localhost/api/reports?type=audit&id=${auditId}&format=pdf`));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="geo-audit-/);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await response.arrayBuffer()).subarray(0, 8).toString("ascii")).toBe("%PDF-1.7");
  });
});
