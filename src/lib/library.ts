import { z } from "zod";
import { assertExpectedUpdatedAt, expectFound, resourceIdSchema } from "./crud";
import { getDatabase } from "./db";
import { requireActiveProject } from "./projects";
import { requireHalo } from "./halo-feature";

export const sourceUrlSchema = z.string().trim().max(2048).refine(value => {
  if (!value) return true;
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
}, "출처는 인증 정보 없는 http/https URL이어야 합니다.");
export const knowledgeSchema = z.object({
  name: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(20_000),
  sourceUrl: sourceUrlSchema.default(""),
  notes: z.string().trim().max(2000).default(""),
}).strict();
export const writingProfileSchema = z.object({
  name: z.string().trim().min(1).max(120),
  audience: z.string().trim().max(1000).default(""),
  tone: z.string().trim().max(1000).default(""),
  forbiddenTerms: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  samples: z.string().trim().max(5000).default(""),
}).strict();
export const expectedSchema = z.object({ expectedUpdatedAt: z.string().min(1).max(64) }).strict();
export function nextHaloTime(previous = "") { return new Date(Math.max(Date.now(), (Date.parse(previous) || 0) + 1)).toISOString(); }
export interface LibraryItem<T> { id: number; projectId: number; data: T; createdAt: string; updatedAt: string }
export type KnowledgeDocument = LibraryItem<z.infer<typeof knowledgeSchema>>;
export type WritingProfile = LibraryItem<z.infer<typeof writingProfileSchema>>;
interface Stored { id: number; project_id: number; data: string; created_at: string; updated_at: string }

function libraryStore<T>(table: "knowledge_documents" | "writing_profiles", schema: z.ZodType<T>) {
  function resource(row: Stored): LibraryItem<T> {
    return { id: row.id, projectId: row.project_id, data: schema.parse(JSON.parse(row.data)), createdAt: row.created_at, updatedAt: row.updated_at };
  }
  function row(id: unknown) {
    requireHalo();
    const project = requireActiveProject();
    return expectFound(getDatabase().sqlite.prepare(`SELECT * FROM ${table} WHERE id = ? AND project_id = ?`).get(resourceIdSchema.parse(id), project.id) as Stored | undefined, "현재 프로젝트에서 자료를 찾을 수 없습니다.", "LIBRARY_NOT_FOUND");
  }
  return {
    list() {
      requireHalo();
      return (getDatabase().sqlite.prepare(`SELECT * FROM ${table} WHERE project_id = ? ORDER BY updated_at DESC, id DESC`).all(requireActiveProject().id) as Stored[]).map(resource);
    },
    get(id: unknown) { return resource(row(id)); },
    create(input: unknown) {
      requireHalo();
      const data = schema.parse(input), project = requireActiveProject(), now = nextHaloTime();
      const result = getDatabase().sqlite.prepare(`INSERT INTO ${table} (project_id, data, created_at, updated_at) VALUES (?, ?, ?, ?)`).run(project.id, JSON.stringify(data), now, now);
      return resource(row(Number(result.lastInsertRowid)));
    },
    update(id: unknown, input: unknown) {
      const parsed = z.object({ data: schema, expectedUpdatedAt: z.string().min(1).max(64) }).strict().parse(input);
      return getDatabase().sqlite.transaction(() => {
        const current = row(id); assertExpectedUpdatedAt(current.updated_at, parsed.expectedUpdatedAt);
        getDatabase().sqlite.prepare(`UPDATE ${table} SET data = ?, updated_at = ? WHERE id = ?`).run(JSON.stringify(parsed.data), nextHaloTime(current.updated_at), current.id);
        return resource(row(current.id));
      })();
    },
    delete(id: unknown, input: unknown) {
      const parsed = expectedSchema.parse(input);
      return getDatabase().sqlite.transaction(() => {
        const current = row(id); assertExpectedUpdatedAt(current.updated_at, parsed.expectedUpdatedAt);
        getDatabase().sqlite.prepare(`DELETE FROM ${table} WHERE id = ?`).run(current.id);
        return { deleted: true };
      })();
    },
  };
}
export const knowledgeDocuments = libraryStore("knowledge_documents", knowledgeSchema);
export const writingProfiles = libraryStore("writing_profiles", writingProfileSchema);
