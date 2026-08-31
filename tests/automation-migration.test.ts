import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDatabase, getDatabase } from "@/lib/db";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-automation-migration-"));
const databasePath = path.join(tempDir, "legacy.db");
const previousDb = process.env.GEO_DB_PATH;

beforeAll(() => {
  const sqlite = new Database(databasePath);
  sqlite.exec(`
    CREATE TABLE measurement_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, questions TEXT NOT NULL,
      providers TEXT NOT NULL, repetitions INTEGER NOT NULL, interval_minutes INTEGER NOT NULL,
      next_run_at TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE measurement_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, schedule_id INTEGER, run_id INTEGER, attempt_of_id INTEGER,
      status TEXT NOT NULL, payload TEXT NOT NULL, idempotency_key TEXT NOT NULL,
      estimated_cost_usd REAL NOT NULL, budget_period TEXT NOT NULL, budget_charged INTEGER NOT NULL DEFAULT 0,
      error_code TEXT, available_at TEXT NOT NULL, worker_id TEXT, lease_expires_at TEXT,
      cancel_requested INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, started_at TEXT,
      completed_at TEXT, updated_at TEXT NOT NULL
    );
    INSERT INTO measurement_schedules (
      name, questions, providers, repetitions, interval_minutes, next_run_at, enabled, created_at, updated_at
    ) VALUES ('기존 예약', '["질문입니다"]', '["openai"]', 1, 1440, '2026-09-02T00:00:00.000Z', 0, '2026-09-01', '2026-09-01');
    INSERT INTO measurement_jobs (
      schedule_id, status, payload, idempotency_key, estimated_cost_usd, budget_period,
      budget_charged, available_at, created_at, updated_at
    ) VALUES (1, 'queued', '{"questions":["질문입니다"],"providers":["openai"],"repetitions":1}',
      'legacy-job', 0.02, '2026-09', 1, '2026-09-01', '2026-09-01', '2026-09-01');
  `);
  sqlite.close();
  process.env.GEO_DB_PATH = databasePath;
});

afterAll(() => {
  closeDatabase(databasePath);
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (previousDb === undefined) delete process.env.GEO_DB_PATH; else process.env.GEO_DB_PATH = previousDb;
});

describe("automation cost migration", () => {
  it("adds reconciliation columns and preserves existing schedules and jobs", () => {
    const sqlite = getDatabase().sqlite;
    const scheduleColumns = (sqlite.pragma("table_info(measurement_schedules)") as { name: string }[]).map((column) => column.name);
    const jobColumns = (sqlite.pragma("table_info(measurement_jobs)") as { name: string }[]).map((column) => column.name);
    expect(scheduleColumns).toContain("last_error_code");
    expect(jobColumns).toEqual(expect.arrayContaining(["incurred_cost_usd", "provider_call_costs"]));
    expect((sqlite.prepare("SELECT name FROM measurement_schedules WHERE id = 1").get() as { name: string }).name).toBe("기존 예약");
    expect((sqlite.prepare("SELECT idempotency_key, incurred_cost_usd FROM measurement_jobs WHERE id = 1").get() as { idempotency_key: string; incurred_cost_usd: number }))
      .toEqual({ idempotency_key: "legacy-job", incurred_cost_usd: 0 });
  });
});
