/**
 * 사실 메모 — 공식 자료로 확인한 브랜드 사실(가격·규격·인증 등).
 * 답변 속 주장 대조와 콘텐츠 초안의 유일한 수치 근거로 쓴다.
 * 상태: verified(확인 + 미만료) / unverified(미확인) / expired(유효기간 경과)
 */
import { z } from "zod";
import { assertExpectedUpdatedAt, expectFound, resourceIdSchema, transactionalMutation } from "./crud";
import { getDatabase } from "./db";
import { normalizeAttribute, type DraftFact, type FactForCompare } from "./geo-core";
import { requireActiveProject } from "./projects";

export type FactStatus = "verified" | "unverified" | "expired";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "날짜는 YYYY-MM-DD 형식이어야 합니다.");
const httpUrlSchema = z.string().trim().max(2048).url().refine((value) => /^https?:\/\//i.test(value), {
  message: "출처 URL은 http 또는 https여야 합니다.",
});

const factFields = {
  attribute: z.string().trim().min(1).max(60),
  value: z.string().trim().min(1).max(200),
  unit: z.string().trim().max(20).nullable(),
  conditions: z.string().trim().max(500),
  sourceUrl: httpUrlSchema.nullable(),
  excerpt: z.string().trim().max(2_000),
  checkedAt: dateSchema.nullable(),
  validUntil: dateSchema.nullable(),
  verified: z.boolean(),
};

export const factCreateSchema = z.object({
  attribute: factFields.attribute,
  value: factFields.value,
  unit: factFields.unit.optional().default(null),
  conditions: factFields.conditions.optional().default(""),
  sourceUrl: factFields.sourceUrl.optional().default(null),
  excerpt: factFields.excerpt.optional().default(""),
  checkedAt: factFields.checkedAt.optional().default(null),
  validUntil: factFields.validUntil.optional().default(null),
  verified: factFields.verified.optional().default(false),
}).strict();

export const factUpdateSchema = z.object({
  ...Object.fromEntries(Object.entries(factFields).map(([key, schema]) => [key, schema.optional()])) as {
    [K in keyof typeof factFields]: z.ZodOptional<(typeof factFields)[K]>;
  },
  expectedUpdatedAt: z.string().min(1).max(64),
}).strict();

export const factDeleteSchema = z.object({ expectedUpdatedAt: z.string().min(1).max(64) }).strict();

interface FactRow {
  id: number;
  project_id: number;
  attribute: string;
  attribute_normalized: string;
  value: string;
  unit: string | null;
  conditions: string;
  source_url: string | null;
  excerpt: string;
  checked_at: string | null;
  valid_until: string | null;
  verified: number;
  created_at: string;
  updated_at: string;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function factStatus(row: Pick<FactRow, "verified" | "valid_until">, date = today()): FactStatus {
  if (row.valid_until && row.valid_until < date) return "expired";
  return row.verified ? "verified" : "unverified";
}

function toFact(row: FactRow) {
  return {
    id: row.id,
    projectId: row.project_id,
    attribute: row.attribute,
    value: row.value,
    unit: row.unit,
    conditions: row.conditions,
    sourceUrl: row.source_url,
    excerpt: row.excerpt,
    checkedAt: row.checked_at,
    validUntil: row.valid_until,
    verified: Boolean(row.verified),
    status: factStatus(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type FactResource = ReturnType<typeof toFact>;

function projectRows(projectId: number) {
  return getDatabase().sqlite.prepare("SELECT * FROM facts WHERE project_id = ? ORDER BY created_at DESC, id DESC").all(projectId) as FactRow[];
}

function ownedRow(id: number) {
  const row = expectFound(
    getDatabase().sqlite.prepare("SELECT * FROM facts WHERE id = ?").get(id) as FactRow | undefined,
    "사실 메모를 찾을 수 없습니다.",
    "FACT_NOT_FOUND",
  );
  requireActiveProject(row.project_id);
  return row;
}

function nextTimestamp(previous: string) {
  const previousTime = Date.parse(previous);
  return new Date(Number.isFinite(previousTime) && previousTime >= Date.now() ? previousTime + 1 : Date.now()).toISOString();
}

export function listFacts(): FactResource[] {
  return projectRows(requireActiveProject().id).map(toFact);
}

export function createFact(input: unknown): FactResource {
  const parsed = factCreateSchema.parse(input);
  const active = requireActiveProject();
  const { sqlite } = getDatabase();
  return transactionalMutation(sqlite, () => {
    const now = new Date().toISOString();
    const result = sqlite.prepare(`
      INSERT INTO facts (project_id, attribute, attribute_normalized, value, unit, conditions, source_url, excerpt, checked_at, valid_until, verified, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      active.id, parsed.attribute, normalizeAttribute(parsed.attribute), parsed.value, parsed.unit || null, parsed.conditions,
      parsed.sourceUrl, parsed.excerpt, parsed.checkedAt, parsed.validUntil, parsed.verified ? 1 : 0, now, now,
    );
    return toFact(ownedRow(Number(result.lastInsertRowid)));
  });
}

export function updateFact(idInput: unknown, input: unknown): FactResource {
  const id = resourceIdSchema.parse(idInput);
  const parsed = factUpdateSchema.parse(input);
  const { sqlite } = getDatabase();
  return transactionalMutation(sqlite, () => {
    const row = ownedRow(id);
    assertExpectedUpdatedAt(row.updated_at, parsed.expectedUpdatedAt);
    const attribute = parsed.attribute ?? row.attribute;
    sqlite.prepare(`
      UPDATE facts SET attribute = ?, attribute_normalized = ?, value = ?, unit = ?, conditions = ?, source_url = ?,
        excerpt = ?, checked_at = ?, valid_until = ?, verified = ?, updated_at = ? WHERE id = ?
    `).run(
      attribute, normalizeAttribute(attribute), parsed.value ?? row.value,
      parsed.unit === undefined ? row.unit : parsed.unit || null,
      parsed.conditions ?? row.conditions,
      parsed.sourceUrl === undefined ? row.source_url : parsed.sourceUrl,
      parsed.excerpt ?? row.excerpt,
      parsed.checkedAt === undefined ? row.checked_at : parsed.checkedAt,
      parsed.validUntil === undefined ? row.valid_until : parsed.validUntil,
      parsed.verified === undefined ? row.verified : parsed.verified ? 1 : 0,
      nextTimestamp(row.updated_at), id,
    );
    return toFact(ownedRow(id));
  });
}

export function deleteFact(idInput: unknown, input: unknown) {
  const id = resourceIdSchema.parse(idInput);
  const parsed = factDeleteSchema.parse(input);
  const { sqlite } = getDatabase();
  transactionalMutation(sqlite, () => {
    const row = ownedRow(id);
    assertExpectedUpdatedAt(row.updated_at, parsed.expectedUpdatedAt);
    sqlite.prepare("DELETE FROM facts WHERE id = ?").run(id);
  });
}

/** 초안 근거 검사용 — verified + 미만료만 usable */
export function draftFactsForActiveProject(): DraftFact[] {
  return listFacts().map((fact) => ({
    id: String(fact.id),
    attribute: fact.attribute,
    value: fact.value,
    unit: fact.unit,
    usable: fact.status === "verified",
  }));
}

/** 주장 대조용 — 미확인 사실은 대조 후보로만 쓰고 만료 사실은 시점 불명 판정에 쓴다 */
export function factsForCompare(projectId = requireActiveProject().id): FactForCompare[] {
  return projectRows(projectId).map((row) => ({
    id: String(row.id),
    entityId: null,
    attributeNormalized: row.attribute_normalized,
    value: row.value,
    unit: row.unit,
    status: factStatus(row),
  }));
}
