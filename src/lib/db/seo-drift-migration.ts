import type Database from "better-sqlite3";

export function migrateSeoDrift(sqlite: Database.Database) {
  sqlite.exec(`
    CREATE TABLE seo_drift_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      campaign_id INTEGER NOT NULL REFERENCES site_audit_campaigns(id) ON DELETE CASCADE,
      change_set_id INTEGER NOT NULL REFERENCES change_sets(id) ON DELETE CASCADE,
      baseline_snapshot_id INTEGER NOT NULL REFERENCES page_snapshots(id),
      current_snapshot_id INTEGER NOT NULL REFERENCES page_snapshots(id),
      field TEXT NOT NULL,
      classification TEXT NOT NULL CHECK(classification IN ('expected','pending','unexpected','unknown')),
      approved_change INTEGER NOT NULL CHECK(approved_change IN (0,1)),
      before_value TEXT, after_value TEXT, expected_value TEXT,
      rule_id TEXT NOT NULL, rule_version TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL,
      UNIQUE(change_set_id,current_snapshot_id,field,rule_version)
    );
    CREATE INDEX idx_seo_drift_scope ON seo_drift_events(project_id,campaign_id,change_set_id,id DESC);
  `);
}
