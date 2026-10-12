/**
 * 전달 이력 (rankseo-gap-reports-plan R08). RankSEO는 도구 실행 상세를 버리고 소요 시간을 0으로 남겼다.
 * 여기서는 수동 전달과 WordPress 쓰기 모두 결과·HTTP 상태·오류 코드·쓰기 전 값·소요 시간을 남긴다.
 */
import { resourceIdSchema } from "./crud";
import { getDatabase } from "./db";
import { AppError } from "./errors";
import { requireActiveProject } from "./projects";

const VALUE_MAX = 2_000;

export interface DeliveryTarget { site: string; postId: number; postType: "post" | "page"; metaKey: string }

export interface DeliveryRecord {
  method: "manual" | "wordpress";
  target: DeliveryTarget | null;
  result: "ok" | "conflict" | "error";
  httpStatus: number | null;
  errorCode: string | null;
  previousValue: string | null;
  remoteModifiedAt: string | null;
  startedAt: string;
  durationMs: number;
}

interface Row {
  id: number; change_item_id: number; method: "manual" | "wordpress"; target_json: string | null; result: DeliveryRecord["result"];
  http_status: number | null; error_code: string | null; previous_value: string | null; remote_modified_at: string | null;
  started_at: string; finished_at: string; duration_ms: number;
}

function parseTarget(json: string | null): DeliveryTarget | null {
  if (!json) return null;
  try { return JSON.parse(json) as DeliveryTarget; } catch { return null; }
}

const toDelivery = (row: Row) => ({
  id: row.id, changeItemId: row.change_item_id, method: row.method, target: parseTarget(row.target_json), result: row.result,
  httpStatus: row.http_status, errorCode: row.error_code, previousValue: row.previous_value, remoteModifiedAt: row.remote_modified_at,
  startedAt: row.started_at, finishedAt: row.finished_at, durationMs: row.duration_ms,
});
export type ChangeDelivery = ReturnType<typeof toDelivery>;

/** 호출자가 소유권을 확인했다고 본다. 수정안이 사라졌으면 기록하지 않는다 */
export function recordDelivery(changeItemId: number, record: DeliveryRecord) {
  getDatabase().sqlite.prepare(`
    INSERT INTO change_deliveries (change_item_id, method, target_json, result, http_status, error_code, previous_value, remote_modified_at, started_at, finished_at, duration_ms)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM change_items WHERE id = ?)
  `).run(
    changeItemId, record.method, record.target ? JSON.stringify(record.target) : null, record.result, record.httpStatus, record.errorCode,
    record.previousValue === null ? null : record.previousValue.slice(0, VALUE_MAX), record.remoteModifiedAt, record.startedAt,
    new Date().toISOString(), Math.max(0, Math.round(record.durationMs)), changeItemId,
  );
}

export function listChangeDeliveries(idInput: unknown): ChangeDelivery[] {
  const id = resourceIdSchema.parse(idInput);
  const { sqlite } = getDatabase();
  const owner = sqlite.prepare("SELECT project_id FROM change_items WHERE id = ?").get(id) as { project_id: number } | undefined;
  if (!owner || owner.project_id !== requireActiveProject().id) throw new AppError("수정안을 찾을 수 없습니다.", 404, "CHANGE_NOT_FOUND");
  return (sqlite.prepare("SELECT * FROM change_deliveries WHERE change_item_id = ? ORDER BY id DESC").all(id) as Row[]).map(toDelivery);
}
