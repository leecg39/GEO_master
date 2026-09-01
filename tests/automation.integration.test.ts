import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/llm", () => ({ generateText: vi.fn() }));

import {
  cancelJob,
  claimNextJob,
  createSchedule,
  enqueueDueSchedules,
  getAutomationState,
  processAutomationQueue,
  processNextJob,
  recoverStaleJobs,
  retryJob,
  runScheduleNow,
  updateAutomationPolicy,
} from "@/lib/automation";
import { closeDatabase, getDatabase } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { generateText } from "@/lib/llm";
import { ensureActiveProject, updateProject } from "@/lib/projects";
import { getPublicSettings, updateSettings } from "@/lib/settings";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-automation-test-"));
const databasePath = path.join(tempDir, "geo.db");
const previousDb = process.env.GEO_DB_PATH;
const previousKey = process.env.GEO_MASTER_KEY;
const previousWorker = process.env.GEO_DISABLE_AUTOMATION_WORKER;
const baseSchedule = {
  name: "매일 핵심 질문",
  questions: ["좋은 분석 도구의 기준은 무엇인가요?"],
  providers: ["openai"] as const,
  repetitions: 1,
  intervalMinutes: 1_440,
  nextRunAt: "2026-09-02T00:00:00.000Z",
  enabled: false,
};

beforeAll(() => {
  process.env.GEO_DB_PATH = databasePath;
  process.env.GEO_MASTER_KEY = "automation-integration-master-key-32-chars";
  process.env.GEO_DISABLE_AUTOMATION_WORKER = "1";
  const activeProject = ensureActiveProject();
  updateProject(activeProject.id, {
    name: "브랜드Z", brandName: "브랜드Z", category: "분석 도구", competitors: ["경쟁사A"],
    expectedUpdatedAt: activeProject.updatedAt,
  });
  updateSettings({
    models: { openai: "gpt-test", anthropic: "claude-test", gemini: "gemini-test", grok: "grok-4.6" },
    repetitions: 1,
    modelWeights: { openai: 1, anthropic: 0, gemini: 0, grok: 0 },
    apiKeys: { openai: "sk-automation-secret" },
    expectedUpdatedAt: getPublicSettings().updatedAt,
  });
});

beforeEach(() => {
  const sqlite = getDatabase().sqlite;
  sqlite.exec(`
    DELETE FROM measurement_jobs;
    DELETE FROM measurement_schedules;
    DELETE FROM measure_results;
    DELETE FROM measure_runs;
  `);
  updateAutomationPolicy({
    monthlyBudgetUsd: 100,
    maxRunCostUsd: 10,
    providerCallCosts: { openai: 0.01, anthropic: 0.015, gemini: 0.005, grok: 0.005 },
    alertThreshold: 0.8,
  });
  vi.mocked(generateText).mockReset();
});

afterAll(() => {
  closeDatabase(databasePath);
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (previousDb === undefined) delete process.env.GEO_DB_PATH; else process.env.GEO_DB_PATH = previousDb;
  if (previousKey === undefined) delete process.env.GEO_MASTER_KEY; else process.env.GEO_MASTER_KEY = previousKey;
  if (previousWorker === undefined) delete process.env.GEO_DISABLE_AUTOMATION_WORKER; else process.env.GEO_DISABLE_AUTOMATION_WORKER = previousWorker;
});

describe("persistent measurement automation", () => {
  it("creates the three automation tables without storing API keys in schedule or job payloads", () => {
    const sqlite = getDatabase().sqlite;
    const tables = (sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((row) => row.name);
    expect(tables).toEqual(expect.arrayContaining(["measurement_schedules", "measurement_jobs", "automation_policy"]));
    const schedule = createSchedule(baseSchedule);
    const job = runScheduleNow(schedule.id);
    const raw = sqlite.prepare("SELECT payload FROM measurement_jobs WHERE id = ?").get(job.id) as { payload: string };
    expect(raw.payload).not.toContain("sk-automation-secret");
    expect(raw.payload).not.toContain("apiKey");
  });

  it("blocks a run atomically when the per-run or monthly budget would be exceeded", () => {
    updateAutomationPolicy({
      monthlyBudgetUsd: 0.03,
      maxRunCostUsd: 1,
      providerCallCosts: { openai: 0.01, anthropic: 0.015, gemini: 0.005, grok: 0.005 },
      alertThreshold: 0.8,
    });
    const schedule = createSchedule(baseSchedule);
    expect(runScheduleNow(schedule.id).status).toBe("queued");
    const blocked = runScheduleNow(schedule.id);
    expect(blocked.status).toBe("blocked");
    expect(blocked.errorCode).toBe("MONTHLY_BUDGET_EXCEEDED");
    expect(getAutomationState().budget.usedUsd).toBe(0.02);

    updateAutomationPolicy({
      monthlyBudgetUsd: 100,
      maxRunCostUsd: 0.01,
      providerCallCosts: { openai: 0.01, anthropic: 0.015, gemini: 0.005, grok: 0.005 },
      alertThreshold: 0.8,
    });
    expect(runScheduleNow(schedule.id).errorCode).toBe("RUN_COST_LIMIT_EXCEEDED");
  });

  it("coalesces missed schedule slots and uses an idempotency key to prevent duplicate jobs", () => {
    const schedule = createSchedule({ ...baseSchedule, enabled: true, nextRunAt: "2026-09-01T00:00:00.000Z" });
    const now = new Date("2026-09-03T12:00:00.000Z");
    expect(enqueueDueSchedules(now)).toHaveLength(1);
    expect(enqueueDueSchedules(now)).toHaveLength(0);
    const sqlite = getDatabase().sqlite;
    expect((sqlite.prepare("SELECT COUNT(*) AS count FROM measurement_jobs").get() as { count: number }).count).toBe(1);
    expect((sqlite.prepare("SELECT next_run_at FROM measurement_schedules WHERE id = ?").get(schedule.id) as { next_run_at: string }).next_run_at)
      .toBe("2026-09-04T00:00:00.000Z");
  });

  it("claims each queued job at most once", () => {
    const schedule = createSchedule(baseSchedule);
    runScheduleNow(schedule.id);
    expect(claimNextJob("worker-a", new Date("2099-09-01T00:00:00.000Z"))?.status).toBe("running");
    expect(claimNextJob("worker-b", new Date("2099-09-01T00:00:00.000Z"))).toBeNull();
  });

  it("marks stale jobs and their orphan measure run failed instead of silently replaying cost", () => {
    const sqlite = getDatabase().sqlite;
    const schedule = createSchedule(baseSchedule);
    const job = runScheduleNow(schedule.id);
    claimNextJob("dead-worker", new Date("2099-09-01T00:00:00.000Z"));
    const runId = Number(sqlite.prepare(`
      INSERT INTO measure_runs (status, models, repetitions, total_queries, created_at)
      VALUES ('running', '[]', 1, 1, '2026-09-01T00:00:00.000Z')
    `).run().lastInsertRowid);
    sqlite.prepare("UPDATE measurement_jobs SET run_id = ?, lease_expires_at = ? WHERE id = ?")
      .run(runId, "2026-09-01T00:01:00.000Z", job.id);
    expect(recoverStaleJobs(new Date("2026-09-01T00:02:00.000Z"))).toBe(1);
    expect((sqlite.prepare("SELECT status FROM measurement_jobs WHERE id = ?").get(job.id) as { status: string }).status).toBe("failed");
    expect((sqlite.prepare("SELECT status FROM measure_runs WHERE id = ?").get(runId) as { status: string }).status).toBe("failed");
  });

  it("runs a queued measurement through the existing atomic pipeline", async () => {
    vi.mocked(generateText).mockResolvedValue("브랜드Z를 추천할 수 있습니다.");
    const schedule = createSchedule(baseSchedule);
    const job = runScheduleNow(schedule.id);
    const completed = await processNextJob({ workerId: "test-worker" });
    expect(completed).toMatchObject({ id: job.id, status: "completed", incurredCostUsd: 0.02 });
    expect(getAutomationState().budget).toMatchObject({ usedUsd: 0.02, reservedUsd: 0, consumedUsd: 0.02 });
    const sqlite = getDatabase().sqlite;
    expect((sqlite.prepare("SELECT status FROM measure_runs WHERE id = ?").get(completed?.runId) as { status: string }).status).toBe("completed");
    expect((sqlite.prepare("SELECT COUNT(*) AS count FROM measure_results WHERE run_id = ?").get(completed?.runId) as { count: number }).count).toBe(1);
  });

  it("releases queued reservations on cancel and charges a new explicit retry", () => {
    const schedule = createSchedule(baseSchedule);
    const job = runScheduleNow(schedule.id);
    expect(getAutomationState().budget.usedUsd).toBe(0.02);
    expect(cancelJob(job.id).status).toBe("canceled");
    expect(getAutomationState().budget.usedUsd).toBe(0);
    const retried = retryJob(job.id);
    expect(retried).toMatchObject({ status: "queued", attemptOfId: job.id });
    expect(getAutomationState().budget.usedUsd).toBe(0.02);
  });

  it("cooperatively cancels a running job and stores only a stable error code", async () => {
    const schedule = createSchedule(baseSchedule);
    const job = runScheduleNow(schedule.id);
    const result = await processNextJob({
      workerId: "cancel-worker",
      execute: async (_input, options) => {
        options?.onBillableCall?.("openai");
        cancelJob(job.id);
        if (options?.shouldCancel?.()) throw new AppError("sensitive upstream text", 409, "JOB_CANCELED");
        return { id: 1 };
      },
    });
    expect(result).toMatchObject({ status: "canceled", errorCode: "JOB_CANCELED", incurredCostUsd: 0.01 });
    expect(getAutomationState().budget).toMatchObject({ usedUsd: 0.01, reservedUsd: 0, consumedUsd: 0.01 });
    const raw = getDatabase().sqlite.prepare("SELECT error_code FROM measurement_jobs WHERE id = ?").get(job.id) as { error_code: string };
    expect(raw.error_code).not.toContain("sensitive upstream text");
  });

  it("settles a failed run to attempted calls instead of retaining the maximum reservation", async () => {
    vi.mocked(generateText).mockRejectedValue(new Error("provider failed"));
    const schedule = createSchedule(baseSchedule);
    const job = runScheduleNow(schedule.id);
    const failed = await processNextJob({ workerId: "failure-worker" });
    expect(failed).toMatchObject({ id: job.id, status: "failed", incurredCostUsd: 0.01 });
    expect(getAutomationState().budget).toMatchObject({ usedUsd: 0.01, reservedUsd: 0, consumedUsd: 0.01 });
  });

  it("reconciles a late successful run after a stale lease race", async () => {
    const sqlite = getDatabase().sqlite;
    const schedule = createSchedule(baseSchedule);
    const job = runScheduleNow(schedule.id);
    const result = await processNextJob({
      workerId: "late-worker",
      now: new Date("2099-09-01T00:00:00.000Z"),
      execute: async (_input, options) => {
        const runId = Number(sqlite.prepare(`
          INSERT INTO measure_runs (status, models, repetitions, total_queries, created_at)
          VALUES ('running', '[]', 1, 1, '2026-09-01T00:00:00.000Z')
        `).run().lastInsertRowid);
        options?.onRunCreated?.(runId);
        sqlite.prepare("UPDATE measurement_jobs SET lease_expires_at = ? WHERE id = ?")
          .run("2026-09-01T00:01:00.000Z", job.id);
        recoverStaleJobs(new Date("2026-09-01T00:02:00.000Z"));
        sqlite.prepare("UPDATE measure_runs SET status = 'completed', completed_at = ? WHERE id = ?")
          .run("2026-09-01T00:03:00.000Z", runId);
        return { id: runId };
      },
    });
    expect(result).toMatchObject({ status: "completed", errorCode: null });
  });

  it("keeps automation state readable and records why corrupt schedules are disabled", () => {
    const sqlite = getDatabase().sqlite;
    const schedule = createSchedule({ ...baseSchedule, enabled: true, nextRunAt: "2026-09-01T00:00:00.000Z" });
    sqlite.prepare("UPDATE measurement_schedules SET questions = 'not-json' WHERE id = ?").run(schedule.id);
    expect(getAutomationState().schedules[0]).toMatchObject({ id: schedule.id, lastErrorCode: "INVALID_SCHEDULE_DATA" });
    expect(enqueueDueSchedules(new Date("2026-09-01T01:00:00.000Z"))).toHaveLength(0);
    expect(getAutomationState().schedules[0]).toMatchObject({ enabled: false, lastErrorCode: "INVALID_SCHEDULE_DATA" });
  });

  it("serializes API and background queue processing with a shared process lock", async () => {
    const schedule = createSchedule(baseSchedule);
    runScheduleNow(schedule.id);
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const began = new Promise<void>((resolve) => { started = resolve; });
    const first = processAutomationQueue({
      workerId: "locked-worker",
      execute: async () => {
        started();
        await gate;
        throw new Error("expected test failure");
      },
    });
    await began;
    expect(await processAutomationQueue({ workerId: "competing-worker" })).toBeNull();
    release();
    expect(await first).toMatchObject({ status: "failed" });
  });

});
