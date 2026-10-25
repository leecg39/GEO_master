import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import { BASE_SCHEMA_SQL } from "./base-schema";
import { applyDatabaseMigrations } from "./migrations";

export { applyDatabaseMigrations, DATABASE_MIGRATIONS, LATEST_SCHEMA_VERSION, type DatabaseMigration } from "./migrations";

function resolveDatabasePath() {
  const configured = process.env.GEO_DB_PATH?.trim();
  return configured
    ? path.resolve(configured)
    : path.join(process.cwd(), "data", "geo.db");
}

export function getDatabasePath() {
  return resolveDatabasePath();
}

function bootstrap(sqlite: Database.Database) {
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("journal_mode = WAL");
  sqlite.exec(BASE_SCHEMA_SQL);
  applyDatabaseMigrations(sqlite);
}

function createDatabase(databasePath: string) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const sqlite = new Database(databasePath);
  bootstrap(sqlite);
  return { sqlite, orm: drizzle(sqlite, { schema }) };
}

type DatabaseBundle = ReturnType<typeof createDatabase>;
const globalStore = globalThis as typeof globalThis & {
  __geoDatabases?: Map<string, DatabaseBundle>;
};

export function getDatabase(): DatabaseBundle {
  const databasePath = resolveDatabasePath();
  globalStore.__geoDatabases ??= new Map();
  const cached = globalStore.__geoDatabases.get(databasePath);
  if (cached?.sqlite.open) return cached;
  const created = createDatabase(databasePath);
  globalStore.__geoDatabases.set(databasePath, created);
  return created;
}

export function closeDatabase(databasePath = resolveDatabasePath()) {
  const cached = globalStore.__geoDatabases?.get(databasePath);
  if (cached?.sqlite.open) cached.sqlite.close();
  globalStore.__geoDatabases?.delete(databasePath);
}
