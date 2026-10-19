import type Database from "better-sqlite3";

export interface DatabaseMigration {
  version: number;
  name: string;
  up: (sqlite: Database.Database) => void;
}

function tableColumns(sqlite: Database.Database, table: string) {
  return new Set((sqlite.pragma(`table_info(${table})`) as { name: string }[]).map((column) => column.name));
}

export function addColumnIfMissing(sqlite: Database.Database, table: string, column: string, definition: string) {
  if (!tableColumns(sqlite, table).has(column)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
