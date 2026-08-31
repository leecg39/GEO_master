import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

function resolveDatabasePath() {
  const configured = process.env.GEO_DB_PATH?.trim();
  return configured
    ? path.resolve(configured)
    : path.join(process.cwd(), "data", "geo.db");
}

export function getDatabasePath() {
  return resolveDatabasePath();
}

function bootstrap(sqlite: Database.Database) {
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("journal_mode = WAL");
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY,
      brand_name TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      competitors TEXT NOT NULL DEFAULT '[]',
      openai_api_key TEXT,
      anthropic_api_key TEXT,
      gemini_api_key TEXT,
      hyperclova_api_key TEXT,
      models TEXT NOT NULL DEFAULT '{}',
      repetitions INTEGER NOT NULL DEFAULT 3,
      model_weights TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      brand_name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      competitors TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS question_sets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_set_id INTEGER REFERENCES question_sets(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT '직접 입력',
      intent TEXT NOT NULL DEFAULT '정보 탐색형',
      segment TEXT NOT NULL DEFAULT '전체',
      journey_stage TEXT NOT NULL DEFAULT '탐색',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS measure_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      status TEXT NOT NULL,
      models TEXT NOT NULL,
      repetitions INTEGER NOT NULL,
      total_queries INTEGER NOT NULL,
      answer_share REAL NOT NULL DEFAULT 0,
      genrank REAL NOT NULL DEFAULT 0,
      funnel_stage TEXT NOT NULL DEFAULT '존재',
      summary TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS measure_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL REFERENCES measure_runs(id) ON DELETE CASCADE,
      question_text TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      repetition INTEGER NOT NULL,
      response TEXT NOT NULL,
      brand_mentioned INTEGER NOT NULL,
      sentiment TEXT NOT NULL,
      mention_rank INTEGER,
      competitor_mentions TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS measurement_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      questions TEXT NOT NULL,
      providers TEXT NOT NULL,
      repetitions INTEGER NOT NULL,
      interval_minutes INTEGER NOT NULL,
      next_run_at TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0,
      last_error_code TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS automation_policy (
      id INTEGER PRIMARY KEY,
      monthly_budget_usd REAL NOT NULL DEFAULT 0,
      max_run_cost_usd REAL NOT NULL DEFAULT 0,
      provider_call_costs TEXT NOT NULL DEFAULT '{}',
      alert_threshold REAL NOT NULL DEFAULT 0.8,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS measurement_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schedule_id INTEGER REFERENCES measurement_schedules(id) ON DELETE SET NULL,
      run_id INTEGER REFERENCES measure_runs(id) ON DELETE SET NULL,
      attempt_of_id INTEGER,
      status TEXT NOT NULL CHECK(status IN ('queued','running','completed','failed','canceled','blocked')),
      payload TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      estimated_cost_usd REAL NOT NULL,
      incurred_cost_usd REAL NOT NULL DEFAULT 0,
      provider_call_costs TEXT NOT NULL DEFAULT '{}',
      budget_period TEXT NOT NULL,
      budget_charged INTEGER NOT NULL DEFAULT 0,
      error_code TEXT,
      available_at TEXT NOT NULL,
      worker_id TEXT,
      lease_expires_at TEXT,
      cancel_requested INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      score INTEGER NOT NULL,
      grade TEXT NOT NULL,
      items TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      audit_id INTEGER NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      category TEXT NOT NULL,
      passed INTEGER NOT NULL,
      manual INTEGER NOT NULL,
      detail TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS contents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tool TEXT NOT NULL,
      input TEXT NOT NULL,
      output TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS checklist_states (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL,
      item_key TEXT NOT NULL,
      checked INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      UNIQUE(scope, item_key)
    );
    CREATE TABLE IF NOT EXISTS strategy_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      data TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT '계획',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_measure_results_run ON measure_results(run_id);
    CREATE INDEX IF NOT EXISTS idx_measure_runs_created ON measure_runs(created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_measurement_jobs_idempotency ON measurement_jobs(idempotency_key);
    CREATE INDEX IF NOT EXISTS idx_measurement_jobs_claim ON measurement_jobs(status, available_at, id);
    CREATE INDEX IF NOT EXISTS idx_measurement_jobs_budget ON measurement_jobs(budget_period, budget_charged);
    CREATE INDEX IF NOT EXISTS idx_measurement_schedules_due ON measurement_schedules(enabled, next_run_at);
    CREATE INDEX IF NOT EXISTS idx_audits_created ON audits(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_strategy_type ON strategy_items(type);
  `);
  const settingsColumns = sqlite.pragma("table_info(settings)") as { name: string }[];
  if (!settingsColumns.some((column) => column.name === "hyperclova_api_key")) {
    sqlite.exec("ALTER TABLE settings ADD COLUMN hyperclova_api_key TEXT");
  }
  const scheduleColumns = sqlite.pragma("table_info(measurement_schedules)") as { name: string }[];
  if (!scheduleColumns.some((column) => column.name === "last_error_code")) {
    sqlite.exec("ALTER TABLE measurement_schedules ADD COLUMN last_error_code TEXT");
  }
  const jobColumns = sqlite.pragma("table_info(measurement_jobs)") as { name: string }[];
  if (!jobColumns.some((column) => column.name === "incurred_cost_usd")) {
    sqlite.exec("ALTER TABLE measurement_jobs ADD COLUMN incurred_cost_usd REAL NOT NULL DEFAULT 0");
  }
  if (!jobColumns.some((column) => column.name === "provider_call_costs")) {
    sqlite.exec("ALTER TABLE measurement_jobs ADD COLUMN provider_call_costs TEXT NOT NULL DEFAULT '{}'");
  }
}

function createDatabase(databasePath: string) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const sqlite = new Database(databasePath);
  bootstrap(sqlite);
  return { sqlite, orm: drizzle(sqlite, { schema }) };
}

type DatabaseBundle = ReturnType<typeof createDatabase>;
const globalStore = globalThis as typeof globalThis & {
  __geoDatabases?: Map<string, DatabaseBundle>;
};

export function getDatabase(): DatabaseBundle {
  const databasePath = resolveDatabasePath();
  globalStore.__geoDatabases ??= new Map();
  const cached = globalStore.__geoDatabases.get(databasePath);
  if (cached?.sqlite.open) return cached;
  const created = createDatabase(databasePath);
  globalStore.__geoDatabases.set(databasePath, created);
  return created;
}

export function closeDatabase(databasePath = resolveDatabasePath()) {
  const cached = globalStore.__geoDatabases?.get(databasePath);
  if (cached?.sqlite.open) cached.sqlite.close();
  globalStore.__geoDatabases?.delete(databasePath);
}
