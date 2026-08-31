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
  `);
  sqlite.close();
  process.env.GEO_DB_PATH = databasePath;
});

afterAll(() => {
  closeDatabase(databasePath);
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (previousDb === undefined) delete process.env.GEO_DB_PATH; else process.env.GEO_DB_PATH = previousDb;
});

describe("settings schema migration", () => {
  it("adds the HyperCLOVA column and preserves legacy settings", () => {
    const sqlite = getDatabase().sqlite;
    const columns = sqlite.pragma("table_info(settings)") as { name: string }[];
    expect(columns.map((column) => column.name)).toContain("hyperclova_api_key");
    expect((sqlite.prepare("SELECT brand_name FROM settings WHERE id=1").get() as { brand_name: string }).brand_name).toBe("기존 브랜드");
  });
});
