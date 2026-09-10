import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { migrateSiteOps } from "@/lib/db/site-ops-migration";

it("preserves pre-v13 estimates while allowing genuinely unmeasured HTTP values", () => {
  const db = new Database(":memory:");
  try {
    db.pragma("foreign_keys=ON");
    db.exec(`CREATE TABLE projects(id INTEGER PRIMARY KEY);
      INSERT INTO projects VALUES(1);
      CREATE TABLE site_audit_campaigns(id INTEGER PRIMARY KEY,project_id INTEGER,site_health INTEGER);
      INSERT INTO site_audit_campaigns VALUES(2,1,82);
      CREATE TABLE site_audit_issues(id INTEGER PRIMARY KEY);
      CREATE TABLE site_audit_pages(id INTEGER PRIMARY KEY,campaign_id INTEGER,url TEXT,status_code INTEGER NOT NULL,title TEXT,depth INTEGER NOT NULL,response_ms INTEGER,bytes INTEGER NOT NULL,captured_at TEXT NOT NULL);
      INSERT INTO site_audit_pages VALUES(7,2,'https://example.com/',200,NULL,1,NULL,0,'2026-09-01');
      CREATE TABLE llms_documents(id INTEGER PRIMARY KEY,document TEXT,status TEXT,updated_at TEXT);
      INSERT INTO llms_documents VALUES(4,'# Example','deployed','2026-09-01');`);
    db.transaction(() => migrateSiteOps(db))();
    expect(
      db
        .prepare(
          "SELECT id,status_code,depth,bytes,data_state FROM site_audit_pages",
        )
        .get(),
    ).toEqual({
      id: 7,
      status_code: 200,
      depth: 1,
      bytes: 0,
      data_state: "legacy_estimate",
    });
    expect(
      db
        .prepare("SELECT site_health,data_state FROM site_audit_campaigns")
        .get(),
    ).toEqual({ site_health: 82, data_state: "legacy_estimate" });
    db.prepare(
      "INSERT INTO site_audit_pages(campaign_id,url,data_state) VALUES(2,'https://example.com/new','live')",
    ).run();
    expect(
      db
        .prepare(
          "SELECT status_code,captured_at,depth,bytes FROM site_audit_pages WHERE id=8",
        )
        .get(),
    ).toEqual({
      status_code: null,
      captured_at: null,
      depth: null,
      bytes: null,
    });
    expect(
      db
        .prepare("SELECT document,status,target_path FROM llms_documents")
        .get(),
    ).toEqual({
      document: "# Example",
      status: "validated",
      target_path: "/llms.txt",
    });
    expect(db.pragma("foreign_key_check")).toEqual([]);
  } finally {
    db.close();
  }
});
