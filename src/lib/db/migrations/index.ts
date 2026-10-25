import type Database from "better-sqlite3";
import type { DatabaseMigration } from "./utils";
export type { DatabaseMigration } from "./utils";
import { coreMigrations } from "./core";
import { semforgeMigrations } from "./semforge";
import { measurementMigrations } from "./measurement";
import { workbenchMigrations } from "./workbench";
import { reportMigrations } from "./reports";
import { haloMigrations } from "./halo";

export const DATABASE_MIGRATIONS: readonly DatabaseMigration[] = [
  ...coreMigrations,
  ...semforgeMigrations,
  ...measurementMigrations,
  ...workbenchMigrations,
  ...reportMigrations,
  ...haloMigrations,
];

export const LATEST_SCHEMA_VERSION = DATABASE_MIGRATIONS.at(-1)?.version ?? 0;

export function applyDatabaseMigrations(
  sqlite: Database.Database,
  migrations: readonly DatabaseMigration[] = DATABASE_MIGRATIONS,
) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    )
  `);

  const ordered = [...migrations].sort((left, right) => left.version - right.version);
  const versions = new Set<number>();
  const names = new Set<string>();
  for (const migration of ordered) {
    if (!Number.isSafeInteger(migration.version) || migration.version <= 0) {
      throw new Error(`Invalid database migration version: ${migration.version}`);
    }
    if (!migration.name.trim() || versions.has(migration.version) || names.has(migration.name)) {
      throw new Error(`Duplicate or invalid database migration: ${migration.version}/${migration.name}`);
    }
    versions.add(migration.version);
    names.add(migration.name);
  }

  const applied = new Set((sqlite.prepare("SELECT version FROM schema_migrations").all() as { version: number }[]).map((row) => row.version));
  for (const migration of ordered) {
    if (applied.has(migration.version)) continue;
    sqlite.transaction(() => {
      migration.up(sqlite);
      const violations = sqlite.pragma("foreign_key_check") as unknown[];
      if (violations.length) throw new Error(`Foreign key check failed after migration ${migration.version}`);
      sqlite.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)")
        .run(migration.version, migration.name, new Date().toISOString());
    })();
  }
}
