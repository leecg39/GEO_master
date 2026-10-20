import type { DatabaseMigration } from "./utils";
import { addColumnIfMissing } from "./utils";

/** 기존 버전 1–5: SQL과 순서를 보존한다. */
export const coreMigrations: readonly DatabaseMigration[] = [
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
] as const;
