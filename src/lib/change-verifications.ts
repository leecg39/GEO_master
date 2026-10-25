/**
 * 반영 확인 이력 (rankseo-gap-reports-plan R03).
 * RankSEO는 수정 후 값을 '보고서를 여는 순간의 활성 탭'에서 읽고 기록을 남기지 않았다.
 * 여기서는 확인할 때마다 요청 주소·최종 주소·HTTP 상태·실제 값(500자)·소요 시간을 남긴다.
 */
import { resourceIdSchema } from "./crud";
import { getDatabase } from "./db";
import { AppError } from "./errors";
import { requireActiveProject } from "./projects";

export const MAX_VERIFICATIONS_PER_ITEM = 20;
const EXCERPT_MAX = 500;

export type VerificationSource = "public" | "wordpress";
export type VerificationResult = "matched" | "pending" | "http_error" | "fetch_error";

export interface VerificationRecord {
  source: VerificationSource;
  result: VerificationResult;
  httpStatus: number | null;
  matched: boolean | null;
  actual: string | null;
  checkedUrl: string;
  finalUrl: string | null;
  durationMs: number;
  errorCode: string | null;
  checkedAt: string;
}

interface Row {
  id: number; change_item_id: number; source: VerificationSource; result: VerificationResult; http_status: number | null; matched: number | null;
  actual_excerpt: string | null; checked_url: string; final_url: string | null; duration_ms: number; error_code: string | null; checked_at: string;
}

function toVerification(row: Row) {
  return {
    id: row.id, changeItemId: row.change_item_id, source: row.source, result: row.result, httpStatus: row.http_status,
    matched: row.matched === null ? null : row.matched === 1, actualExcerpt: row.actual_excerpt, checkedUrl: row.checked_url,
    finalUrl: row.final_url, durationMs: row.duration_ms, errorCode: row.error_code, checkedAt: row.checked_at,
  };
}
export type ChangeVerification = ReturnType<typeof toVerification>;

/** 이력 1행을 남기고 항목당 최근 기록만 유지한다. 호출자가 소유권을 이미 확인했다고 본다. */
export function recordVerification(changeItemId: number, record: VerificationRecord) {
  const { sqlite } = getDatabase();
  // 확인하는 동안 수정안이 삭제됐으면 기록하지 않는다. 호출자의 다음 소유권 확인이 CHANGE_NOT_FOUND를 낸다
  sqlite.prepare(`
    INSERT INTO change_verifications (change_item_id, source, result, http_status, matched, actual_excerpt, checked_url, final_url, duration_ms, error_code, checked_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM change_items WHERE id = ?)
  `).run(
    changeItemId, record.source, record.result, record.httpStatus, record.matched === null ? null : Number(record.matched),
    record.actual === null ? null : record.actual.slice(0, EXCERPT_MAX), record.checkedUrl, record.finalUrl,
    Math.max(0, Math.round(record.durationMs)), record.errorCode, record.checkedAt, changeItemId,
  );
  sqlite.prepare(`
    DELETE FROM change_verifications WHERE change_item_id = ? AND id NOT IN (
      SELECT id FROM change_verifications WHERE change_item_id = ? ORDER BY id DESC LIMIT ?
    )
  `).run(changeItemId, changeItemId, MAX_VERIFICATIONS_PER_ITEM);
}

/** 활성 프로젝트의 수정안 이력, 최신순 */
export function listChangeVerifications(idInput: unknown): ChangeVerification[] {
  const id = resourceIdSchema.parse(idInput);
  const { sqlite } = getDatabase();
  const owner = sqlite.prepare("SELECT project_id FROM change_items WHERE id = ?").get(id) as { project_id: number } | undefined;
  if (!owner || owner.project_id !== requireActiveProject().id) throw new AppError("수정안을 찾을 수 없습니다.", 404, "CHANGE_NOT_FOUND");
  const rows = sqlite.prepare("SELECT * FROM change_verifications WHERE change_item_id = ? ORDER BY id DESC").all(id) as Row[];
  return rows.map(toVerification);
}
