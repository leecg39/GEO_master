/**
 * 페이지 수정안 작업대 (Qshop P05) — 현재 값 / 수정안 / 근거 / 적용 상태.
 * - 원본 값의 해시를 저장해 두고, 이후 실제 페이지 값이 달라지면 conflict로 표시한다
 * - 승인된 항목을 고치면 승인이 풀려 draft로 돌아간다
 * - 자동 게시는 하지 않는다. 전달 방식은 manual만 기록하고 반영 확인은 별도 단계(P09)다
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { assertExpectedUpdatedAt, expectFound, resourceIdSchema, transactionalMutation } from "./crud";
import { getDatabase } from "./db";
import { AppError } from "./errors";
import { extractPageField, fieldMatches } from "./page-fields";
import { requireActiveProject } from "./projects";
import { fetchPublicText } from "./url-security";

export const CHANGE_FIELDS = ["title", "description", "canonical", "og_image", "robots_meta", "json_ld", "body"] as const;
export const CHANGE_STATUSES = ["draft", "approved", "delivered", "verification_pending", "verified", "conflict", "failed"] as const;
type ChangeStatus = (typeof CHANGE_STATUSES)[number];

const httpUrl = z.string().trim().max(2048).url().refine((value) => /^https?:\/\//i.test(value), { message: "http 또는 https URL만 허용합니다." });
const value = z.string().max(20_000);
const timestamp = z.string().min(1).max(64);

export const changeCreateSchema = z.object({
  url: httpUrl,
  field: z.enum(CHANGE_FIELDS),
  originalValue: value,
  proposedValue: value.min(1),
  rationale: z.string().trim().max(2_000).optional().default(""),
  evidenceUrl: httpUrl.nullable().optional().default(null),
}).strict();

export const changeUpdateSchema = z.object({
  proposedValue: value.min(1).optional(),
  rationale: z.string().trim().max(2_000).optional(),
  evidenceUrl: httpUrl.nullable().optional(),
  expectedUpdatedAt: timestamp,
}).strict().refine((input) => input.proposedValue !== undefined || input.rationale !== undefined || input.evidenceUrl !== undefined, { message: "수정할 필드를 입력해 주세요." });

export const changeGuardSchema = z.object({ expectedUpdatedAt: timestamp }).strict();
export const deliverSchema = z.object({ method: z.enum(["manual"]) }).strict();

interface Row {
  id: number; project_id: number; url: string; field: string; original_value: string; original_hash: string; proposed_value: string;
  rationale: string; evidence_url: string | null; status: ChangeStatus; approved_at: string | null; delivery_method: string | null;
  delivered_at: string | null; created_at: string; updated_at: string;
}

const hash = (text: string) => createHash("sha256").update(text.trim()).digest("hex");

function toItem(row: Row) {
  return {
    id: row.id, url: row.url, field: row.field, originalValue: row.original_value, proposedValue: row.proposed_value,
    rationale: row.rationale, evidenceUrl: row.evidence_url, status: row.status, approvedAt: row.approved_at,
    deliveryMethod: row.delivery_method, deliveredAt: row.delivered_at, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
export type ChangeItem = ReturnType<typeof toItem>;

function nextTimestamp(previous: string) {
  const time = Date.parse(previous);
  return new Date(Number.isFinite(time) && time >= Date.now() ? time + 1 : Date.now()).toISOString();
}

function owned(id: number) {
  const row = expectFound(getDatabase().sqlite.prepare("SELECT * FROM change_items WHERE id = ?").get(id) as Row | undefined, "수정안을 찾을 수 없습니다.", "CHANGE_NOT_FOUND");
  requireActiveProject(row.project_id);
  return row;
}

function save(id: number, sets: Record<string, unknown>, previous: string) {
  const entries = Object.entries({ ...sets, updated_at: nextTimestamp(previous) });
  getDatabase().sqlite.prepare(`UPDATE change_items SET ${entries.map(([key]) => `${key} = ?`).join(", ")} WHERE id = ?`).run(...entries.map(([, v]) => v), id);
  return toItem(owned(id));
}

export function listChangeItems(): ChangeItem[] {
  const rows = getDatabase().sqlite.prepare("SELECT * FROM change_items WHERE project_id = ? ORDER BY updated_at DESC, id DESC").all(requireActiveProject().id) as Row[];
  return rows.map(toItem);
}

export function createChangeItem(input: unknown): ChangeItem {
  const parsed = changeCreateSchema.parse(input);
  const active = requireActiveProject();
  const now = new Date().toISOString();
  const result = getDatabase().sqlite.prepare(`
    INSERT INTO change_items (project_id, url, field, original_value, original_hash, proposed_value, rationale, evidence_url, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(active.id, parsed.url, parsed.field, parsed.originalValue, hash(parsed.originalValue), parsed.proposedValue, parsed.rationale, parsed.evidenceUrl, now, now);
  return toItem(owned(Number(result.lastInsertRowid)));
}

export function updateChangeItem(idInput: unknown, input: unknown): ChangeItem {
  const id = resourceIdSchema.parse(idInput);
  const parsed = changeUpdateSchema.parse(input);
  return transactionalMutation(getDatabase().sqlite, () => {
    const row = owned(id);
    assertExpectedUpdatedAt(row.updated_at, parsed.expectedUpdatedAt);
    if (["delivered", "verification_pending", "verified"].includes(row.status)) throw new AppError("이미 전달된 수정안은 고칠 수 없습니다. 새 수정안을 만드세요.", 409, "CHANGE_LOCKED");
    // 승인 이후 내용이 바뀌면 승인은 무효 — 다시 승인받아야 한다
    return save(id, {
      proposed_value: parsed.proposedValue ?? row.proposed_value,
      rationale: parsed.rationale ?? row.rationale,
      evidence_url: parsed.evidenceUrl === undefined ? row.evidence_url : parsed.evidenceUrl,
      status: row.status === "approved" ? "draft" : row.status,
      approved_at: null,
    }, row.updated_at);
  });
}

export function approveChangeItem(idInput: unknown, input: unknown): ChangeItem {
  const id = resourceIdSchema.parse(idInput);
  const { expectedUpdatedAt } = changeGuardSchema.parse(input);
  return transactionalMutation(getDatabase().sqlite, () => {
    const row = owned(id);
    assertExpectedUpdatedAt(row.updated_at, expectedUpdatedAt);
    if (row.status === "conflict") throw new AppError("원본이 바뀌어 충돌 상태입니다. 현재 값을 확인하고 수정안을 갱신한 뒤 다시 승인하세요.", 409, "CHANGE_CONFLICT");
    if (row.status !== "draft") throw new AppError("초안만 승인할 수 있습니다.", 409, "CHANGE_NOT_DRAFT");
    return save(id, { status: "approved", approved_at: new Date().toISOString() }, row.updated_at);
  });
}

export function markDelivered(idInput: unknown, input: unknown): ChangeItem {
  const id = resourceIdSchema.parse(idInput);
  const { method } = deliverSchema.parse(input);
  return transactionalMutation(getDatabase().sqlite, () => {
    const row = owned(id);
    if (row.status !== "approved") throw new AppError("승인된 수정안만 전달 처리할 수 있습니다.", 409, "CHANGE_NOT_APPROVED");
    return save(id, { status: "delivered", delivery_method: method, delivered_at: new Date().toISOString() }, row.updated_at);
  });
}

/** 실제 페이지의 현재 값을 보고받아 원본과 비교한다. 달라졌으면 아직 적용 전인 항목을 conflict로 표시한다 */
export function reportCurrentValue(idInput: unknown, currentValue: string): ChangeItem {
  const id = resourceIdSchema.parse(idInput);
  return transactionalMutation(getDatabase().sqlite, () => {
    const row = owned(id);
    if (!["draft", "approved"].includes(row.status) || hash(currentValue) === row.original_hash) return toItem(row);
    return save(id, { status: "conflict", approved_at: null }, row.updated_at);
  });
}

export function deleteChangeItem(idInput: unknown, input: unknown) {
  const id = resourceIdSchema.parse(idInput);
  const { expectedUpdatedAt } = changeGuardSchema.parse(input);
  transactionalMutation(getDatabase().sqlite, () => {
    const row = owned(id);
    assertExpectedUpdatedAt(row.updated_at, expectedUpdatedAt);
    getDatabase().sqlite.prepare("DELETE FROM change_items WHERE id = ?").run(id);
  });
}

const VERIFY_TIMEOUT_MS = 10_000;

/**
 * 반영 확인 (Qshop P09) — 전달 처리된 수정안의 공개 URL을 다시 읽어 대상 필드가 수정안과 같을 때만 verified로 바꾼다.
 * - HTTP 200만으로는 확인하지 않는다. 값이 아직 다르면 verification_pending으로 남는다
 * - 4xx/5xx 응답은 failed. 네트워크 오류는 상태를 바꾸지 않고 오류를 돌려준다(일시적일 수 있음)
 */
export async function verifyChangeItem(idInput: unknown) {
  const id = resourceIdSchema.parse(idInput);
  const row = owned(id);
  if (!["delivered", "verification_pending", "failed"].includes(row.status)) {
    throw new AppError("전달 처리된 수정안만 반영 확인할 수 있습니다.", 409, "CHANGE_NOT_DELIVERED");
  }
  let page;
  try {
    page = await fetchPublicText(row.url, VERIFY_TIMEOUT_MS);
  } catch {
    throw new AppError("공개 페이지를 가져오지 못했습니다. 잠시 후 다시 확인하세요.", 502, "VERIFY_FETCH_FAILED");
  }
  const checkedAt = new Date().toISOString();
  if (page.status < 200 || page.status >= 400) {
    const item = save(id, { status: "failed" }, owned(id).updated_at);
    return { item, check: { matched: false, httpStatus: page.status, actual: null, checkedAt } };
  }
  const actual = extractPageField(page.text, row.field);
  const matched = fieldMatches(row.field, actual, row.proposed_value);
  const shown = actual === null ? null : actual.slice(0, 500);
  const item = save(id, { status: matched ? "verified" : "verification_pending" }, owned(id).updated_at);
  return { item, check: { matched, httpStatus: page.status, actual: shown, checkedAt } };
}
