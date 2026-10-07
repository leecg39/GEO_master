import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDatabase, getDatabase } from "@/lib/db";
import { measureResults, measureRuns } from "@/lib/db/schema";
import { ensureActiveProject, updateProject } from "@/lib/projects";
import { renderPublicReportHtml, renderUnavailableHtml } from "@/lib/public-report";
import { createReportShare, listReportShares, resolvePublicReport, revokeReportShare } from "@/lib/report-shares";
import { NextRequest } from "next/server";
import { GET as publicReport } from "@/app/r/[token]/route";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-share-link-test-"));
const databasePath = path.join(tempDir, "geo.db");
const previousDb = process.env.GEO_DB_PATH;
const previousKey = process.env.GEO_MASTER_KEY;
let runId = 0;

beforeAll(() => {
  process.env.GEO_DB_PATH = databasePath;
  process.env.GEO_MASTER_KEY = "share-link-integration-master-key-with-32-chars";
  const project = ensureActiveProject();
  updateProject(project.id, { name: "브랜드Z", brandName: "브랜드Z", expectedUpdatedAt: project.updatedAt });
  const { orm } = getDatabase();
  runId = orm.insert(measureRuns).values({
    projectId: project.id, title: "10월 진단", status: "completed", models: "[]", repetitions: 1, totalQueries: 1, answerShare: 100, genrank: 100, funnelStage: "추천",
    summary: JSON.stringify({
      metricVersion: "m1.0", positiveRate: 100,
      quality: { planned: 1, succeeded: 1, refused: 0, failed: 0, completionRate: { numerator: 1, denominator: 1, value: 100 }, refusalRate: { numerator: 0, denominator: 1, value: 0 } },
      questionMatrix: [{ question: "좋은 도구는?", provider: "openai", mentioned: 1, valid: 1, refused: 0, failed: 0, planned: 1, label: "1/1" }],
    }),
    createdAt: "2026-10-01T00:00:00.000Z", completedAt: "2026-10-01T00:01:00.000Z",
  }).returning().get().id;
  orm.insert(measureResults).values({
    runId, questionText: "좋은 도구는?", provider: "openai", model: "m", repetition: 1, response: "브랜드Z <script>alert(1)</script> 추천",
    brandMentioned: true, sentiment: "positive", mentionRank: 1, competitorMentions: "[]", slotStatus: "succeeded", metricVersion: "m1.0",
    createdAt: "2026-10-01T00:00:00.000Z",
  }).run();
});

afterAll(() => {
  closeDatabase(databasePath);
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (previousDb === undefined) delete process.env.GEO_DB_PATH; else process.env.GEO_DB_PATH = previousDb;
  if (previousKey === undefined) delete process.env.GEO_MASTER_KEY; else process.env.GEO_MASTER_KEY = previousKey;
});

describe("public report shares", () => {
  it("creates an expiring link, stores only the token hash, and resolves a frozen snapshot", () => {
    const { share, url } = createReportShare({ runId, expiresInDays: 7 });
    const token = url.split("/").at(-1)!;
    expect(url).toMatch(/^\/r\/[A-Za-z0-9_-]{43}$/);
    const stored = getDatabase().sqlite.prepare("SELECT token_hash FROM report_shares WHERE id = ?").get(share.id) as { token_hash: string };
    expect(stored.token_hash).not.toContain(token);
    getDatabase().sqlite.prepare("UPDATE measure_runs SET answer_share = 0 WHERE id = ?").run(runId);
    const resolved = resolvePublicReport(token);
    expect(resolved?.report.run.answerShare).toBe(100);
    expect(listReportShares(runId)[0]).toMatchObject({ id: share.id, viewCount: 1, revokedAt: null });
  });

  it("rejects malformed, revoked and expired tokens", () => {
    expect(resolvePublicReport("not-a-token")).toBeNull();
    const revoked = createReportShare({ runId, expiresInDays: 1 });
    revokeReportShare(revoked.share.id);
    expect(resolvePublicReport(revoked.url.split("/").at(-1)!)).toBeNull();
    const expired = createReportShare({ runId, expiresInDays: 1 });
    getDatabase().sqlite.prepare("UPDATE report_shares SET expires_at = ? WHERE id = ?").run("2020-01-01T00:00:00.000Z", expired.share.id);
    expect(resolvePublicReport(expired.url.split("/").at(-1)!)).toBeNull();
    expect(() => createReportShare({ runId, expiresInDays: 31 })).toThrow();
  });

  it("renders escaped, script-free HTML with denominators and a noindex directive", () => {
    const { url } = createReportShare({ runId, expiresInDays: 3 });
    const resolved = resolvePublicReport(url.split("/").at(-1)!)!;
    const html = renderPublicReportHtml(resolved.report, resolved.expiresAt);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain("noindex");
    expect(html).toContain("1/1");
    expect(html).toContain("10월 진단");
    expect(renderUnavailableHtml()).toContain("만료");
  });

  it("serves the public page with a script-blocking CSP and 404 for unknown tokens", async () => {
    const { url } = createReportShare({ runId, expiresInDays: 2 });
    const token = url.split("/").at(-1)!;
    const response = await publicReport(new NextRequest(`https://geo.example${url}`), { params: Promise.resolve({ token }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    const missing = await publicReport(new NextRequest("https://geo.example/r/x"), { params: Promise.resolve({ token: "B".repeat(43) }) });
    expect(missing.status).toBe(404);
  });
});
