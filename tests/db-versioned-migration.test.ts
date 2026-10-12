import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { applyDatabaseMigrations, DATABASE_MIGRATIONS, LATEST_SCHEMA_VERSION, type DatabaseMigration } from "@/lib/db";

const databases: Database.Database[] = [];

function database() {
  const sqlite = new Database(":memory:");
  databases.push(sqlite);
  sqlite.pragma("foreign_keys = ON");
  return sqlite;
}

function qshopBase(sqlite: Database.Database) {
  sqlite.exec(`
    CREATE TABLE projects (id INTEGER PRIMARY KEY);
    CREATE TABLE site_audit_campaigns (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id));
    CREATE TABLE site_audit_pages (id INTEGER PRIMARY KEY, campaign_id INTEGER NOT NULL REFERENCES site_audit_campaigns(id));
    CREATE TABLE llms_documents (id INTEGER PRIMARY KEY, project_id INTEGER REFERENCES projects(id), document TEXT NOT NULL, created_at TEXT NOT NULL);
    INSERT INTO projects VALUES (1);
    INSERT INTO site_audit_campaigns VALUES (1, 1);
    INSERT INTO site_audit_pages VALUES (1, 1);
    INSERT INTO llms_documents VALUES (1, 1, '# 기존 문서', '2026-01-01');
  `);
}

afterEach(() => {
  for (const sqlite of databases.splice(0)) if (sqlite.open) sqlite.close();
});

describe("versioned database migrations", () => {
  it("upgrades databases with historical v20/v21 semantics without losing rows", () => {
    const sqlite = database();
    qshopBase(sqlite);
    applyDatabaseMigrations(sqlite, []); // creates the migration ledger
    sqlite.exec(`
      INSERT INTO schema_migrations VALUES (20, 'page-change-items', '2026-01-02');
      INSERT INTO schema_migrations VALUES (21, 'llms-document-revisions', '2026-01-03');
      CREATE TABLE change_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        url TEXT NOT NULL, field TEXT NOT NULL, original_value TEXT NOT NULL, original_hash TEXT NOT NULL,
        proposed_value TEXT NOT NULL, rationale TEXT NOT NULL DEFAULT '', evidence_url TEXT,
        status TEXT NOT NULL DEFAULT 'draft', approved_at TEXT, delivery_method TEXT, delivered_at TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      INSERT INTO change_items (id, project_id, url, field, original_value, original_hash, proposed_value, created_at, updated_at)
      VALUES (41, 1, 'https://example.com', 'title', '이전 제목', 'hash', '제안된 제목', '2026-01-02', '2026-01-02');
      CREATE TABLE llms_document_revisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER NOT NULL REFERENCES llms_documents(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL, document TEXT NOT NULL, content_hash TEXT NOT NULL,
        origin TEXT NOT NULL CHECK(origin IN ('created','edited','remote','restored')), created_at TEXT NOT NULL,
        UNIQUE(document_id, revision)
      );
      INSERT INTO llms_document_revisions VALUES (1, 1, 1, '# 기존 문서', 'legacy-hash', 'created', '2026-01-01');
    `);

    applyDatabaseMigrations(sqlite, DATABASE_MIGRATIONS.filter(({ version }) => version > 19));

    expect(sqlite.prepare("SELECT proposed_value FROM change_items WHERE id = 41").get()).toEqual({ proposed_value: "제안된 제목" });
    expect(sqlite.prepare("SELECT id, revision, content_hash FROM llms_document_revisions WHERE document_id = 1").all()).toEqual([
      { id: 1, revision: 1, content_hash: "legacy-hash" },
    ]);
    expect(sqlite.prepare("SELECT scope_path FROM llms_documents WHERE id = 1").get()).toEqual({ scope_path: "/llms.txt" });
    expect(sqlite.prepare("SELECT robots_policy FROM site_audit_campaigns WHERE id = 1").get()).toEqual({ robots_policy: null });
    expect((sqlite.pragma("table_info(page_snapshots)") as { name: string }[]).map(({ name }) => name)).toContain("body_kind");
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    expect(sqlite.pragma("integrity_check")).toEqual([{ integrity_check: "ok" }]);
    expect(sqlite.prepare("SELECT version, name FROM schema_migrations WHERE version IN (20,21) ORDER BY version").all()).toEqual([
      { version: 20, name: "page-change-items" }, { version: 21, name: "llms-document-revisions" },
    ]);
  });

  it("applies the new-schema path and backfills the initial document revision", () => {
    const sqlite = database();
    qshopBase(sqlite);
    applyDatabaseMigrations(sqlite, []);

    applyDatabaseMigrations(sqlite, DATABASE_MIGRATIONS.filter(({ version }) => version > 19));

    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('change_items','llms_document_revisions','page_snapshots') ORDER BY name").all()).toEqual([
      { name: "change_items" }, { name: "llms_document_revisions" }, { name: "page_snapshots" },
    ]);
    expect(sqlite.prepare("SELECT revision, document, origin FROM llms_document_revisions WHERE document_id = 1").all()).toEqual([
      { revision: 1, document: "# 기존 문서", origin: "created" },
    ]);
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    expect(sqlite.pragma("integrity_check")).toEqual([{ integrity_check: "ok" }]);
  });

  it("preserves legacy subscriptions without granting them to every hosted account", () => {
    const sqlite = database();
    sqlite.exec(`
      CREATE TABLE semforge_subscriptions (id INTEGER PRIMARY KEY, status TEXT NOT NULL);
      CREATE TABLE semforge_payment_intents (id INTEGER PRIMARY KEY, provider_order_id TEXT);
      INSERT INTO semforge_subscriptions VALUES (1, 'active');
      INSERT INTO semforge_payment_intents VALUES (1, 'legacy-order');
    `);
    const migration = DATABASE_MIGRATIONS.filter(({ version }) => version === 10);
    applyDatabaseMigrations(sqlite, migration);
    applyDatabaseMigrations(sqlite, migration);
    expect(sqlite.prepare("SELECT * FROM semforge_subscriptions").get()).toMatchObject({
      id: 1, status: "active", account_id: "local", billing_mode: "legacy", payment_intent_id: null,
    });
    expect(sqlite.prepare("SELECT * FROM semforge_payment_intents").get()).toMatchObject({ account_id: "local", billing_mode: "legacy" });
    expect(() => sqlite.prepare("INSERT INTO semforge_subscriptions (id, status, account_id) VALUES (2, 'active', 'local')").run()).toThrow(/UNIQUE/);
  });

  it("records ordered migrations once and safely re-runs", () => {
    const sqlite = database();
    sqlite.exec(`
      CREATE TABLE settings (id INTEGER PRIMARY KEY);
      CREATE TABLE measurement_schedules (id INTEGER PRIMARY KEY);
      CREATE TABLE measurement_jobs (id INTEGER PRIMARY KEY);
      INSERT INTO settings (id) VALUES (1);
    `);

    const migrations = DATABASE_MIGRATIONS.slice(0, 2);
    applyDatabaseMigrations(sqlite, migrations);
    applyDatabaseMigrations(sqlite, migrations);

    const rows = sqlite.prepare("SELECT version, name, applied_at FROM schema_migrations ORDER BY version").all() as {
      version: number; name: string; applied_at: string;
    }[];
    expect(rows.map(({ version, name }) => ({ version, name }))).toEqual(
      migrations.map(({ version, name }) => ({ version, name })),
    );
    expect(rows.every((row) => Number.isFinite(Date.parse(row.applied_at)))).toBe(true);
    expect(LATEST_SCHEMA_VERSION).toBe(28);
    expect((sqlite.pragma("table_info(settings)") as { name: string }[]).map((column) => column.name))
      .toEqual(expect.arrayContaining(["grok_api_key", "subscription_pin"]));
    expect((sqlite.prepare("SELECT COUNT(*) AS count FROM settings").get() as { count: number }).count).toBe(1);
  });

  it("rolls back a failed migration without recording it", () => {
    const sqlite = database();
    const failing: DatabaseMigration = {
      version: 99,
      name: "intentional-rollback",
      up(databaseHandle) {
        databaseHandle.exec("CREATE TABLE should_rollback (id INTEGER PRIMARY KEY); INSERT INTO should_rollback (id) VALUES (1)");
        throw new Error("migration failed");
      },
    };

    expect(() => applyDatabaseMigrations(sqlite, [failing])).toThrow(/migration failed/);
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='should_rollback'").get()).toBeUndefined();
    expect((sqlite.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get() as { count: number }).count).toBe(0);
  });

  it("rejects duplicate versions before applying either migration", () => {
    const sqlite = database();
    const duplicate = [
      { version: 3, name: "first", up() {} },
      { version: 3, name: "second", up() {} },
    ] satisfies DatabaseMigration[];

    expect(() => applyDatabaseMigrations(sqlite, duplicate)).toThrow(/Duplicate or invalid/);
    expect((sqlite.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get() as { count: number }).count).toBe(0);
  });
});
