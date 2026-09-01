import { createHash } from "node:crypto";
import { z } from "zod";
import {
  assertExpectedUpdatedAt,
  collectionQuerySchema,
  cursorPage,
  decodeCursor,
  expectFound,
  resourceIdSchema,
  transactionalMutation,
} from "./crud";
import { getDatabase } from "./db";
import { AppError } from "./errors";
import { requireActiveProject } from "./projects";
import {
  MAX_WORKSPACE_BYTES,
  buildWorkspaceSnapshot,
  importWorkspace,
  serializeWorkspaceSnapshot,
  workspaceSnapshotSchema,
} from "./workspace";

export const MAX_WORKSPACE_BACKUPS = 20;

export const backupCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
}).strict();

export const backupUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  expectedUpdatedAt: z.string().min(1).max(64),
}).strict();

export const backupDeleteSchema = z.object({
  expectedUpdatedAt: z.string().min(1).max(64),
}).strict();

export const backupRestoreSchema = z.object({
  mode: z.enum(["merge", "replace"]),
  confirmReplace: z.boolean().optional().default(false),
  expectedUpdatedAt: z.string().min(1).max(64),
}).strict();

interface BackupRow {
  id: number;
  project_id: number | null;
  name: string;
  schema_version: number;
  snapshot: string;
  checksum: string;
  bytes: number;
  created_at: string;
  updated_at: string;
}

function publicBackup(row: BackupRow, includeSnapshot = false) {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    schemaVersion: row.schema_version,
    checksum: row.checksum,
    bytes: row.bytes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(includeSnapshot ? { snapshot: JSON.parse(row.snapshot) as unknown } : {}),
  };
}

function ownedRow(id: number) {
  return expectFound(
    getDatabase().sqlite.prepare("SELECT * FROM workspace_backups WHERE id = ?").get(id) as BackupRow | undefined,
    "워크스페이스 백업을 찾을 수 없습니다.",
    "WORKSPACE_BACKUP_NOT_FOUND",
  );
}

function nextTimestamp(previous: string) {
  const previousTime = Date.parse(previous);
  return new Date(Number.isFinite(previousTime) && previousTime >= Date.now() ? previousTime + 1 : Date.now()).toISOString();
}

function escapedLike(value: string) {
  return `%${value.replace(/[\\%_]/g, "\\$&")}%`;
}

export function listWorkspaceBackups(input: unknown) {
  requireActiveProject();
  const query = collectionQuerySchema.parse(input);
  const where = ["1 = 1"];
  const parameters: Array<string | number> = [];
  if (query.q) {
    where.push("name LIKE ? ESCAPE '\\'");
    parameters.push(escapedLike(query.q));
  }
  if (query.cursor) {
    const cursor = decodeCursor(query.cursor);
    where.push("(created_at < ? OR (created_at = ? AND id < ?))");
    parameters.push(cursor.timestamp, cursor.timestamp, cursor.id);
  }
  const rows = getDatabase().sqlite.prepare(`
    SELECT id, project_id, name, schema_version, checksum, bytes, created_at, updated_at
    FROM workspace_backups WHERE ${where.join(" AND ")}
    ORDER BY created_at DESC, id DESC LIMIT ?
  `).all(...parameters, query.limit + 1) as Omit<BackupRow, "snapshot">[];
  return cursorPage(rows.map((row) => publicBackup({ ...row, snapshot: "{}" })), query.limit, (item) => ({
    timestamp: item.createdAt, id: item.id,
  }));
}

export function getWorkspaceBackup(idInput: unknown, includeSnapshot = false) {
  requireActiveProject();
  return publicBackup(ownedRow(resourceIdSchema.parse(idInput)), includeSnapshot);
}

export function createWorkspaceBackup(input: unknown) {
  const parsed = backupCreateSchema.parse(input);
  const active = requireActiveProject();
  const snapshot = buildWorkspaceSnapshot();
  const text = serializeWorkspaceSnapshot(snapshot);
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > MAX_WORKSPACE_BYTES) throw new AppError("백업이 25MB 제한을 초과했습니다.", 413, "SNAPSHOT_TOO_LARGE");
  const { sqlite } = getDatabase();
  return transactionalMutation(sqlite, () => {
    const count = (sqlite.prepare("SELECT COUNT(*) AS count FROM workspace_backups").get() as { count: number }).count;
    if (count >= MAX_WORKSPACE_BACKUPS) {
      throw new AppError(`로컬 백업은 최대 ${MAX_WORKSPACE_BACKUPS}개까지 보관할 수 있습니다.`, 409, "BACKUP_LIMIT");
    }
    const now = new Date().toISOString();
    const checksum = createHash("sha256").update(text).digest("hex");
    const result = sqlite.prepare(`
      INSERT INTO workspace_backups (project_id, name, schema_version, snapshot, checksum, bytes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(active.id, parsed.name, snapshot.schemaVersion, text, checksum, bytes, now, now);
    return publicBackup(ownedRow(Number(result.lastInsertRowid)));
  });
}

export function updateWorkspaceBackup(idInput: unknown, input: unknown) {
  const id = resourceIdSchema.parse(idInput);
  const parsed = backupUpdateSchema.parse(input);
  requireActiveProject();
  const { sqlite } = getDatabase();
  return transactionalMutation(sqlite, () => {
    const row = ownedRow(id);
    assertExpectedUpdatedAt(row.updated_at, parsed.expectedUpdatedAt);
    sqlite.prepare("UPDATE workspace_backups SET name = ?, updated_at = ? WHERE id = ?")
      .run(parsed.name, nextTimestamp(row.updated_at), id);
    return publicBackup(ownedRow(id));
  });
}

export function deleteWorkspaceBackup(idInput: unknown, input: unknown) {
  const id = resourceIdSchema.parse(idInput);
  const parsed = backupDeleteSchema.parse(input);
  requireActiveProject();
  const { sqlite } = getDatabase();
  return transactionalMutation(sqlite, () => {
    const row = ownedRow(id);
    assertExpectedUpdatedAt(row.updated_at, parsed.expectedUpdatedAt);
    sqlite.prepare("DELETE FROM workspace_backups WHERE id = ?").run(id);
  });
}

export function restoreWorkspaceBackup(idInput: unknown, input: unknown) {
  const id = resourceIdSchema.parse(idInput);
  const parsed = backupRestoreSchema.parse(input);
  requireActiveProject();
  const row = ownedRow(id);
  assertExpectedUpdatedAt(row.updated_at, parsed.expectedUpdatedAt);
  const snapshot = workspaceSnapshotSchema.parse(JSON.parse(row.snapshot));
  return importWorkspace({
    mode: parsed.mode,
    confirmReplace: parsed.confirmReplace,
    snapshot,
  });
}
