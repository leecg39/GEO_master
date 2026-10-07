import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { applyDatabaseMigrations, DATABASE_MIGRATIONS } from "@/lib/db";

let sqlite: Database.Database | null = null;

afterEach(() => {
  sqlite?.close();
  sqlite = null;
});

describe("migration 11: measurement slot status and brand aliases", () => {
  it("adds columns with legacy defaults and preserves existing rows", () => {
    sqlite = new Database(":memory:");
    sqlite.exec(`
      CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL, brand_name TEXT NOT NULL);
      CREATE TABLE measure_results (id INTEGER PRIMARY KEY, response TEXT NOT NULL);
      INSERT INTO projects (id, name, brand_name) VALUES (1, '기존', '브랜드');
      INSERT INTO measure_results (id, response) VALUES (1, '기존 답변');
    `);
    const migration = DATABASE_MIGRATIONS.filter(({ version }) => version === 11);
    applyDatabaseMigrations(sqlite, migration);
    applyDatabaseMigrations(sqlite, migration);

    expect(sqlite.prepare("SELECT brand_aliases FROM projects WHERE id = 1").get()).toEqual({ brand_aliases: "[]" });
    expect(sqlite.prepare("SELECT response, slot_status, matched_spans, own_domain_hit, metric_version FROM measure_results WHERE id = 1").get())
      .toEqual({ response: "기존 답변", slot_status: "succeeded", matched_spans: "[]", own_domain_hit: 0, metric_version: "legacy" });
  });
});

describe("migration 16: inline citation kind", () => {
  it("rebuilds measure_citations to accept inline URLs and keeps existing rows", () => {
    sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    sqlite.exec(`
      CREATE TABLE measure_runs (id INTEGER PRIMARY KEY);
      CREATE TABLE measure_results (id INTEGER PRIMARY KEY);
      INSERT INTO measure_runs (id) VALUES (1);
      INSERT INTO measure_results (id) VALUES (1);
      CREATE TABLE measure_citations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id INTEGER NOT NULL REFERENCES measure_runs(id) ON DELETE CASCADE,
        result_id INTEGER NOT NULL REFERENCES measure_results(id) ON DELETE CASCADE,
        url TEXT NOT NULL, domain TEXT NOT NULL, title TEXT,
        kind TEXT NOT NULL CHECK(kind IN ('cited','searched')),
        category TEXT NOT NULL CHECK(category IN ('own','competitor','media','community','marketplace','public','other','unknown')),
        created_at TEXT NOT NULL
      );
      INSERT INTO measure_citations (run_id, result_id, url, domain, kind, category, created_at) VALUES (1, 1, 'https://a.kr', 'a.kr', 'cited', 'own', 't');
    `);
    applyDatabaseMigrations(sqlite, DATABASE_MIGRATIONS.filter(({ version }) => version === 16));
    sqlite.prepare("INSERT INTO measure_citations (run_id, result_id, url, domain, kind, category, created_at) VALUES (1, 1, 'https://b.kr', 'b.kr', 'inline', 'other', 't')").run();
    expect(sqlite.prepare("SELECT url, kind FROM measure_citations ORDER BY id").all()).toEqual([{ url: "https://a.kr", kind: "cited" }, { url: "https://b.kr", kind: "inline" }]);
    expect(() => sqlite!.prepare("INSERT INTO measure_citations (run_id, result_id, url, domain, kind, category, created_at) VALUES (1, 1, 'x', 'x', 'bogus', 'other', 't')").run()).toThrow();
    sqlite.prepare("DELETE FROM measure_results WHERE id = 1").run();
    expect((sqlite.prepare("SELECT COUNT(*) AS count FROM measure_citations").get() as { count: number }).count).toBe(0);
  });
});

