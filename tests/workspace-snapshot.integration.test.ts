import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET } from "@/app/api/workspace/route";
import { closeDatabase, getDatabase } from "@/lib/db";
import { auditItems, audits, checklistStates, contents, measureCitations, measureResults, measureRuns, questionSets, questions, strategyItems } from "@/lib/db/schema";
import { ensureActiveProject, updateProject } from "@/lib/projects";
import { getPublicSettings, getServerSettings, updateSettings } from "@/lib/settings";
import { buildWorkspaceSnapshot, importWorkspace, serializeWorkspaceSnapshot, workspaceSnapshotSchema } from "@/lib/workspace";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-snapshot-test-"));
const sourcePath = path.join(tempDir, "source.db");
const targetPath = path.join(tempDir, "target.db");
const previousDb = process.env.GEO_DB_PATH;
const previousKey = process.env.GEO_MASTER_KEY;
const previousGrokKey = process.env.GROK_API_KEY;
const previousXaiKey = process.env.XAI_API_KEY;
const models = { openai: "gpt-test", anthropic: "claude-test", gemini: "gemini-test", grok: "grok-4.6" };
const modelWeights = { openai: .3, anthropic: .25, gemini: .2, grok: .25 };
let snapshot: ReturnType<typeof buildWorkspaceSnapshot>;
const sourceSecret = "xai-source-secret-1111";
const targetSecret = "xai-target-secret-9999";

function useDatabase(databasePath: string) { process.env.GEO_DB_PATH = databasePath; }

function configureWorkspace(brandName: string, category: string, competitors: string[], grokKey: string, repetitions: number) {
  const activeProject = ensureActiveProject();
  updateProject(activeProject.id, {
    name: brandName, brandName, category, competitors, expectedUpdatedAt: activeProject.updatedAt,
  });
  updateSettings({
    models, repetitions, modelWeights, apiKeys: { grok: grokKey },
    expectedUpdatedAt: getPublicSettings().updatedAt,
  });
}

beforeAll(() => {
  process.env.GEO_MASTER_KEY = "workspace-snapshot-integration-master-key-32";
  delete process.env.GROK_API_KEY;
  delete process.env.XAI_API_KEY;
  useDatabase(sourcePath);
  configureWorkspace("공유 브랜드", "GEO", ["경쟁사"], sourceSecret, 2);
  const { orm } = getDatabase();
  const project = getDatabase().sqlite.prepare("SELECT id FROM projects LIMIT 1").get() as { id: number };
  const set = orm.insert(questionSets).values({ projectId: project.id, name: "핵심 질문", createdAt: "2026-09-01T00:00:00.000Z" }).returning().get();
  orm.insert(questions).values({ questionSetId: set.id, text: "좋은 GEO 도구는?", source: "팀", intent: "비교", segment: "B2B", journeyStage: "탐색", createdAt: "2026-09-01T00:00:00.000Z" }).run();
  const run = orm.insert(measureRuns).values({ projectId: project.id, status: "completed", models: JSON.stringify([{ provider: "grok", model: "grok-4.6" }]), repetitions: 1, totalQueries: 1, answerShare: 100, genrank: 100, funnelStage: "추천", summary: JSON.stringify({ total: 1, mentions: 1 }), createdAt: "2026-09-01T00:00:00.000Z", completedAt: "2026-09-01T00:01:00.000Z" }).returning().get();
  const result = orm.insert(measureResults).values({ runId: run.id, questionText: "좋은 GEO 도구는?", provider: "grok", model: "grok-4.6", repetition: 1, response: "공유 브랜드를 추천합니다.", brandMentioned: true, sentiment: "positive", mentionRank: 1, competitorMentions: "[]", slotStatus: "refused", metricVersion: "m1.0", createdAt: "2026-09-01T00:00:30.000Z" }).returning().get();
  orm.insert(measureCitations).values({ runId: run.id, resultId: result.id, url: "https://own.example/a", domain: "own.example", title: "자사", kind: "cited", category: "own", createdAt: "2026-09-01T00:00:31.000Z" }).run();
  const fact = getDatabase().sqlite.prepare("INSERT INTO facts (project_id, attribute, attribute_normalized, value, unit, verified, created_at, updated_at) VALUES (?, '가격', '가격', '12000', '원', 1, ?, ?)").run(project.id, "2026-09-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z");
  getDatabase().sqlite.prepare("INSERT INTO measure_claims (run_id, result_id, claim_text, attribute, value, unit, verdict, fact_id, created_at) VALUES (?, ?, '월 15000원', '가격', '15000', '원', 'conflict', ?, ?)").run(run.id, result.id, fact.lastInsertRowid, "2026-09-01T00:00:40.000Z");
  getDatabase().sqlite.prepare("INSERT INTO mention_reviews (result_id, run_id, auto_mentioned, human_mentioned, reviewed_at) VALUES (?, ?, 1, 0, ?)").run(result.id, run.id, "2026-09-01T00:00:50.000Z");
  getDatabase().sqlite.prepare("INSERT INTO optimization_runs (project_id, title, query, input, status, progress, result, created_at, updated_at, completed_at) VALUES (?, '랩', '질문', '{}', 'completed', '{}', '{\"candidates\":[]}', ?, ?, ?)").run(project.id, "2026-09-01T00:01:00.000Z", "2026-09-01T00:01:00.000Z", "2026-09-01T00:02:00.000Z");
  getDatabase().sqlite.prepare("UPDATE projects SET brand_aliases = ?, competitor_domains = ? WHERE id = ?").run(JSON.stringify(["SharedBrand"]), JSON.stringify(["rival.example"]), project.id);
  const audit = orm.insert(audits).values({ url: "https://example.com", score: 30, grade: "우수", items: "[]", metadata: "{}", createdAt: "2026-09-01T00:00:00.000Z" }).returning().get();
  orm.insert(auditItems).values({ auditId: audit.id, code: "TITLE", category: "SEO", passed: true, manual: false, detail: "통과" }).run();
  orm.insert(contents).values({ tool: "entity", input: "{}", output: "{}", createdAt: "2026-09-01T00:00:00.000Z" }).run();
  orm.insert(checklistStates).values({ scope: "learn-38", itemKey: "g1-1", checked: true, updatedAt: "2026-09-01T00:00:00.000Z" }).run();
  orm.insert(strategyItems).values({ type: "cycle", title: "측정", data: "{\"week\":1}", status: "완료", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" }).run();
  snapshot = buildWorkspaceSnapshot();
});

afterAll(() => {
  closeDatabase(sourcePath); closeDatabase(targetPath);
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (previousDb === undefined) delete process.env.GEO_DB_PATH; else process.env.GEO_DB_PATH = previousDb;
  if (previousKey === undefined) delete process.env.GEO_MASTER_KEY; else process.env.GEO_MASTER_KEY = previousKey;
  if (previousGrokKey === undefined) delete process.env.GROK_API_KEY; else process.env.GROK_API_KEY = previousGrokKey;
  if (previousXaiKey === undefined) delete process.env.XAI_API_KEY; else process.env.XAI_API_KEY = previousXaiKey;
});

describe.sequential("portable workspace snapshot", () => {
  it("exports all portable tables without key fields, ciphertext, or plaintext", async () => {
    useDatabase(sourcePath);
    const serialized = serializeWorkspaceSnapshot(snapshot);
    expect(snapshot).toMatchObject({ kind: "geo-master-workspace", schemaVersion: 2, workspaceName: "공유 브랜드" });
    expect(snapshot.stats).toMatchObject({ projects: 1, questionSets: 1, questions: 1, measureRuns: 1, measureResults: 1, audits: 1, auditItems: 1, contents: 1, checklistStates: 1, strategyItems: 1 });
    expect(snapshot.data.settings).not.toHaveProperty("apiKeys");
    expect(serialized).not.toContain(sourceSecret);
    const encrypted = (getDatabase().sqlite.prepare("SELECT grok_api_key FROM settings WHERE id=1").get() as { grok_api_key: string }).grok_api_key;
    expect(serialized).not.toContain(encrypted);

    const response = GET(new NextRequest("http://localhost/api/workspace?download=1"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="geo-workspace-/);
    expect(await response.text()).not.toContain(sourceSecret);
  });

  it("merges with remapped IDs while preserving the target API key", () => {
    useDatabase(targetPath);
    configureWorkspace("대상 브랜드", "기존", [], targetSecret, 1);
    const result = importWorkspace({ mode: "merge", snapshot });
    expect(result).toMatchObject({ mode: "merge", idPolicy: "remapped", apiKeysPreserved: true });
    const db = getDatabase().sqlite;
    expect((db.prepare("SELECT COUNT(*) AS count FROM projects").get() as { count: number }).count).toBe(2);
    const importedSet = db.prepare("SELECT id, project_id FROM question_sets LIMIT 1").get() as { id: number; project_id: number };
    expect(importedSet.project_id).not.toBe(snapshot.data.questionSets[0].projectId);
    expect((db.prepare("SELECT question_set_id FROM questions LIMIT 1").get() as { question_set_id: number }).question_set_id).toBe(importedSet.id);
    const importedRun = db.prepare("SELECT id, project_id FROM measure_runs LIMIT 1").get() as { id: number; project_id: number };
    expect((db.prepare("SELECT run_id FROM measure_results LIMIT 1").get() as { run_id: number }).run_id).toBe(importedRun.id);
    expect(db.prepare("SELECT slot_status, metric_version FROM measure_results LIMIT 1").get()).toEqual({ slot_status: "refused", metric_version: "m1.0" });
    const importedResult = db.prepare("SELECT id FROM measure_results LIMIT 1").get() as { id: number };
    expect(db.prepare("SELECT run_id, result_id, category FROM measure_citations").all()).toEqual([{ run_id: importedRun.id, result_id: importedResult.id, category: "own" }]);
    const importedFact = db.prepare("SELECT id, project_id, value FROM facts").get() as { id: number; project_id: number; value: string };
    expect(importedFact).toMatchObject({ project_id: importedRun.project_id, value: "12000" });
    expect(db.prepare("SELECT run_id, result_id, fact_id, verdict FROM measure_claims").all()).toEqual([{ run_id: importedRun.id, result_id: importedResult.id, fact_id: importedFact.id, verdict: "conflict" }]);
    expect(db.prepare("SELECT result_id, run_id, auto_mentioned, human_mentioned FROM mention_reviews").all()).toEqual([{ result_id: importedResult.id, run_id: importedRun.id, auto_mentioned: 1, human_mentioned: 0 }]);
    expect(db.prepare("SELECT project_id, title, status, result FROM optimization_runs").all()).toEqual([{ project_id: importedRun.project_id, title: "랩", status: "completed", result: "{\"candidates\":[]}" }]);
    expect(db.prepare("SELECT brand_aliases, competitor_domains FROM projects WHERE id = ?").get(importedRun.project_id)).toEqual({ brand_aliases: "[\"SharedBrand\"]", competitor_domains: "[\"rival.example\"]" });
    expect(db.prepare("SELECT revision, origin FROM content_revisions").get()).toEqual({ revision: 1, origin: "restored" });
    expect(getServerSettings(["grok"]).decryptedApiKeys.grok).toBe(targetSecret);
    expect(getServerSettings().brandName).toBe("대상 브랜드");
  });

  it("rejects malformed encoded JSON and duplicate checklist keys", () => {
    const malformed = structuredClone(snapshot);
    malformed.data.measureRuns[0].summary = "{";
    expect(workspaceSnapshotSchema.safeParse(malformed).success).toBe(false);
    const duplicate = structuredClone(snapshot);
    duplicate.data.checklistStates.push({ ...duplicate.data.checklistStates[0], id: 999_999 });
    duplicate.stats.checklistStates += 1;
    expect(workspaceSnapshotSchema.safeParse(duplicate).success).toBe(false);
  });

  it("rolls back replacement when a validly shaped snapshot has a dangling relation", () => {
    useDatabase(targetPath);
    const before = getDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM projects").get() as { count: number };
    const broken = structuredClone(snapshot);
    broken.data.questionSets[0].projectId = 999_999;
    expect(() => importWorkspace({ mode: "replace", confirmReplace: true, snapshot: broken })).toThrow(/관계가 유효하지 않아/);
    const after = getDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM projects").get() as { count: number };
    expect(after.count).toBe(before.count);
    expect(getServerSettings().brandName).toBe("대상 브랜드");
    expect(getServerSettings(["grok"]).decryptedApiKeys.grok).toBe(targetSecret);
  });

  it("requires confirmation, then replaces portable rows with preserved IDs and keys", () => {
    useDatabase(targetPath);
    expect(() => importWorkspace({ mode: "replace", snapshot })).toThrow(/명시적 확인/);
    const result = importWorkspace({ mode: "replace", confirmReplace: true, snapshot });
    expect(result.idPolicy).toBe("preserved");
    const db = getDatabase().sqlite;
    expect((db.prepare("SELECT COUNT(*) AS count FROM projects").get() as { count: number }).count).toBe(1);
    expect((db.prepare("SELECT id FROM projects").get() as { id: number }).id).toBe(snapshot.data.projects[0].id);
    expect(getServerSettings(["grok"]).decryptedApiKeys.grok).toBe(targetSecret);
  });
});
