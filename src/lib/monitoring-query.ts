import { z } from "zod";
import { AppError } from "./errors";

const DAY = 86_400_000;
const dateOnly = z.string().regex(/^(?!0000)\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}, "올바른 날짜를 입력해 주세요.");
export const monitoringQuerySchema = z.object({
  start: dateOnly.optional(), end: dateOnly.optional(),
  question: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  projectId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  comparison: z.enum(["all", "same"]).default("all"),
  format: z.enum(["json", "csv"]).default("json"),
}).strict();
export function monitoringRange(start?: string, end?: string, now = new Date()) {
  const last = end ?? new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
  const first = start ?? new Date(Math.max(Date.parse("0001-01-01"), Date.parse(last) - 83 * DAY)).toISOString().slice(0, 10);
  const days = (Date.parse(last) - Date.parse(first)) / DAY + 1;
  if (!Number.isFinite(days) || days < 1 || days > 366) throw new AppError("조회 기간은 시작일부터 최대 366일까지 지정해 주세요.", 422, "INVALID_MONITORING_RANGE");
  return { start: first, end: last, timezone: "Asia/Seoul" as const };
}
