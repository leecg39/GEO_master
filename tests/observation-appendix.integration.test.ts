import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importBotLog } from "@/lib/bot-logs/store";
import { closeDatabase, getDatabase } from "@/lib/db";
import { buildObservationAppendix } from "@/lib/observation-appendix";
import { importOutcomeCsv, upsertOutcomeDefinition } from "@/lib/outcomes/store";
import { activateProject, createProject, ensureActiveProject } from "@/lib/projects";
import { PDF_MAX_PAGES, reportToPdf } from "@/lib/report-pdf";
import { buildAuditReport, type PortableReport } from "@/lib/reports";
import { importConsoleExport } from "@/lib/search-console/store";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-appendix-"));
const databasePath = path.join(dir, "geo.db");
const prevDb = process.env.GEO_DB_PATH;
const prevKey = process.env.GEO_MASTER_KEY;
const emptyExport = fs.readFileSync(path.join(__dirname, "fixtures/search-console/empty-console-export.xlsx"));

function decodedText(pdf: Uint8Array) {
  const raw = Buffer.from(pdf).toString("latin1");
  return [...raw.matchAll(/<([0-9A-F]+)> Tj/g)].map((match) => {
    const source = Buffer.from(match[1]!, "hex");
    const target = Buffer.alloc(source.length);
    for (let index = 0; index < source.length; index += 2) { target[index] = source[index + 1]!; target[index + 1] = source[index]!; }
    return target.toString("utf16le");
  }).join("\n");
}

const auditReport = {
  schemaVersion: 1, kind: "audit", generatedAt: "2026-10-08T00:00:00.000Z",
  audit: { id: 1, url: "https://example.com", score: 1, total: 1, grade: "우수", createdAt: "2026-10-08T00:00:00.000Z", metadata: {}, categories: [], items: [] },
} as unknown as PortableReport;

beforeAll(() => {
  process.env.GEO_DB_PATH = databasePath;
  process.env.GEO_MASTER_KEY = "appendix-master-key-with-32-characters-xx";
  ensureActiveProject();
});
afterAll(() => {
  closeDatabase(databasePath);
  fs.rmSync(dir, { recursive: true, force: true });
  if (prevDb === undefined) delete process.env.GEO_DB_PATH; else process.env.GEO_DB_PATH = prevDb;
  if (prevKey === undefined) delete process.env.GEO_MASTER_KEY; else process.env.GEO_MASTER_KEY = prevKey;
});

describe("buildObservationAppendix", () => {
  it("marks every source as not connected (not zero) when nothing was imported", () => {
    const appendix = buildObservationAppendix();
    expect(appendix.searchConsole).toMatchObject({ status: "not_connected", source: expect.any(String), definition: expect.any(String), properties: [] });
    expect(appendix.botLogs).toMatchObject({ status: "not_connected", latest: null });
    expect(appendix.outcomes).toMatchObject({ status: "not_connected", sources: [] });
    expect(appendix.note).toMatch(/합치거나|인과/);
  });

  it("reports each source with its own definition, source and period, without mixing them", async () => {
    importConsoleExport({ fileName: "tiktok.xlsx", propertyLabel: "TikTok @a", buffer: emptyExport });
    await importBotLog({ fileName: "access.log", buffer: Buffer.from(`66.249.66.1 - - [08/Oct/2026:10:00:00 +0900] "GET / HTTP/1.1" 200 1 "-" "Googlebot/2.1"\n20.15.240.1 - - [09/Oct/2026:10:00:00 +0900] "GET / HTTP/1.1" 200 1 "-" "GPTBot/1.2"`), verifyDns: false });
    importOutcomeCsv({ fileName: "ga4.csv", sourceLabel: "GA4", buffer: Buffer.from("date,event name,event count\n2026-10-01,generate_lead,3\n2026-10-01,page_view,99") });
    upsertOutcomeDefinition({ eventName: "generate_lead", kind: "form_submit", definition: "상담 폼 제출 완료" });

    const appendix = buildObservationAppendix();
    expect(appendix.searchConsole).toMatchObject({ status: "connected", properties: [{ propertyLabel: "TikTok @a", periodStart: "2026-09-08", periodEnd: "2026-10-05", hasData: false, clicks: 0, impressions: 0, ctr: null, position: null }] });
    expect(appendix.botLogs).toMatchObject({
      status: "connected",
      latest: { fileName: "access.log", periodStart: "2026-10-08", periodEnd: "2026-10-09", offsets: ["+0900"], dnsChecked: false, self: 0, other: 0 },
    });
    expect(appendix.botLogs.latest?.purposes).toEqual([
      { purpose: "search", hits: 1, verifiedHits: 0, failedHits: 0, uncheckedHits: 1 },
      { purpose: "training", hits: 1, verifiedHits: 0, failedHits: 0, uncheckedHits: 1 },
    ]);
    expect(appendix.outcomes).toMatchObject({
      status: "connected",
      sources: [{ sourceLabel: "GA4", periodStart: "2026-10-01", periodEnd: "2026-10-01", unmappedEvents: 1, metrics: [{ kind: "form_submit", count: 3, events: [{ eventName: "generate_lead", definition: "상담 폼 제출 완료", count: 3 }] }] }],
    });
  });
});

describe("report integration", () => {
  it("attaches the appendix only to a report from the active project (never another project's data)", () => {
    const original = ensureActiveProject().id;
    const insert = (projectId: number) => Number(getDatabase().sqlite.prepare(
      "INSERT INTO audits (project_id, url, score, grade, items, created_at) VALUES (?, 'https://example.com', 1, '우수', '[]', '2026-10-08T00:00:00.000Z')",
    ).run(projectId).lastInsertRowid);
    const own = insert(original);
    const other = createProject({ name: "다른 프로젝트", brandName: "다른", category: "", competitors: [], activate: false });
    const foreign = insert(other.id);
    activateProject(original);
    expect(buildAuditReport(own, { includeObservations: true }).observations).toBeDefined();
    expect(buildAuditReport(own).observations).toBeUndefined();
    expect(buildAuditReport(foreign, { includeObservations: true }).observations).toBeUndefined();
  });

  it("prints the appendix in the PDF only when the report carries it", () => {
    const plain = decodedText(reportToPdf(auditReport));
    expect(plain).not.toContain("관측 지표 부록");
    const withAppendix = decodedText(reportToPdf({ ...auditReport, observations: buildObservationAppendix() } as unknown as PortableReport));
    expect(withAppendix).toContain("관측 지표 부록");
    expect(withAppendix).toContain("TikTok @a");
    expect(withAppendix).toContain("데이터 없음");
    expect(withAppendix).toContain("폼 제출");
    expect(withAppendix).toContain("상담 폼 제출 완료");
  });

  it.each(["audit items", "share results", "question matrix"])("preserves every observation section when %s exhaust the PDF page limit", (scenario) => {
    const observations = buildObservationAppendix();
    const response = "가".repeat(1_200);
    const result = { question: "긴 질문", provider: "openai", model: "test", repetition: 1, response, brandMentioned: true, sentiment: "positive", mentionRank: 1, competitorMentions: [], slotStatus: "succeeded" as const, createdAt: auditReport.generatedAt };
    const summary = scenario === "question matrix" ? {
      metricVersion: "m1.0",
      quality: { planned: 1_000, succeeded: 1_000, refused: 0, failed: 0, completionRate: { numerator: 1_000, denominator: 1_000, value: 100 }, refusalRate: { numerator: 0, denominator: 1_000, value: 0 } },
      questionMatrix: Array.from({ length: 1_000 }, () => ({ question: response, provider: "openai", mentioned: 1, valid: 1, refused: 0, failed: 0, planned: 1, label: "1/1" })),
    } : {};
    const report: PortableReport = scenario === "audit items" && auditReport.kind === "audit" ? {
      ...auditReport, observations,
      audit: { ...auditReport.audit, items: Array.from({ length: 600 }, (_, index) => ({ code: String(index), category: "기반 SEO" as const, label: "긴 진단", passed: false, manual: false, detail: response, recommendation: response })) },
    } : {
      schemaVersion: 1, kind: "share", generatedAt: auditReport.generatedAt, observations,
      run: { id: 1, status: "completed", models: [], repetitions: 1, totalQueries: 600, answerShare: 100, genrank: 100, funnelStage: "추천", summary, diagnostics: null, createdAt: auditReport.generatedAt, completedAt: auditReport.generatedAt, results: Array.from({ length: 600 }, () => result) },
    };
    const pdf = reportToPdf(report);
    expect(Buffer.from(pdf).toString("latin1")).toContain(`/Count ${PDF_MAX_PAGES}`);
    const text = decodedText(pdf);
    expect(text).toContain("페이지 상한으로 일부 근거가 생략되었습니다.");
    for (const required of ["관측 지표 부록", "검색 성과", "AI 봇 방문", "사업 성과", "TikTok @a", "access.log", "GA4", "상담 폼 제출 완료", "2026-09-08", "2026-10-01", "출처:", "정의:"]) {
      expect(text.includes(required), required).toBe(true);
    }
    const detailSection = scenario === "audit items" ? "우선 개선 항목" : scenario === "question matrix" ? "분모 근거" : "질문별 측정 근거";
    expect(text.indexOf("관측 지표 부록")).toBeLessThan(text.indexOf(detailSection));
  });
});
