import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDatabase, getDatabase } from "@/lib/db";
import { measureResults, measureRuns } from "@/lib/db/schema";
import { ensureActiveProject, updateProject } from "@/lib/projects";
import { getReviewQueue, getReviewQuality, reviewClaim, reviewMention } from "@/lib/review";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-review-test-"));
const databasePath = path.join(tempDir, "geo.db");
const previousDb = process.env.GEO_DB_PATH;
const previousKey = process.env.GEO_MASTER_KEY;
let runId = 0;
const resultIds: number[] = [];

beforeAll(() => {
  process.env.GEO_DB_PATH = databasePath;
  process.env.GEO_MASTER_KEY = "review-integration-master-key-with-32-characters";
  const project = ensureActiveProject();
  updateProject(project.id, { name: "브랜드Z", brandName: "브랜드Z", competitors: ["경쟁사A"], expectedUpdatedAt: project.updatedAt });
  const { orm, sqlite } = getDatabase();
  runId = orm.insert(measureRuns).values({
    projectId: project.id, status: "completed", models: "[]", repetitions: 1, totalQueries: 3, answerShare: 66.7, genrank: 50,
    funnelStage: "시의성", summary: JSON.stringify({ metricVersion: "m1.0", searchMode: "off" }), createdAt: "2026-10-01T00:00:00.000Z", completedAt: "2026-10-01T00:01:00.000Z",
  }).returning().get().id;
  const base = { runId, questionText: "Q1", provider: "openai", model: "m", repetition: 1, sentiment: "neutral", competitorMentions: "[]", slotStatus: "succeeded" as const, metricVersion: "m1.0", createdAt: "2026-10-01T00:00:00.000Z" };
  resultIds.push(
    orm.insert(measureResults).values({ ...base, response: "Z는 좋습니다", brandMentioned: true, mentionRank: 1, matchedSpans: JSON.stringify([{ alias: "Z", start: 0, end: 1, ambiguous: true }]) }).returning().get().id,
    orm.insert(measureResults).values({ ...base, questionText: "Q2", response: "브랜드Z는 좋습니다", brandMentioned: true, mentionRank: 1, matchedSpans: JSON.stringify([{ alias: "브랜드Z", start: 0, end: 4, ambiguous: false }]) }).returning().get().id,
    orm.insert(measureResults).values({ ...base, questionText: "Q3", response: "BZ 제품이 좋습니다", brandMentioned: false, mentionRank: null }).returning().get().id,
  );
  sqlite.prepare("INSERT INTO measure_claims (run_id, result_id, claim_text, attribute, value, unit, verdict, created_at) VALUES (?, ?, '월 15000원', '가격', '15000', '원', 'conflict', ?)").run(runId, resultIds[1], "2026-10-01T00:00:00.000Z");
});

afterAll(() => {
  closeDatabase(databasePath);
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (previousDb === undefined) delete process.env.GEO_DB_PATH; else process.env.GEO_DB_PATH = previousDb;
  if (previousKey === undefined) delete process.env.GEO_MASTER_KEY; else process.env.GEO_MASTER_KEY = previousKey;
});

describe("review inbox", () => {
  it("lists every unreviewed answer in full mode and only exceptions in exception mode", () => {
    expect(getReviewQueue({ mode: "all" }).items.map((item) => item.resultId)).toEqual(resultIds);
    const exceptions = getReviewQueue({ mode: "exceptions" }).items;
    expect(exceptions.map((item) => [item.resultId, item.reasons])).toEqual([
      [resultIds[0], ["ambiguous"]],
      [resultIds[1], ["claim"]],
    ]);
    expect(exceptions[1]!.claims[0]).toMatchObject({ verdict: "conflict", value: "15000" });
  });

  it("applies human mention labels, recomputes the run summary, and removes reviewed items from the queue", () => {
    reviewMention({ resultId: resultIds[0], brandMentioned: false });
    reviewMention({ resultId: resultIds[2], brandMentioned: true });
    reviewMention({ resultId: resultIds[1], brandMentioned: true });
    const run = getDatabase().sqlite.prepare("SELECT answer_share, summary FROM measure_runs WHERE id = ?").get(runId) as { answer_share: number; summary: string };
    expect(run.answer_share).toBe(66.7);
    expect(JSON.parse(run.summary)).toMatchObject({ reviewAdjusted: 2, metricVersion: "m1.0", searchMode: "off" });
    const rows = getDatabase().sqlite.prepare("SELECT brand_mentioned FROM measure_results WHERE run_id = ? ORDER BY id").all(runId);
    expect(rows).toEqual([{ brand_mentioned: 0 }, { brand_mentioned: 1 }, { brand_mentioned: 1 }]);
    expect(getReviewQueue({ mode: "all" }).items).toEqual([]);
  });

  it("computes precision and recall of automatic identification from human labels", () => {
    const quality = getReviewQuality();
    // 자동 양성 2건 중 1건만 사람도 양성 → 정밀도 1/2, 사람 양성 2건 중 자동 탐지 1건 → 재현율 1/2
    expect(quality).toMatchObject({ sampleCount: 3, precision: 0.5, recall: 0.5, exceptionModeEligible: false });
  });

  it("records claim verdict overrides while keeping the original verdict", () => {
    const claimId = (getDatabase().sqlite.prepare("SELECT id FROM measure_claims LIMIT 1").get() as { id: number }).id;
    reviewClaim({ claimId, verdict: "match" });
    expect(getDatabase().sqlite.prepare("SELECT verdict, original_verdict, reviewed FROM measure_claims WHERE id = ?").get(claimId))
      .toEqual({ verdict: "match", original_verdict: "conflict", reviewed: 1 });
    expect(() => reviewClaim({ claimId, verdict: "bogus" })).toThrow();
  });

  it("recomputes citation summaries when a web-search run is relabeled", () => {
    const { orm, sqlite } = getDatabase();
    const webRun = orm.insert(measureRuns).values({
      projectId: ensureActiveProject().id, status: "completed", models: "[]", repetitions: 1, totalQueries: 1, answerShare: 0, genrank: 0,
      funnelStage: "존재", summary: JSON.stringify({ metricVersion: "m1.0", searchMode: "web" }), createdAt: "2026-10-02T00:00:00.000Z", completedAt: "2026-10-02T00:01:00.000Z",
    }).returning().get().id;
    const result = orm.insert(measureResults).values({
      runId: webRun, questionText: "Q", provider: "openai", model: "m", repetition: 1, response: "BZ와 경쟁사A", brandMentioned: false, sentiment: "neutral",
      mentionRank: null, competitorMentions: "[]", slotStatus: "succeeded", metricVersion: "m1.0", searchMode: "web", citationSupported: true, createdAt: "2026-10-02T00:00:00.000Z",
    }).returning().get().id;
    sqlite.prepare("INSERT INTO measure_citations (run_id, result_id, url, domain, kind, category, created_at) VALUES (?, ?, 'https://rival.example/p', 'rival.example', 'cited', 'competitor', ?)").run(webRun, result, "2026-10-02T00:00:00.000Z");
    reviewMention({ resultId: result, brandMentioned: true });
    const summary = JSON.parse((sqlite.prepare("SELECT summary FROM measure_runs WHERE id = ?").get(webRun) as { summary: string }).summary);
    expect(summary).toMatchObject({ answerShare: 100, searchMode: "web", reviewAdjusted: 1, citations: { pagesCitedWithoutBrand: [], citedByCategory: { competitor: 1 } } });
  });
});
