import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDatabase } from "./db";
import { strategyItems } from "./db/schema";
import { AppError } from "./errors";

export const strategyTypes = ["question", "pillar", "cluster", "supporting", "calendar", "cycle"] as const;

const strategySchema = z.object({
  type: z.enum(strategyTypes),
  title: z.string().trim().min(1).max(500),
  status: z.enum(["계획", "진행", "완료"]).optional().default("계획"),
  data: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional().default({}),
});

const updateSchema = z.object({
  id: z.number().int().positive(),
  title: z.string().trim().min(1).max(500).optional(),
  status: z.enum(["계획", "진행", "완료"]).optional(),
  data: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
});

function deserialize(row: typeof strategyItems.$inferSelect) {
  let data: Record<string, string | number | boolean | null> = {};
  try { data = JSON.parse(row.data) as typeof data; } catch { /* 빈 데이터로 복구 */ }
  return { ...row, data };
}

export function listStrategyItems() {
  return getDatabase().orm.select().from(strategyItems).orderBy(desc(strategyItems.createdAt)).all().map(deserialize);
}

export function createStrategyItem(input: unknown) {
  const parsed = strategySchema.parse(input);
  const now = new Date().toISOString();
  const row = getDatabase().orm.insert(strategyItems).values({
    type: parsed.type,
    title: parsed.title,
    status: parsed.status,
    data: JSON.stringify(parsed.data),
    createdAt: now,
    updatedAt: now,
  }).returning().get();
  return deserialize(row);
}

export function updateStrategyItem(input: unknown) {
  const parsed = updateSchema.parse(input);
  const current = getDatabase().orm.select().from(strategyItems).where(eq(strategyItems.id, parsed.id)).get();
  if (!current) throw new AppError("전략 항목을 찾을 수 없습니다.", 404, "STRATEGY_NOT_FOUND");
  const row = getDatabase().orm.update(strategyItems).set({
    ...(parsed.title !== undefined ? { title: parsed.title } : {}),
    ...(parsed.status !== undefined ? { status: parsed.status } : {}),
    ...(parsed.data !== undefined ? { data: JSON.stringify(parsed.data) } : {}),
    updatedAt: new Date().toISOString(),
  }).where(eq(strategyItems.id, parsed.id)).returning().get();
  return deserialize(row);
}

export function deleteStrategyItem(id: number) {
  const result = getDatabase().orm.delete(strategyItems).where(eq(strategyItems.id, id)).run();
  if (!result.changes) throw new AppError("전략 항목을 찾을 수 없습니다.", 404, "STRATEGY_NOT_FOUND");
}

export const STRATEGY_GUIDE = {
  sources: ["고객 상담", "챗봇 로그", "SNS·커뮤니티", "서치콘솔", "AI 직접 질문"],
  intents: ["정보 탐색형", "비교·평가형", "구매 결정형", "문제 해결형"],
  journeyStages: ["탐색", "비교", "구매 결정"],
  calendar: ["기반 구축", "세그먼트 확장", "문제 해결 강화", "지원 자료", "업데이트", "공백 보완"],
  cycle: ["모니터링", "분석", "우선순위", "콘텐츠 개선"],
};
