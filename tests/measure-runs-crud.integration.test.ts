import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/llm", () => ({ generateText: vi.fn() }));

import { GET as listRuns } from "@/app/api/measure-runs/route";
import { DELETE as deleteRun, GET as getRun, PATCH as updateRun } from "@/app/api/measure-runs/[id]/route";
import { GET as listResults } from "@/app/api/measure-runs/[id]/results/route";
import { POST as executeRun } from "@/app/api/share/run/route";
import { closeDatabase, getDatabase } from "@/lib/db";
import { generateText } from "@/lib/llm";
import { activateProject, createProject, ensureActiveProject, updateProject } from "@/lib/projects";
import { getPublicSettings, updateSettings } from "@/lib/settings";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-measure-runs-"));
const databasePath = path.join(tempDir, "measure-runs.db");
const previousDb = process.env.GEO_DB_PATH;
const previousKey = process.env.GEO_MASTER_KEY;

interface RunResource {
  id: number; projectId: number; title: string; notes: string; status: string; answerShare: number; genrank: number;
  funnelStage: string; summary: Record<string, unknown>; resultCount: number; createdAt: string; updatedAt: string; completedAt: string | null;
}

let projectId: number;
let otherProjectId: number;
let firstRun: RunResource;
let secondRun: RunResource;
const requestId = "10000000-0000-4000-8000-000000000001";
const context = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
const request = (url: string, method: string, body: unknown) => new NextRequest(url, {
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

async function detail(id: number) {
  const response = await getRun(new NextRequest(`http://localhost/api/measure-runs/${id}`), context(id));
  return (await response.json()).run as RunResource;
}

beforeAll(() => {
  process.env.GEO_DB_PATH = databasePath;
  process.env.GEO_MASTER_KEY = "measure-runs-integration-master-key-32";
  const active = ensureActiveProject();
  projectId = active.id;
  updateProject(active.id, {
    name: "측정 프로젝트", brandName: "테스트 브랜드", category: "분석", competitors: ["경쟁 브랜드"], expectedUpdatedAt: active.updatedAt,
  });
  updateSettings({
    models: { openai: "gpt-test", anthropic: "claude-test", gemini: "gemini-test", grok: "grok-test" },
    repetitions: 1,
    modelWeights: { openai: 1, anthropic: 0, gemini: 0, grok: 0 },
    apiKeys: { openai: "sk-measure-test" },
    expectedUpdatedAt: getPublicSettings().updatedAt,
  });
  otherProjectId = createProject({
    name: "다른 측정 프로젝트", brandName: "다른 브랜드", category: "분석", competitors: [], activate: false,
  }).id;
});

beforeEach(() => {
  vi.mocked(generateText).mockReset().mockResolvedValue("브랜드가 없는 일반적인 분석 도구 비교 응답입니다.");
});

afterAll(() => {
  closeDatabase(databasePath);
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (previousDb === undefined) delete process.env.GEO_DB_PATH; else process.env.GEO_DB_PATH = previousDb;
  if (previousKey === undefined) delete process.env.GEO_MASTER_KEY; else process.env.GEO_MASTER_KEY = previousKey;
});

describe.sequential("measure run evidence CRUD API", () => {
  it("strictly creates an active-project run and identical UUID retries never rebill", async () => {
    const invalid = await executeRun(request("http://localhost/api/share/run", "POST", {
      questions: ["좋은 분석 도구의 기준은 무엇인가요?"], providers: ["openai"], repetitions: 1, unknown: true,
    }));
    expect(invalid.status).toBe(422);
    expect(vi.mocked(generateText)).not.toHaveBeenCalled();

    const payload = {
      questions: ["좋은 분석 도구의 기준은 무엇인가요?"], providers: ["openai"], repetitions: 2,
      title: "9월 응답 점유율", notes: "기준선 측정", clientRequestId: requestId,
    };
    const response = await executeRun(request("http://localhost/api/share/run", "POST", payload));
    expect(response.status).toBe(201);
    const created = (await response.json()).run;
    expect(created).toMatchObject({ projectId, title: payload.title, notes: payload.notes, status: "completed", total: 2 });
    expect(vi.mocked(generateText)).toHaveBeenCalledTimes(2);
    firstRun = await detail(created.id);
    expect(firstRun).toMatchObject({ projectId, title: payload.title, resultCount: 2, status: "completed" });
    expect(firstRun.summary).not.toHaveProperty("_requestHash");

    const retry = await executeRun(request("http://localhost/api/share/run", "POST", payload));
    expect(retry.status).toBe(201);
    expect((await retry.json()).run.id).toBe(firstRun.id);
    expect(vi.mocked(generateText)).toHaveBeenCalledTimes(2);

    const mismatch = await executeRun(request("http://localhost/api/share/run", "POST", { ...payload, notes: "다른 입력" }));
    expect(mismatch.status).toBe(409);
    expect((await mismatch.json()).code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(vi.mocked(generateText)).toHaveBeenCalledTimes(2);
  });

  it("persists a failed request and returns it on retry without another provider call", async () => {
    vi.mocked(generateText).mockRejectedValueOnce(new Error("provider failed"));
    const payload = {
      questions: ["실패 시 재시도 정책은 무엇인가요?"], providers: ["openai"], repetitions: 1,
      clientRequestId: "10000000-0000-4000-8000-000000000099",
    };
    const failed = await executeRun(request("http://localhost/api/share/run", "POST", payload));
    expect(failed.status).toBe(500);
    expect(vi.mocked(generateText)).toHaveBeenCalledTimes(1);

    const retry = await executeRun(request("http://localhost/api/share/run", "POST", payload));
    expect(retry.status).toBe(201);
    expect((await retry.json()).run.status).toBe("failed");
    expect(vi.mocked(generateText)).toHaveBeenCalledTimes(1);
  });

  it("supports cursor/search/detail and immutable result pagination", async () => {
    const response = await executeRun(request("http://localhost/api/share/run", "POST", {
      questions: ["기업용 분석 플랫폼을 비교하는 기준은 무엇인가요?"], providers: ["openai"], repetitions: 1,
      title: "기업용 비교 측정", clientRequestId: "10000000-0000-4000-8000-000000000002",
    }));
    secondRun = await detail((await response.json()).run.id);

    const firstPage = await listRuns(new NextRequest("http://localhost/api/measure-runs?limit=1")).json();
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.page).toMatchObject({ hasMore: true, nextCursor: expect.any(String) });
    const nextPage = await listRuns(new NextRequest(`http://localhost/api/measure-runs?limit=1&cursor=${encodeURIComponent(firstPage.page.nextCursor)}`)).json();
    expect(nextPage.items[0].id).not.toBe(firstPage.items[0].id);
    const searched = await listRuns(new NextRequest(`http://localhost/api/measure-runs?q=${encodeURIComponent("기업용")}`)).json();
    expect(searched.items.map((run: RunResource) => run.id)).toEqual([secondRun.id]);

    const resultPage = await listResults(new NextRequest(`http://localhost/api/measure-runs/${firstRun.id}/results?limit=1`), context(firstRun.id)).then((value) => value.json());
    expect(resultPage.items).toHaveLength(1);
    expect(resultPage.page.hasMore).toBe(true);
    expect(resultPage.items[0]).toMatchObject({ runId: firstRun.id, provider: "openai", response: expect.any(String) });
    const nextResults = await listResults(new NextRequest(`http://localhost/api/measure-runs/${firstRun.id}/results?limit=1&cursor=${encodeURIComponent(resultPage.page.nextCursor)}`), context(firstRun.id)).then((value) => value.json());
    expect(nextResults.items).toHaveLength(1);
    expect(nextResults.items[0].id).not.toBe(resultPage.items[0].id);
  });

  it("updates only title/notes with stale protection and keeps measurement evidence immutable", async () => {
    const immutable = await updateRun(request(`http://localhost/api/measure-runs/${firstRun.id}`, "PATCH", {
      answerShare: 100, expectedUpdatedAt: firstRun.updatedAt,
    }), context(firstRun.id));
    expect(immutable.status).toBe(422);
    const stale = await updateRun(request(`http://localhost/api/measure-runs/${firstRun.id}`, "PATCH", {
      title: "오래된 수정", expectedUpdatedAt: "2000-01-01T00:00:00.000Z",
    }), context(firstRun.id));
    expect(stale.status).toBe(409);

    const evidenceBefore = getDatabase().sqlite.prepare("SELECT answer_share, summary FROM measure_runs WHERE id = ?").get(firstRun.id);
    const response = await updateRun(request(`http://localhost/api/measure-runs/${firstRun.id}`, "PATCH", {
      title: "9월 측정 · 검토 완료", notes: "경영진 공유", expectedUpdatedAt: firstRun.updatedAt,
    }), context(firstRun.id));
    expect(response.status).toBe(200);
    firstRun = (await response.json()).run;
    expect(firstRun).toMatchObject({ title: "9월 측정 · 검토 완료", notes: "경영진 공유", resultCount: 2 });
    expect(getDatabase().sqlite.prepare("SELECT answer_share, summary FROM measure_runs WHERE id = ?").get(firstRun.id)).toEqual(evidenceBefore);
  });

  it("isolates run and result access by active project", async () => {
    activateProject(otherProjectId);
    const list = await listRuns(new NextRequest("http://localhost/api/measure-runs")).json();
    expect(list.items).toEqual([]);
    const foreign = await getRun(new NextRequest(`http://localhost/api/measure-runs/${firstRun.id}`), context(firstRun.id));
    expect(foreign.status).toBe(409);
    const foreignResults = await listResults(new NextRequest(`http://localhost/api/measure-runs/${firstRun.id}/results`), context(firstRun.id));
    expect(foreignResults.status).toBe(409);
    activateProject(projectId);
  });

  it("guards dependencies, cascades results, and detaches jobs and report presets", async () => {
    const sqlite = getDatabase().sqlite;
    const now = new Date().toISOString();
    sqlite.prepare(`
      INSERT INTO measurement_jobs (
        project_id, schedule_id, run_id, status, payload, idempotency_key, estimated_cost_usd, incurred_cost_usd,
        provider_call_costs, budget_period, budget_charged, available_at, created_at, updated_at
      ) VALUES (?, NULL, ?, 'completed', '{}', ?, 0, 0, '{}', '2026-09', 0, ?, ?, ?)
    `).run(projectId, firstRun.id, "run-delete-job", now, now, now);
    sqlite.prepare(`
      INSERT INTO report_presets (project_id, name, kind, run_id, config, default_format, created_at, updated_at)
      VALUES (?, '측정 리포트', 'share', ?, '{}', 'pdf', ?, ?)
    `).run(projectId, firstRun.id, now, now);

    const guarded = await deleteRun(request(`http://localhost/api/measure-runs/${firstRun.id}`, "DELETE", {
      expectedUpdatedAt: firstRun.updatedAt, cascadeConfirmed: false,
    }), context(firstRun.id));
    expect(guarded.status).toBe(409);
    expect(await guarded.json()).toMatchObject({
      code: "MEASURE_RUN_HAS_DEPENDENCIES",
      details: { dependencies: { measurementJobs: 1, reportPresets: 1 }, total: 2 },
    });

    const deleted = await deleteRun(request(`http://localhost/api/measure-runs/${firstRun.id}`, "DELETE", {
      expectedUpdatedAt: firstRun.updatedAt, cascadeConfirmed: true,
    }), context(firstRun.id));
    expect(deleted.status).toBe(204);
    expect(sqlite.prepare("SELECT id FROM measure_runs WHERE id = ?").get(firstRun.id)).toBeUndefined();
    expect((sqlite.prepare("SELECT COUNT(*) AS count FROM measure_results WHERE run_id = ?").get(firstRun.id) as { count: number }).count).toBe(0);
    expect((sqlite.prepare("SELECT run_id FROM measurement_jobs WHERE idempotency_key = 'run-delete-job'").get() as { run_id: number | null }).run_id).toBeNull();
    expect((sqlite.prepare("SELECT run_id FROM report_presets WHERE name = '측정 리포트'").get() as { run_id: number | null }).run_id).toBeNull();
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
  });

  it("rejects deleting a running row and returns 404 after deletion", async () => {
    const sqlite = getDatabase().sqlite;
    const now = new Date().toISOString();
    const runningId = Number(sqlite.prepare(`
      INSERT INTO measure_runs (project_id, title, status, models, repetitions, total_queries, summary, created_at, updated_at)
      VALUES (?, '실행 중', 'running', '[]', 1, 1, '{}', ?, ?)
    `).run(projectId, now, now).lastInsertRowid);
    const running = await deleteRun(request(`http://localhost/api/measure-runs/${runningId}`, "DELETE", {
      expectedUpdatedAt: now, cascadeConfirmed: true,
    }), context(runningId));
    expect(running.status).toBe(409);
    expect((await running.json()).code).toBe("MEASURE_RUN_IN_PROGRESS");

    const missing = await getRun(new NextRequest(`http://localhost/api/measure-runs/${firstRun.id}`), context(firstRun.id));
    expect(missing.status).toBe(404);
    expect((await missing.json()).code).toBe("MEASURE_RUN_NOT_FOUND");
  });
});
