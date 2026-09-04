import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDatabase, getDatabase } from "@/lib/db";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-migration-test-"));
const databasePath = path.join(tempDir, "legacy.db");
const previousDb = process.env.GEO_DB_PATH;

beforeAll(() => {
  const sqlite = new Database(databasePath);
  sqlite.exec(`
    CREATE TABLE settings (
      id INTEGER PRIMARY KEY,
      brand_name TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      competitors TEXT NOT NULL DEFAULT '[]',
      openai_api_key TEXT,
      anthropic_api_key TEXT,
      gemini_api_key TEXT,
      models TEXT NOT NULL DEFAULT '{}',
      repetitions INTEGER NOT NULL DEFAULT 3,
      model_weights TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO settings (id, brand_name, models, model_weights, created_at, updated_at)
    VALUES (1, '기존 브랜드', '{"openai":"legacy-model"}', '{"openai":1}', '2026-01-01', '2026-01-01');
    CREATE TABLE audits (
      id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL, score INTEGER NOT NULL,
      grade TEXT NOT NULL, items TEXT NOT NULL, metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
    );
    INSERT INTO audits (url, score, grade, items, metadata, created_at)
    VALUES ('https://example.com', 20, '보통', '[]', '{}', '2026-01-02');
    CREATE TABLE contents (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tool TEXT NOT NULL, input TEXT NOT NULL,
      output TEXT NOT NULL, created_at TEXT NOT NULL
    );
    INSERT INTO contents (tool, input, output, created_at)
    VALUES ('rewrite', '{}', '{"after":"보존"}', '2026-01-03');
  `);
  sqlite.close();
  process.env.GEO_DB_PATH = databasePath;
});

afterAll(() => {
  closeDatabase(databasePath);
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (previousDb === undefined) delete process.env.GEO_DB_PATH; else process.env.GEO_DB_PATH = previousDb;
});

describe("settings and CRUD schema migration", () => {
  it("applies v1-v4, scopes legacy data, backfills revisions, and preserves existing rows", () => {
    const sqlite = getDatabase().sqlite;
    const settingsColumns = (sqlite.pragma("table_info(settings)") as { name: string }[]).map((column) => column.name);
    expect(settingsColumns).toEqual(expect.arrayContaining(["grok_api_key", "subscription_pin", "active_project_id", "talordata_api_token", "firecrawl_api_key"]));
    expect((sqlite.prepare("SELECT brand_name FROM settings WHERE id=1").get() as { brand_name: string }).brand_name).toBe("기존 브랜드");

    const project = sqlite.prepare("SELECT id, brand_name FROM projects LIMIT 1").get() as { id: number; brand_name: string };
    expect(project.brand_name).toBe("기존 브랜드");
    expect((sqlite.prepare("SELECT active_project_id FROM settings WHERE id=1").get() as { active_project_id: number }).active_project_id).toBe(project.id);
    expect((sqlite.prepare("SELECT project_id, updated_at FROM audits WHERE id=1").get() as { project_id: number; updated_at: string }))
      .toEqual({ project_id: project.id, updated_at: "2026-01-02" });
    expect((sqlite.prepare("SELECT project_id, output, updated_at FROM contents WHERE id=1").get() as { project_id: number; output: string; updated_at: string }))
      .toEqual({ project_id: project.id, output: '{"after":"보존"}', updated_at: "2026-01-03" });

    const revision = sqlite.prepare("SELECT content_id, revision, input, output, origin, created_at FROM content_revisions WHERE content_id=1").get();
    expect(revision).toEqual({
      content_id: 1, revision: 1, input: "{}", output: '{"after":"보존"}', origin: "generated", created_at: "2026-01-03",
    });

    const migrationVersions = (sqlite.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as { version: number }[])
      .map((row) => row.version);
    expect(migrationVersions).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const tables = (sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((row) => row.name);
    expect(tables).toEqual(expect.arrayContaining([
      "content_revisions", "llms_documents", "report_presets", "workspace_backups",
      "semforge_subscriptions", "ai_visibility_queries", "site_audit_campaigns",
    ]));
    expect((sqlite.pragma("table_info(projects)") as { name: string }[]).map((column) => column.name))
      .toEqual(expect.arrayContaining(["competitor_notes", "external_research_notes"]));
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
  });
});
