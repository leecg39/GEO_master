/**
 * llms 문서 버전 이력 (Qshop P07).
 * 문서 본문이 실제로 바뀔 때만 리비전을 남긴다. 원격 확인이 로컬 문서를 덮어써도 이전 내용이 남는다.
 */
import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { z } from "zod";
import { assertExpectedUpdatedAt, expectFound, resourceIdSchema, transactionalMutation } from "./crud";
import { getDatabase } from "./db";
import { AppError } from "./errors";
import { validateLlmsTxt } from "./llms-txt";
import { requireActiveProject } from "./projects";

export type RevisionOrigin = "created" | "edited" | "remote" | "restored";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

/** 가장 최근 리비전과 내용이 같으면 기록하지 않는다 */
export function recordLlmsRevision(sqlite: Database.Database, documentId: number, document: string, origin: RevisionOrigin) {
  const latest = sqlite.prepare("SELECT revision, content_hash FROM llms_document_revisions WHERE document_id = ? ORDER BY revision DESC LIMIT 1")
    .get(documentId) as { revision: number; content_hash: string } | undefined;
  const contentHash = hash(document);
  if (latest?.content_hash === contentHash) return null;
  const revision = (latest?.revision ?? 0) + 1;
  sqlite.prepare("INSERT INTO llms_document_revisions (document_id, revision, document, content_hash, origin, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(documentId, revision, document, contentHash, origin, new Date().toISOString());
  return revision;
}

function ownedDocument(id: number) {
  const row = expectFound(
    getDatabase().sqlite.prepare("SELECT id, project_id, updated_at FROM llms_documents WHERE id = ?").get(id) as { id: number; project_id: number | null; updated_at: string } | undefined,
    "llms 문서를 찾을 수 없습니다.", "LLMS_DOCUMENT_NOT_FOUND",
  );
  requireActiveProject(row.project_id);
  return row;
}

interface RevisionRow { revision: number; document: string; content_hash: string; origin: RevisionOrigin; created_at: string }

export function listLlmsRevisions(idInput: unknown) {
  const id = resourceIdSchema.parse(idInput);
  ownedDocument(id);
  const rows = getDatabase().sqlite.prepare("SELECT revision, document, content_hash, origin, created_at FROM llms_document_revisions WHERE document_id = ? ORDER BY revision DESC").all(id) as RevisionRow[];
  return rows.map((row) => ({ revision: row.revision, origin: row.origin, createdAt: row.created_at, contentHash: row.content_hash, bytes: Buffer.byteLength(row.document) }));
}

function revisionText(documentId: number, revision: number) {
  const row = getDatabase().sqlite.prepare("SELECT document FROM llms_document_revisions WHERE document_id = ? AND revision = ?").get(documentId, revision) as { document: string } | undefined;
  if (!row) throw new AppError("해당 리비전을 찾을 수 없습니다.", 404, "LLMS_REVISION_NOT_FOUND");
  return row.document;
}

export interface DiffLine { type: "same" | "added" | "removed"; text: string }

/** 줄 단위 LCS diff */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before === "" ? [] : before.split("\n");
  const b = after === "" ? [] : after.split("\n");
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push({ type: "same", text: a[i]! }); i += 1; j += 1; }
    else if (table[i + 1]![j]! >= table[i]![j + 1]!) { out.push({ type: "removed", text: a[i]! }); i += 1; }
    else { out.push({ type: "added", text: b[j]! }); j += 1; }
  }
  for (; i < a.length; i += 1) out.push({ type: "removed", text: a[i]! });
  for (; j < b.length; j += 1) out.push({ type: "added", text: b[j]! });
  return out;
}

export function getLlmsRevisionDiff(idInput: unknown, fromRevision: number, toRevision: number) {
  const id = resourceIdSchema.parse(idInput);
  ownedDocument(id);
  return diffLines(revisionText(id, fromRevision), revisionText(id, toRevision));
}

export const restoreSchema = z.object({ expectedUpdatedAt: z.string().min(1).max(64) }).strict();

/** 예전 리비전의 내용을 현재 문서로 되돌린다. 되돌림도 새 리비전(restored)으로 남아 이력은 지워지지 않는다 */
export function restoreLlmsRevision(idInput: unknown, revision: number, input: unknown) {
  const id = resourceIdSchema.parse(idInput);
  const { expectedUpdatedAt } = restoreSchema.parse(input);
  const { sqlite } = getDatabase();
  return transactionalMutation(sqlite, () => {
    const row = ownedDocument(id);
    assertExpectedUpdatedAt(row.updated_at, expectedUpdatedAt);
    const document = revisionText(id, revision);
    const site = sqlite.prepare("SELECT website, scope_path FROM llms_documents WHERE id = ?").get(id) as { website: string; scope_path: string };
    const validation = validateLlmsTxt(document, site.website, { path: site.scope_path });
    const previousTime = Date.parse(row.updated_at);
    const updatedAt = new Date(Number.isFinite(previousTime) && previousTime >= Date.now() ? previousTime + 1 : Date.now()).toISOString();
    sqlite.prepare("UPDATE llms_documents SET document = ?, validation = ?, status = ?, remote_url = NULL, remote_content_type = NULL, remote_checked_at = NULL, updated_at = ? WHERE id = ?")
      .run(document, JSON.stringify(validation), validation.valid ? "validated" : "draft", updatedAt, id);
    recordLlmsRevision(sqlite, id, document, "restored");
    return { id, document, updatedAt };
  });
}
