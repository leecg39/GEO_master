import type Database from "better-sqlite3";

/** Old boolean diagnostics remain intact; absent v2 analysis means unversioned, not passed. */
export function migrateSeoAnalysis(sqlite: Database.Database) {
  sqlite.exec(`
    ALTER TABLE page_snapshots ADD COLUMN response_headers TEXT NOT NULL DEFAULT '{}';
    ALTER TABLE page_snapshots ADD COLUMN analysis TEXT;
    ALTER TABLE site_audit_campaigns ADD COLUMN analysis_version TEXT;
    ALTER TABLE site_audit_campaigns ADD COLUMN analysis_config_hash TEXT;
    ALTER TABLE site_audit_campaigns ADD COLUMN score_coverage INTEGER;
    ALTER TABLE site_audit_issues ADD COLUMN finding_id TEXT;
    ALTER TABLE site_audit_issues ADD COLUMN snapshot_id INTEGER REFERENCES page_snapshots(id) ON DELETE SET NULL;
    ALTER TABLE site_audit_issues ADD COLUMN rule_version TEXT;
    ALTER TABLE site_audit_issues ADD COLUMN finding_status TEXT;
    ALTER TABLE site_audit_issues ADD COLUMN evidence_refs TEXT;
  `);
}
