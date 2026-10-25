import type { DatabaseMigration } from "./utils";

export const haloMigrations: readonly DatabaseMigration[] = [{
  version: 32,
  name: "opportunities-and-library",
  up(sqlite) {
    for (const table of ["knowledge_documents", "writing_profiles"]) sqlite.exec(`
      CREATE TABLE ${table} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_${table}_project ON ${table}(project_id);
    `);
    sqlite.exec(`
      CREATE TABLE opportunities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        question TEXT NOT NULL, question_key TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('competitor_gap','citation_gap','unmeasured')),
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','dismissed','accepted')),
        notes TEXT NOT NULL DEFAULT '', evidence TEXT NOT NULL,
        question_id INTEGER REFERENCES questions(id) ON DELETE SET NULL,
        strategy_id INTEGER REFERENCES strategy_items(id) ON DELETE SET NULL,
        baseline_run_id INTEGER REFERENCES measure_runs(id) ON DELETE SET NULL,
        followup_run_id INTEGER REFERENCES measure_runs(id) ON DELETE SET NULL,
        applied_url TEXT NOT NULL DEFAULT '', applied_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(project_id, question_key, kind)
      );
      CREATE TABLE opportunity_decisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        opportunity_id INTEGER NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
        action TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
      );
      CREATE TABLE opportunity_contents (
        opportunity_id INTEGER NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
        content_id INTEGER NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
        PRIMARY KEY(opportunity_id, content_id)
      );
      CREATE TABLE studio_requests (
        request_id TEXT PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        request_hash TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('running','completed','failed')),
        created_at TEXT NOT NULL
      );
    `);
  },
}, {
  version: 33,
  name: "studio-execution-fencing-and-followup-evidence",
  up(sqlite) {
    sqlite.exec(`
      ALTER TABLE studio_requests ADD COLUMN execution_token TEXT NOT NULL DEFAULT '';
      ALTER TABLE opportunities ADD COLUMN followup_evidence TEXT NOT NULL DEFAULT 'null';
    `);
  },
}];
