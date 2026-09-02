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

export interface DatabaseMigration {
  version: number;
  name: string;
  up: (sqlite: Database.Database) => void;
}

function tableColumns(sqlite: Database.Database, table: string) {
  return new Set((sqlite.pragma(`table_info(${table})`) as { name: string }[]).map((column) => column.name));
}

function addColumnIfMissing(sqlite: Database.Database, table: string, column: string, definition: string) {
  if (!tableColumns(sqlite, table).has(column)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export const DATABASE_MIGRATIONS: readonly DatabaseMigration[] = [
  {
    version: 1,
    name: "settings-provider-columns",
    up(sqlite) {
      addColumnIfMissing(sqlite, "settings", "grok_api_key", "TEXT");
      addColumnIfMissing(sqlite, "settings", "subscription_pin", "TEXT");
    },
  },
  {
    version: 2,
    name: "automation-reconciliation-columns",
    up(sqlite) {
      addColumnIfMissing(sqlite, "measurement_schedules", "last_error_code", "TEXT");
      addColumnIfMissing(sqlite, "measurement_jobs", "incurred_cost_usd", "REAL NOT NULL DEFAULT 0");
      addColumnIfMissing(sqlite, "measurement_jobs", "provider_call_costs", "TEXT NOT NULL DEFAULT '{}'");
    },
  },
  {
    version: 3,
    name: "project-scoped-crud-resources",
    up(sqlite) {
      addColumnIfMissing(sqlite, "settings", "active_project_id", "INTEGER REFERENCES projects(id) ON DELETE SET NULL");
      addColumnIfMissing(sqlite, "question_sets", "updated_at", "TEXT NOT NULL DEFAULT ''");
      addColumnIfMissing(sqlite, "questions", "position", "INTEGER NOT NULL DEFAULT 0");
      addColumnIfMissing(sqlite, "questions", "updated_at", "TEXT NOT NULL DEFAULT ''");
      addColumnIfMissing(sqlite, "measure_runs", "title", "TEXT NOT NULL DEFAULT ''");
      addColumnIfMissing(sqlite, "measure_runs", "notes", "TEXT NOT NULL DEFAULT ''");
      addColumnIfMissing(sqlite, "measure_runs", "client_request_id", "TEXT");
      addColumnIfMissing(sqlite, "measure_runs", "updated_at", "TEXT NOT NULL DEFAULT ''");
      addColumnIfMissing(sqlite, "measurement_schedules", "project_id", "INTEGER REFERENCES projects(id) ON DELETE CASCADE");
      addColumnIfMissing(sqlite, "measurement_jobs", "project_id", "INTEGER REFERENCES projects(id) ON DELETE SET NULL");
      addColumnIfMissing(sqlite, "audits", "project_id", "INTEGER REFERENCES projects(id) ON DELETE CASCADE");
      addColumnIfMissing(sqlite, "audits", "title", "TEXT NOT NULL DEFAULT ''");
      addColumnIfMissing(sqlite, "audits", "notes", "TEXT NOT NULL DEFAULT ''");
      addColumnIfMissing(sqlite, "audits", "client_request_id", "TEXT");
      addColumnIfMissing(sqlite, "audits", "updated_at", "TEXT NOT NULL DEFAULT ''");
      addColumnIfMissing(sqlite, "contents", "project_id", "INTEGER REFERENCES projects(id) ON DELETE CASCADE");
      addColumnIfMissing(sqlite, "contents", "title", "TEXT NOT NULL DEFAULT ''");
      addColumnIfMissing(sqlite, "contents", "notes", "TEXT NOT NULL DEFAULT ''");
      addColumnIfMissing(sqlite, "contents", "status", "TEXT NOT NULL DEFAULT 'generated'");
      addColumnIfMissing(sqlite, "contents", "pinned", "INTEGER NOT NULL DEFAULT 0");
      addColumnIfMissing(sqlite, "contents", "provider", "TEXT");
      addColumnIfMissing(sqlite, "contents", "client_request_id", "TEXT");
      addColumnIfMissing(sqlite, "contents", "metadata", "TEXT NOT NULL DEFAULT '{}'");
      addColumnIfMissing(sqlite, "contents", "updated_at", "TEXT NOT NULL DEFAULT ''");
      addColumnIfMissing(sqlite, "checklist_states", "project_id", "INTEGER REFERENCES projects(id) ON DELETE CASCADE");
      addColumnIfMissing(sqlite, "checklist_states", "note", "TEXT NOT NULL DEFAULT ''");
      addColumnIfMissing(sqlite, "strategy_items", "project_id", "INTEGER REFERENCES projects(id) ON DELETE CASCADE");
      addColumnIfMissing(sqlite, "strategy_items", "parent_id", "INTEGER REFERENCES strategy_items(id) ON DELETE SET NULL");

      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS content_revisions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          content_id INTEGER NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
          revision INTEGER NOT NULL,
          input TEXT NOT NULL,
          output TEXT NOT NULL,
          origin TEXT NOT NULL DEFAULT 'generated',
          created_at TEXT NOT NULL,
          UNIQUE(content_id, revision)
        );
        CREATE TABLE IF NOT EXISTS llms_documents (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          website TEXT NOT NULL,
          brand_name TEXT NOT NULL DEFAULT '',
          summary TEXT NOT NULL DEFAULT '',
          details TEXT NOT NULL DEFAULT '',
          resources TEXT NOT NULL DEFAULT '[]',
          document TEXT NOT NULL DEFAULT '',
          validation TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','validated','deployed')),
          remote_url TEXT,
          remote_content_type TEXT,
          remote_checked_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS report_presets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          kind TEXT NOT NULL CHECK(kind IN ('audit','share')),
          audit_id INTEGER REFERENCES audits(id) ON DELETE SET NULL,
          run_id INTEGER REFERENCES measure_runs(id) ON DELETE SET NULL,
          config TEXT NOT NULL DEFAULT '{}',
          default_format TEXT NOT NULL DEFAULT 'pdf' CHECK(default_format IN ('json','csv','pdf')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS workspace_backups (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
          name TEXT NOT NULL,
          schema_version INTEGER NOT NULL,
          snapshot TEXT NOT NULL,
          checksum TEXT NOT NULL,
          bytes INTEGER NOT NULL CHECK(bytes >= 0),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);

      let project = sqlite.prepare("SELECT id FROM projects ORDER BY id LIMIT 1").get() as { id: number } | undefined;
      if (!project) {
        const legacy = sqlite.prepare(`
          SELECT brand_name, category, competitors, created_at, updated_at FROM settings WHERE id = 1
        `).get() as { brand_name: string; category: string; competitors: string; created_at: string; updated_at: string } | undefined;
        if (legacy) {
          const result = sqlite.prepare(`
            INSERT INTO projects (name, brand_name, category, competitors, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(
            legacy.brand_name || "기본 프로젝트",
            legacy.brand_name,
            legacy.category,
            legacy.competitors,
            legacy.created_at,
            legacy.updated_at,
          );
          project = { id: Number(result.lastInsertRowid) };
        }
      }

      if (project) {
        const id = project.id;
        sqlite.prepare("UPDATE settings SET active_project_id = COALESCE(active_project_id, ?) WHERE id = 1").run(id);
        for (const table of ["question_sets", "measure_runs", "measurement_schedules", "audits", "contents", "checklist_states", "strategy_items"]) {
          sqlite.prepare(`UPDATE ${table} SET project_id = ? WHERE project_id IS NULL`).run(id);
        }
        sqlite.prepare(`
          UPDATE measurement_jobs SET project_id = COALESCE(
            (SELECT project_id FROM measurement_schedules WHERE measurement_schedules.id = measurement_jobs.schedule_id),
            (SELECT project_id FROM measure_runs WHERE measure_runs.id = measurement_jobs.run_id),
            ?
          ) WHERE project_id IS NULL
        `).run(id);
      }

      for (const table of ["question_sets", "questions", "measure_runs", "audits", "contents"]) {
        sqlite.exec(`UPDATE ${table} SET updated_at = created_at WHERE updated_at = ''`);
      }

      sqlite.exec(`
        CREATE INDEX IF NOT EXISTS idx_question_sets_project ON question_sets(project_id, created_at DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_questions_set_position ON questions(question_set_id, position, id);
        CREATE INDEX IF NOT EXISTS idx_measure_runs_project_created ON measure_runs(project_id, created_at DESC, id DESC);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_measure_runs_request ON measure_runs(client_request_id) WHERE client_request_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_schedules_project_created ON measurement_schedules(project_id, created_at DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_jobs_project_status ON measurement_jobs(project_id, status, id DESC);
        CREATE INDEX IF NOT EXISTS idx_audits_project_created ON audits(project_id, created_at DESC, id DESC);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_audits_request ON audits(client_request_id) WHERE client_request_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_contents_project_tool ON contents(project_id, tool, created_at DESC, id DESC);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_contents_request ON contents(client_request_id) WHERE client_request_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_content_revisions_content ON content_revisions(content_id, revision DESC);
        CREATE INDEX IF NOT EXISTS idx_checklist_project_scope ON checklist_states(project_id, scope, item_key);
        CREATE INDEX IF NOT EXISTS idx_strategy_project_type ON strategy_items(project_id, type, created_at DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_llms_documents_project ON llms_documents(project_id, updated_at DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_report_presets_project ON report_presets(project_id, updated_at DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_workspace_backups_created ON workspace_backups(created_at DESC, id DESC);
      `);
    },
  },
  {
    version: 4,
    name: "content-revision-baseline",
    up(sqlite) {
      sqlite.exec(`
        INSERT INTO content_revisions (content_id, revision, input, output, origin, created_at)
        SELECT c.id, 1, c.input, c.output, 'generated', c.created_at
        FROM contents c
        WHERE NOT EXISTS (
          SELECT 1 FROM content_revisions r WHERE r.content_id = c.id
        );
        CREATE INDEX IF NOT EXISTS idx_contents_project_status
          ON contents(project_id, status, created_at DESC, id DESC);
      `);
    },
  },
  {
    version: 5,
    name: "checklist-project-unique",
    up(sqlite) {
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS checklist_states_v5 (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
          scope TEXT NOT NULL,
          item_key TEXT NOT NULL,
          checked INTEGER NOT NULL DEFAULT 0,
          note TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL,
          UNIQUE(project_id, scope, item_key)
        );
        INSERT INTO checklist_states_v5 (id, project_id, scope, item_key, checked, note, updated_at)
        SELECT id, project_id, scope, item_key, checked, COALESCE(note, ''), updated_at FROM checklist_states;
        DROP TABLE checklist_states;
        ALTER TABLE checklist_states_v5 RENAME TO checklist_states;
        CREATE INDEX IF NOT EXISTS idx_checklist_project_scope ON checklist_states(project_id, scope, item_key);
      `);
    },
  },
  {
    version: 6,
    name: "semforge-integration-and-subscription",
    up(sqlite) {
      addColumnIfMissing(sqlite, "projects", "domain", "TEXT NOT NULL DEFAULT ''");
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS semforge_subscriptions (
          id INTEGER PRIMARY KEY,
          status TEXT NOT NULL DEFAULT 'inactive' CHECK(status IN ('inactive','pending','active','past_due','canceled')),
          amount_krw INTEGER NOT NULL DEFAULT 300000,
          current_period_start TEXT,
          current_period_end TEXT,
          canceled_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT OR IGNORE INTO semforge_subscriptions (id, status, amount_krw, created_at, updated_at)
        VALUES (1, 'inactive', 300000, datetime('now'), datetime('now'));

        CREATE TABLE IF NOT EXISTS semforge_payment_intents (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          amount_krw INTEGER NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('pending','paid','failed','expired')),
          provider TEXT NOT NULL DEFAULT 'toss',
          provider_order_id TEXT NOT NULL UNIQUE,
          confirm_token_hash TEXT,
          checkout_url TEXT,
          paid_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sites (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          domain TEXT NOT NULL,
          name TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(project_id, domain)
        );

        CREATE TABLE IF NOT EXISTS ai_visibility_queries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          domain TEXT NOT NULL,
          query TEXT NOT NULL,
          normalized_query TEXT NOT NULL,
          country_code TEXT NOT NULL DEFAULT 'KR',
          device TEXT NOT NULL DEFAULT 'desktop',
          deleted_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_visibility_query_unique
          ON ai_visibility_queries(project_id, domain, normalized_query, country_code, device)
          WHERE deleted_at IS NULL;

        CREATE TABLE IF NOT EXISTS ai_visibility_snapshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          query_id INTEGER NOT NULL REFERENCES ai_visibility_queries(id) ON DELETE CASCADE,
          aio_present INTEGER NOT NULL DEFAULT 0,
          cited INTEGER,
          cited_url TEXT,
          cited_domains TEXT NOT NULL DEFAULT '[]',
          organic_position INTEGER,
          features TEXT NOT NULL DEFAULT '[]',
          source TEXT NOT NULL DEFAULT 'talordata',
          captured_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS site_audit_campaigns (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          domain TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'idle',
          site_health INTEGER,
          last_run_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS site_audit_pages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          campaign_id INTEGER NOT NULL REFERENCES site_audit_campaigns(id) ON DELETE CASCADE,
          url TEXT NOT NULL,
          status_code INTEGER NOT NULL DEFAULT 0,
          title TEXT,
          depth INTEGER NOT NULL DEFAULT 0,
          response_ms INTEGER,
          bytes INTEGER NOT NULL DEFAULT 0,
          captured_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS site_audit_issues (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          campaign_id INTEGER NOT NULL REFERENCES site_audit_campaigns(id) ON DELETE CASCADE,
          url TEXT NOT NULL,
          severity TEXT NOT NULL,
          category TEXT NOT NULL,
          title TEXT NOT NULL,
          detail TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS position_tracking_campaigns (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          domain TEXT NOT NULL,
          search_engine TEXT NOT NULL DEFAULT 'google',
          device TEXT NOT NULL DEFAULT 'desktop',
          location TEXT NOT NULL DEFAULT 'KR',
          visibility INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS tracked_keywords (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          campaign_id INTEGER NOT NULL REFERENCES position_tracking_campaigns(id) ON DELETE CASCADE,
          keyword TEXT NOT NULL,
          position INTEGER,
          previous_position INTEGER,
          volume INTEGER,
          deleted_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS gsc_connections (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          site_url TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'disconnected',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS gbp_connections (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          location_name TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'disconnected',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_sites_project ON sites(project_id, domain);
        CREATE INDEX IF NOT EXISTS idx_ai_visibility_project ON ai_visibility_queries(project_id, domain, deleted_at);
        CREATE INDEX IF NOT EXISTS idx_ai_visibility_snapshots ON ai_visibility_snapshots(query_id, captured_at DESC);
        CREATE INDEX IF NOT EXISTS idx_site_audit_campaigns ON site_audit_campaigns(project_id, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_position_campaigns ON position_tracking_campaigns(project_id, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_tracked_keywords ON tracked_keywords(campaign_id, deleted_at);
      `);
    },
  },
  {
    version: 7,
    name: "settings-talordata-api-token",
    up(sqlite) {
      addColumnIfMissing(sqlite, "settings", "talordata_api_token", "TEXT");
    },
  },
  {
    version: 8,
    name: "settings-firecrawl-api-key",
    up(sqlite) {
      addColumnIfMissing(sqlite, "settings", "firecrawl_api_key", "TEXT");
    },
  },
] as const;

export const LATEST_SCHEMA_VERSION = DATABASE_MIGRATIONS.at(-1)?.version ?? 0;

export function applyDatabaseMigrations(
  sqlite: Database.Database,
  migrations: readonly DatabaseMigration[] = DATABASE_MIGRATIONS,
) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    )
  `);

  const ordered = [...migrations].sort((left, right) => left.version - right.version);
  const versions = new Set<number>();
  const names = new Set<string>();
  for (const migration of ordered) {
    if (!Number.isSafeInteger(migration.version) || migration.version <= 0) {
      throw new Error(`Invalid database migration version: ${migration.version}`);
    }
    if (!migration.name.trim() || versions.has(migration.version) || names.has(migration.name)) {
      throw new Error(`Duplicate or invalid database migration: ${migration.version}/${migration.name}`);
    }
    versions.add(migration.version);
    names.add(migration.name);
  }

  const applied = new Set((sqlite.prepare("SELECT version FROM schema_migrations").all() as { version: number }[]).map((row) => row.version));
  for (const migration of ordered) {
    if (applied.has(migration.version)) continue;
    sqlite.transaction(() => {
      migration.up(sqlite);
      const violations = sqlite.pragma("foreign_key_check") as unknown[];
      if (violations.length) throw new Error(`Foreign key check failed after migration ${migration.version}`);
      sqlite.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)")
        .run(migration.version, migration.name, new Date().toISOString());
    })();
  }
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
      grok_api_key TEXT,
      subscription_pin TEXT,
      talordata_api_token TEXT,
      firecrawl_api_key TEXT,
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
  applyDatabaseMigrations(sqlite);
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
