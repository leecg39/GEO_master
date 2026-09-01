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

afterEach(() => {
  for (const sqlite of databases.splice(0)) if (sqlite.open) sqlite.close();
});

describe("versioned database migrations", () => {
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
    expect(LATEST_SCHEMA_VERSION).toBe(5);
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
