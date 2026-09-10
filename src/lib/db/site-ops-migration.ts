import type Database from "better-sqlite3";

/** Additive migration: historical estimates remain available with explicit provenance. */
export function migrateSiteOps(sqlite: Database.Database) {
  sqlite.exec(`
    ALTER TABLE site_audit_campaigns ADD COLUMN data_state TEXT NOT NULL DEFAULT 'legacy_estimate';
    ALTER TABLE site_audit_campaigns ADD COLUMN llms_state TEXT NOT NULL DEFAULT 'unknown';
    ALTER TABLE site_audit_campaigns ADD COLUMN run_token TEXT;
    ALTER TABLE site_audit_issues ADD COLUMN data_state TEXT NOT NULL DEFAULT 'legacy_estimate';
    CREATE TABLE site_connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      campaign_id INTEGER NOT NULL UNIQUE REFERENCES site_audit_campaigns(id) ON DELETE CASCADE,
      origin TEXT NOT NULL, editor TEXT NOT NULL DEFAULT 'qshop_site',
      ownership TEXT NOT NULL DEFAULT 'unverified',
      capabilities TEXT NOT NULL DEFAULT '["public_read","manual_delivery"]',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE page_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      campaign_id INTEGER NOT NULL REFERENCES site_audit_campaigns(id) ON DELETE CASCADE,
      url TEXT NOT NULL, final_url TEXT, status_code INTEGER, content_type TEXT,
      fetch_state TEXT NOT NULL, data_state TEXT NOT NULL, render_mode TEXT NOT NULL,
      captured_at TEXT, content_hash TEXT, revision_hash TEXT,
      response_ms INTEGER, bytes INTEGER, raw_html TEXT, markdown TEXT,
      metadata TEXT NOT NULL DEFAULT '{}', rules TEXT NOT NULL DEFAULT '[]',
      parser_version TEXT NOT NULL, error_code TEXT
    );
    CREATE INDEX idx_page_snapshots_scope ON page_snapshots(project_id, campaign_id, url, id DESC);
    CREATE TABLE site_audit_pages_v13 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL REFERENCES site_audit_campaigns(id) ON DELETE CASCADE,
      url TEXT NOT NULL, status_code INTEGER, title TEXT, depth INTEGER,
      response_ms INTEGER, bytes INTEGER, captured_at TEXT,
      data_state TEXT NOT NULL DEFAULT 'legacy_estimate',
      fetch_state TEXT NOT NULL DEFAULT 'discovered',
      snapshot_id INTEGER REFERENCES page_snapshots(id) ON DELETE SET NULL
    );
    INSERT INTO site_audit_pages_v13 (id,campaign_id,url,status_code,title,depth,response_ms,bytes,captured_at)
      SELECT id,campaign_id,url,status_code,title,depth,response_ms,bytes,captured_at FROM site_audit_pages;
    DROP TABLE site_audit_pages;
    ALTER TABLE site_audit_pages_v13 RENAME TO site_audit_pages;
    CREATE INDEX idx_site_audit_pages_campaign ON site_audit_pages(campaign_id, data_state);
    CREATE TABLE change_sets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      campaign_id INTEGER NOT NULL REFERENCES site_audit_campaigns(id) ON DELETE CASCADE,
      snapshot_id INTEGER NOT NULL REFERENCES page_snapshots(id),
      status TEXT NOT NULL DEFAULT 'draft', editor TEXT NOT NULL,
      approved_by TEXT, approved_at TEXT, delivered_at TEXT, verified_at TEXT,
      verification_snapshot_id INTEGER REFERENCES page_snapshots(id),
      verification TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_change_sets_scope ON change_sets(project_id,campaign_id,id DESC);
    CREATE TABLE integration_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      campaign_id INTEGER REFERENCES site_audit_campaigns(id) ON DELETE SET NULL,
      request_key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, status TEXT NOT NULL,
      budget_period TEXT NOT NULL, reserved_calls INTEGER NOT NULL DEFAULT 0,
      result TEXT, created_at TEXT NOT NULL, completed_at TEXT
    );
    CREATE INDEX idx_integration_jobs_budget ON integration_jobs(kind,budget_period);
    CREATE TABLE change_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      change_set_id INTEGER NOT NULL REFERENCES change_sets(id) ON DELETE CASCADE,
      field TEXT NOT NULL, before_value TEXT NOT NULL, after_value TEXT NOT NULL,
      reason TEXT NOT NULL, evidence TEXT NOT NULL,
      UNIQUE(change_set_id,field)
    );
    ALTER TABLE llms_documents ADD COLUMN target_path TEXT NOT NULL DEFAULT '/llms.txt';
    ALTER TABLE llms_documents ADD COLUMN language TEXT NOT NULL DEFAULT 'ko';
    ALTER TABLE llms_documents ADD COLUMN remote_document TEXT;
    ALTER TABLE llms_documents ADD COLUMN remote_match INTEGER;
    CREATE TABLE llms_document_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL REFERENCES llms_documents(id) ON DELETE CASCADE,
      document TEXT NOT NULL, target_path TEXT NOT NULL, language TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    INSERT INTO llms_document_revisions(document_id,document,target_path,language,created_at)
      SELECT id,document,target_path,language,updated_at FROM llms_documents;
    UPDATE llms_documents SET status = 'validated' WHERE status = 'deployed';
  `);
}
