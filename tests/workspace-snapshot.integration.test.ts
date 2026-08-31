import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET } from "@/app/api/workspace/route";
import { closeDatabase, getDatabase } from "@/lib/db";
import { auditItems, audits, checklistStates, contents, measureResults, measureRuns, questionSets, questions, strategyItems } from "@/lib/db/schema";
import { getServerSettings, updateSettings } from "@/lib/settings";
import { buildWorkspaceSnapshot, importWorkspace, serializeWorkspaceSnapshot, workspaceSnapshotSchema } from "@/lib/workspace";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-snapshot-test-"));
const sourcePath = path.join(tempDir, "source.db");
const targetPath = path.join(tempDir, "target.db");
const previousDb = process.env.GEO_DB_PATH;
const previousKey = process.env.GEO_MASTER_KEY;
const models = { openai: "gpt-test", anthropic: "claude-test", gemini: "gemini-test", hyperclova: "HCX-DASH-002" };
const modelWeights = { openai: .3, anthropic: .25, gemini: .2, hyperclova: .25 };
let snapshot: ReturnType<typeof buildWorkspaceSnapshot>;
const sourceSecret = "nv-source-secret-1111";
const targetSecret = "nv-target-secret-9999";

function useDatabase(databasePath: string) { process.env.GEO_DB_PATH = databasePath; }

beforeAll(() => {
  process.env.GEO_MASTER_KEY = "workspace-snapshot-integration-master-key-32";
  useDatabase(sourcePath);
  updateSettings({ brandName: "공유 브랜드", category: "GEO", competitors: ["경쟁사"], models, repetitions: 2, modelWeights, apiKeys: { hyperclova: sourceSecret } });
  const { orm } = getDatabase();
  const project = getDatabase().sqlite.prepare("SELECT id FROM projects LIMIT 1").get() as { id: number };
  const set = orm.insert(questionSets).values({ projectId: project.id, name: "핵심 질문", createdAt: "2026-09-01T00:00:00.000Z" }).returning().get();
  orm.insert(questions).values({ questionSetId: set.id, text: "좋은 GEO 도구는?", source: "팀", intent: "비교", segment: "B2B", journeyStage: "탐색", createdAt: "2026-09-01T00:00:00.000Z" }).run();
  const run = orm.insert(measureRuns).values({ projectId: project.id, status: "completed", models: JSON.stringify([{ provider: "hyperclova", model: "HCX-DASH-002" }]), repetitions: 1, totalQueries: 1, answerShare: 100, genrank: 100, funnelStage: "추천", summary: JSON.stringify({ total: 1, mentions: 1 }), createdAt: "2026-09-01T00:00:00.000Z", completedAt: "2026-09-01T00:01:00.000Z" }).returning().get();
  orm.insert(measureResults).values({ runId: run.id, questionText: "좋은 GEO 도구는?", provider: "hyperclova", model: "HCX-DASH-002", repetition: 1, response: "공유 브랜드를 추천합니다.", brandMentioned: true, sentiment: "positive", mentionRank: 1, competitorMentions: "[]", createdAt: "2026-09-01T00:00:30.000Z" }).run();
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
});

describe.sequential("portable workspace snapshot", () => {
  it("exports all portable tables without key fields, ciphertext, or plaintext", async () => {
    useDatabase(sourcePath);
    const serialized = serializeWorkspaceSnapshot(snapshot);
    expect(snapshot).toMatchObject({ kind: "geo-master-workspace", schemaVersion: 1, workspaceName: "공유 브랜드" });
    expect(snapshot.stats).toMatchObject({ projects: 1, questionSets: 1, questions: 1, measureRuns: 1, measureResults: 1, audits: 1, auditItems: 1, contents: 1, checklistStates: 1, strategyItems: 1 });
    expect(snapshot.data.settings).not.toHaveProperty("apiKeys");
    expect(serialized).not.toContain(sourceSecret);
    const encrypted = (getDatabase().sqlite.prepare("SELECT hyperclova_api_key FROM settings WHERE id=1").get() as { hyperclova_api_key: string }).hyperclova_api_key;
    expect(serialized).not.toContain(encrypted);

    const response = GET(new NextRequest("http://localhost/api/workspace?download=1"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="geo-workspace-/);
    expect(await response.text()).not.toContain(sourceSecret);
  });

  it("merges with remapped IDs while preserving the target API key", () => {
    useDatabase(targetPath);
    updateSettings({ brandName: "대상 브랜드", category: "기존", competitors: [], models, repetitions: 1, modelWeights, apiKeys: { hyperclova: targetSecret } });
    const result = importWorkspace({ mode: "merge", snapshot });
    expect(result).toMatchObject({ mode: "merge", idPolicy: "remapped", apiKeysPreserved: true });
    const db = getDatabase().sqlite;
    expect((db.prepare("SELECT COUNT(*) AS count FROM projects").get() as { count: number }).count).toBe(2);
    const importedSet = db.prepare("SELECT id, project_id FROM question_sets LIMIT 1").get() as { id: number; project_id: number };
    expect(importedSet.project_id).not.toBe(snapshot.data.questionSets[0].projectId);
    expect((db.prepare("SELECT question_set_id FROM questions LIMIT 1").get() as { question_set_id: number }).question_set_id).toBe(importedSet.id);
    const importedRun = db.prepare("SELECT id, project_id FROM measure_runs LIMIT 1").get() as { id: number; project_id: number };
    expect((db.prepare("SELECT run_id FROM measure_results LIMIT 1").get() as { run_id: number }).run_id).toBe(importedRun.id);
    expect(getServerSettings(["hyperclova"]).decryptedApiKeys.hyperclova).toBe(targetSecret);
    expect(getServerSettings().brandName).toBe("공유 브랜드");
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
    expect(getServerSettings().brandName).toBe("공유 브랜드");
    expect(getServerSettings(["hyperclova"]).decryptedApiKeys.hyperclova).toBe(targetSecret);
  });

  it("requires confirmation, then replaces portable rows with preserved IDs and keys", () => {
    useDatabase(targetPath);
    expect(() => importWorkspace({ mode: "replace", snapshot })).toThrow(/명시적 확인/);
    const result = importWorkspace({ mode: "replace", confirmReplace: true, snapshot });
    expect(result.idPolicy).toBe("preserved");
    const db = getDatabase().sqlite;
    expect((db.prepare("SELECT COUNT(*) AS count FROM projects").get() as { count: number }).count).toBe(1);
    expect((db.prepare("SELECT id FROM projects").get() as { id: number }).id).toBe(snapshot.data.projects[0].id);
    expect(getServerSettings(["hyperclova"]).decryptedApiKeys.hyperclova).toBe(targetSecret);
  });
});
