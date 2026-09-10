import fs from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";

const source = path.resolve(process.env.GEO_DB_PATH || "data/geo.db");
await fs.access(source);
const folder = path.join(path.dirname(source), "backups");
await fs.mkdir(folder, { recursive: true, mode: 0o700 });
const destination = path.join(
  folder,
  `geo-${new Date().toISOString().replaceAll(":", "-")}-${process.pid}.db`,
);
const database = new Database(source, { readonly: true, fileMustExist: true });
try {
  await database.backup(destination);
  await fs.chmod(destination, 0o600);
  const backup = new Database(destination, { readonly: true });
  try {
    if (backup.pragma("integrity_check", { simple: true }) !== "ok")
      throw new Error("Backup integrity check failed");
  } finally {
    backup.close();
  }
  console.log(`전체 SQLite 백업 (원본 유지): ${destination}`);
} finally {
  database.close();
}
