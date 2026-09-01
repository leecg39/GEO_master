import type Database from "better-sqlite3";
import { z } from "zod";
import { AppError } from "./errors";

export const resourceIdSchema = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const idempotencyKeySchema = z.string().uuid();
export const expectedUpdatedAtSchema = z.string().min(1).max(64);

export const collectionQuerySchema = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(200).optional(),
}).strict();

const cursorSchema = z.object({
  timestamp: z.string().min(1).max(64),
  id: resourceIdSchema,
}).strict();

export interface ResourceCursor {
  timestamp: string;
  id: number;
}

export interface CursorPage<T> {
  items: T[];
  page: { nextCursor: string | null; hasMore: boolean };
}

export function encodeCursor(cursor: ResourceCursor) {
  return Buffer.from(JSON.stringify(cursorSchema.parse(cursor)), "utf8").toString("base64url");
}

export function decodeCursor(value: string): ResourceCursor {
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
  } catch {
    throw new AppError("페이지 커서가 올바르지 않습니다.", 422, "INVALID_CURSOR");
  }
}

export function cursorPage<T>(
  rows: readonly T[],
  limit: number,
  cursorFor: (row: T) => ResourceCursor,
): CursorPage<T> {
  const safeLimit = z.number().int().min(1).max(100).parse(limit);
  const hasMore = rows.length > safeLimit;
  const items = rows.slice(0, safeLimit);
  return {
    items,
    page: {
      hasMore,
      nextCursor: hasMore && items.length ? encodeCursor(cursorFor(items.at(-1)!)) : null,
    },
  };
}

export function expectFound<T>(value: T | null | undefined, message: string, code: string): T {
  if (value === null || value === undefined) throw new AppError(message, 404, code);
  return value;
}

export function assertExpectedUpdatedAt(actual: string, expected: string) {
  if (actual !== expected) {
    throw new AppError(
      "다른 화면에서 먼저 수정되었습니다. 최신 데이터를 불러온 뒤 다시 시도해 주세요.",
      409,
      "STALE_WRITE",
      { actualUpdatedAt: actual },
    );
  }
}

export function assertDeleteAllowed(
  dependencies: Record<string, number>,
  cascadeConfirmed: boolean,
  code = "RESOURCE_HAS_DEPENDENCIES",
) {
  const normalized = Object.fromEntries(
    Object.entries(dependencies).map(([key, value]) => [key, Math.max(0, Math.trunc(value))]),
  );
  const total = Object.values(normalized).reduce((sum, value) => sum + value, 0);
  if (total > 0 && !cascadeConfirmed) {
    throw new AppError(
      "연결된 데이터가 있어 삭제 확인이 필요합니다.",
      409,
      code,
      { dependencies: normalized, total },
    );
  }
}

export function transactionalMutation<T>(sqlite: Database.Database, mutation: () => T): T {
  return sqlite.transaction(() => {
    const result = mutation();
    const violations = sqlite.pragma("foreign_key_check") as unknown[];
    if (violations.length) throw new AppError("데이터 관계 무결성을 확인하지 못했습니다.", 409, "FOREIGN_KEY_CONFLICT");
    return result;
  })();
}
