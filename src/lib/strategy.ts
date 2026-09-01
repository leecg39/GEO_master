import { z } from "zod";
import {
  assertDeleteAllowed,
  assertExpectedUpdatedAt,
  expectFound,
  resourceIdSchema,
  transactionalMutation,
} from "./crud";
import { getDatabase } from "./db";
import { AppError } from "./errors";
import { requireActiveProject } from "./projects";

export const strategyTypes = ["question", "pillar", "cluster", "supporting", "calendar", "cycle"] as const;
const statuses = ["계획", "진행", "완료"] as const;

const dataSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]));

export const strategyCreateSchema = z.object({
  type: z.enum(strategyTypes),
  title: z.string().trim().min(1).max(500),
  status: z.enum(statuses).optional().default("계획"),
  parentId: resourceIdSchema.nullable().optional(),
  data: dataSchema.optional().default({}),
}).strict();

export const strategyUpdateSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  status: z.enum(statuses).optional(),
  parentId: resourceIdSchema.nullable().optional(),
  data: dataSchema.optional(),
  expectedUpdatedAt: z.string().min(1).max(64).optional(),
}).strict().refine(
  (value) => value.title !== undefined || value.status !== undefined || value.parentId !== undefined || value.data !== undefined,
  { message: "수정할 전략 필드를 하나 이상 입력해 주세요." },
);

export const strategyDeleteSchema = z.object({
  expectedUpdatedAt: z.string().min(1).max(64).optional(),
  cascadeConfirmed: z.boolean().default(false),
}).strict();

interface StrategyRow {
  id: number;
  project_id: number | null;
  parent_id: number | null;
  type: string;
  title: string;
  data: string;
  status: string;
  created_at: string;
  updated_at: string;
}

function deserialize(row: StrategyRow) {
  let data: Record<string, string | number | boolean | null> = {};
  try { data = JSON.parse(row.data) as typeof data; } catch { /* 빈 데이터로 복구 */ }
  return {
    id: row.id,
    projectId: row.project_id!,
    parentId: row.parent_id,
    type: row.type as (typeof strategyTypes)[number],
    title: row.title,
    status: row.status as (typeof statuses)[number],
    data,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function findRow(id: number) {
  return getDatabase().sqlite.prepare("SELECT * FROM strategy_items WHERE id = ?").get(id) as StrategyRow | undefined;
}

function ownedRow(id: number) {
  const row = expectFound(findRow(id), "전략 항목을 찾을 수 없습니다.", "STRATEGY_NOT_FOUND");
  requireActiveProject(row.project_id);
  return row;
}

function nextTimestamp(previous: string) {
  const previousTime = Date.parse(previous);
  return new Date(Number.isFinite(previousTime) && previousTime >= Date.now() ? previousTime + 1 : Date.now()).toISOString();
}

function assertParent(projectId: number, itemId: number | null, type: string, parentId: number | null) {
  if (parentId === null) {
    if (type === "cluster" || type === "supporting") {
      throw new AppError("Cluster와 Supporting은 상위 주제를 선택해야 합니다.", 422, "STRATEGY_PARENT_REQUIRED");
    }
    return;
  }
  if (itemId === parentId) throw new AppError("자기 자신을 상위 주제로 지정할 수 없습니다.", 422, "STRATEGY_PARENT_CYCLE");
  const parent = expectFound(findRow(parentId), "상위 주제를 찾을 수 없습니다.", "STRATEGY_PARENT_NOT_FOUND");
  if (parent.project_id !== projectId) throw new AppError("활성 프로젝트의 상위 주제가 아닙니다.", 409, "PROJECT_SCOPE_MISMATCH");
  if (type === "cluster" && parent.type !== "pillar") {
    throw new AppError("Cluster는 Pillar 아래에만 연결할 수 있습니다.", 422, "STRATEGY_PARENT_TYPE");
  }
  if (type === "supporting" && parent.type !== "pillar" && parent.type !== "cluster") {
    throw new AppError("Supporting은 Pillar 또는 Cluster 아래에만 연결할 수 있습니다.", 422, "STRATEGY_PARENT_TYPE");
  }
  if (type === "pillar" || type === "question" || type === "calendar" || type === "cycle") {
    throw new AppError("이 유형은 상위 주제를 갖지 않습니다.", 422, "STRATEGY_PARENT_NOT_ALLOWED");
  }
}

export function listStrategyItems() {
  const active = requireActiveProject();
  const rows = getDatabase().sqlite.prepare(`
    SELECT * FROM strategy_items WHERE project_id = ? ORDER BY created_at DESC, id DESC
  `).all(active.id) as StrategyRow[];
  return rows.map(deserialize);
}

export function createStrategyItem(input: unknown) {
  const parsed = strategyCreateSchema.parse(input);
  const active = requireActiveProject();
  const parentId = parsed.parentId ?? null;
  assertParent(active.id, null, parsed.type, parentId);
  const { sqlite } = getDatabase();
  return transactionalMutation(sqlite, () => {
    const now = new Date().toISOString();
    const result = sqlite.prepare(`
      INSERT INTO strategy_items (project_id, parent_id, type, title, data, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(active.id, parentId, parsed.type, parsed.title, JSON.stringify(parsed.data), parsed.status, now, now);
    return deserialize(ownedRow(Number(result.lastInsertRowid)));
  });
}

export function updateStrategyItem(idInput: unknown, input?: unknown) {
  let id: number;
  let payload: Record<string, unknown>;
  if (input === undefined && typeof idInput === "object" && idInput !== null && "id" in idInput) {
    const { id: rawId, ...rest } = idInput as { id: unknown; [key: string]: unknown };
    id = resourceIdSchema.parse(rawId);
    payload = rest;
  } else {
    id = resourceIdSchema.parse(idInput);
    payload = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  }
  const parsed = strategyUpdateSchema.parse(payload);
  const { sqlite } = getDatabase();
  return transactionalMutation(sqlite, () => {
    const row = ownedRow(id);
    if (parsed.expectedUpdatedAt !== undefined) {
      assertExpectedUpdatedAt(row.updated_at, parsed.expectedUpdatedAt);
    }
    const parentId = parsed.parentId === undefined ? row.parent_id : parsed.parentId;
    assertParent(row.project_id!, id, row.type, parentId);
    const updatedAt = nextTimestamp(row.updated_at);
    let currentData: Record<string, string | number | boolean | null> = {};
    try { currentData = JSON.parse(row.data) as typeof currentData; } catch { /* 빈 데이터로 복구 */ }
    sqlite.prepare(`
      UPDATE strategy_items SET title = ?, status = ?, parent_id = ?, data = ?, updated_at = ? WHERE id = ?
    `).run(
      parsed.title ?? row.title,
      parsed.status ?? row.status,
      parentId,
      JSON.stringify(parsed.data ?? currentData),
      updatedAt,
      id,
    );
    return deserialize(ownedRow(id));
  });
}

export function deleteStrategyItem(idInput: unknown, input?: unknown) {
  let id: number;
  let payload: Record<string, unknown>;
  if (input === undefined && typeof idInput === "object" && idInput !== null && "id" in idInput) {
    const { id: rawId, ...rest } = idInput as { id: unknown; [key: string]: unknown };
    id = resourceIdSchema.parse(rawId);
    payload = rest;
  } else {
    id = resourceIdSchema.parse(idInput);
    payload = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  }
  const parsed = strategyDeleteSchema.parse(payload);
  const { sqlite } = getDatabase();
  return transactionalMutation(sqlite, () => {
    const row = ownedRow(id);
    if (parsed.expectedUpdatedAt !== undefined) {
      assertExpectedUpdatedAt(row.updated_at, parsed.expectedUpdatedAt);
    }
    const childrenCount = (sqlite.prepare("SELECT COUNT(*) AS count FROM strategy_items WHERE parent_id = ?").get(id) as { count: number }).count;
    assertDeleteAllowed({ strategyChildren: childrenCount }, parsed.cascadeConfirmed, "STRATEGY_ITEM_HAS_CHILDREN");
    if (childrenCount > 0) sqlite.prepare("UPDATE strategy_items SET parent_id = NULL WHERE parent_id = ?").run(id);
    sqlite.prepare("DELETE FROM strategy_items WHERE id = ?").run(id);
  });
}

export const STRATEGY_GUIDE = {
  sources: ["고객 상담", "챗봇 로그", "SNS·커뮤니티", "서치콘솔", "AI 직접 질문"],
  intents: ["정보 탐색형", "비교·평가형", "구매 결정형", "문제 해결형"],
  journeyStages: ["탐색", "비교", "구매 결정"],
  calendar: ["기반 구축", "세그먼트 확장", "문제 해결 강화", "지원 자료", "업데이트", "공백 보완"],
  cycle: ["모니터링", "분석", "우선순위", "콘텐츠 개선"],
};
