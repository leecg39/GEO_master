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
