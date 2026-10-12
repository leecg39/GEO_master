/**
 * 수정 결과 보고서 (rankseo-gap-reports-plan R04).
 * RankSEO는 수정 전 값을 존재하지 않는 경로에서 읽고, 수정 후 값을 보고서를 여는 순간의 활성 탭에서 읽었으며,
 * 실제 재측정 없이 점수 향상을 더해 보여 줬다. 여기서는:
 * - 원래 값 = 수정안을 만들 때 저장한 값, 공개 페이지 값 = 가장 최근 반영 확인 이력(R03)
 * - 확인한 최종 주소가 수정안 주소와 다르면 표시한다
 * - 점수 변화는 마지막 전달 이후 실제로 다시 진단한 기록이 있을 때만 보여 준다
 * - WordPress 저장값 칸은 연동(R09) 전까지 비어 있다
 */
import { z } from "zod";
import { listChangeVerifications, type ChangeVerification } from "./change-verifications";
import { getDatabase } from "./db";
import { sameDocumentUrl } from "./hreflang";
import { requireActiveProject } from "./projects";

const VALUE_MAX = 500;
const MAX_IDS = 100;

const httpUrl = z.string().trim().max(2048).url().refine((value) => /^https?:\/\//i.test(value), { message: "http 또는 https URL만 허용합니다." });

export const changeReportQuerySchema = z.object({
  url: httpUrl.optional(),
  ids: z.array(z.number().int().positive()).min(1).max(MAX_IDS).optional(),
}).strict().refine((value) => (value.url === undefined) !== (value.ids === undefined), { message: "url 또는 ids 중 하나만 지정하세요." });

interface ItemRow {
  id: number; url: string; field: string; original_value: string; proposed_value: string; status: string;
  delivery_method: string | null; delivered_at: string | null; updated_at: string;
}

const clip = (text: string | null) => text === null ? null : text.length > VALUE_MAX ? `${text.slice(0, VALUE_MAX - 1)}…` : text;

function reportItem(row: ItemRow) {
  const history = listChangeVerifications(row.id);
  const last: ChangeVerification | undefined = history.at(0);
  return {
    id: row.id, url: row.url, field: row.field, status: row.status,
    originalValue: clip(row.original_value), proposedValue: clip(row.proposed_value),
    wordpressValue: null as string | null,
    publicValue: last?.actualExcerpt ?? null,
    lastCheckedAt: last?.checkedAt ?? null,
    lastHttpStatus: last?.httpStatus ?? null,
    lastResult: last?.result ?? null,
    lastFinalUrl: last?.finalUrl ?? null,
    finalUrlMismatch: Boolean(last?.finalUrl && !sameDocumentUrl(last.finalUrl, row.url)),
    deliveryMethod: row.delivery_method, deliveredAt: row.delivered_at, updatedAt: row.updated_at,
    history,
  };
}
export type ChangeReportItem = ReturnType<typeof reportItem>;

type ActionKind = "conflict" | "failed" | "pending" | "unchecked";
const ACTION_MESSAGES: Record<ActionKind, string> = {
  conflict: "원본 값이 바뀌었습니다. 현재 값을 확인하고 수정안을 갱신한 뒤 다시 승인하세요.",
  failed: "공개 페이지가 오류로 응답했습니다. 주소와 서버 상태를 확인한 뒤 다시 확인하세요.",
  pending: "공개 페이지에 아직 반영되지 않았습니다. 캐시·CDN 때문일 수 있으니 시간을 두고 다시 확인하세요.",
  unchecked: "전달 후 반영 확인을 아직 하지 않았습니다. 반영 확인을 실행하세요.",
};
const ACTION_STATUS: Record<string, ActionKind | undefined> = { conflict: "conflict", failed: "failed", verification_pending: "pending", delivered: "unchecked" };

interface AuditPoint { id: number; score: number; createdAt: string }

function auditPoint(projectId: number, url: string, comparison: "<" | ">", at: string): AuditPoint | null {
  const row = getDatabase().sqlite.prepare(`
    SELECT id, score, created_at AS createdAt FROM audits
    WHERE project_id = ? AND (url = ? OR url = ?) AND created_at ${comparison} ?
    ORDER BY created_at DESC, id DESC LIMIT 1
  `).get(projectId, url, url.endsWith("/") ? url.slice(0, -1) : `${url}/`, at) as AuditPoint | undefined;
  return row ?? null;
}

function reaudits(projectId: number, items: readonly ChangeReportItem[]) {
  const urls = [...new Set(items.map((item) => item.url))];
  return urls.map((url) => {
    const delivered = items.filter((item) => item.url === url && item.deliveredAt).map((item) => item.deliveredAt!).sort();
    if (delivered.length === 0) return { url, before: null, after: null };
    return { url, before: auditPoint(projectId, url, "<", delivered[0]!), after: auditPoint(projectId, url, ">", delivered.at(-1)!) };
  });
}

function selectRows(projectId: number, scope: z.infer<typeof changeReportQuerySchema>): ItemRow[] {
  const { sqlite } = getDatabase();
  const columns = "id, url, field, original_value, proposed_value, status, delivery_method, delivered_at, updated_at";
  if (scope.url !== undefined) {
    return sqlite.prepare(`SELECT ${columns} FROM change_items WHERE project_id = ? AND url = ? ORDER BY id`).all(projectId, scope.url) as ItemRow[];
  }
  const ids = [...new Set(scope.ids)];
  return sqlite.prepare(`SELECT ${columns} FROM change_items WHERE project_id = ? AND id IN (${ids.map(() => "?").join(", ")}) ORDER BY id`)
    .all(projectId, ...ids) as ItemRow[];
}

export function buildChangeReport(input: unknown) {
  const scope = changeReportQuerySchema.parse(input);
  const project = requireActiveProject();
  const items = selectRows(project.id, scope).map(reportItem);
  const count = (status: string) => items.filter((item) => item.status === status).length;
  return {
    schemaVersion: 1,
    kind: "changes" as const,
    generatedAt: new Date().toISOString(),
    scope: { url: scope.url ?? null, ids: scope.ids ?? null },
    kpi: {
      total: items.length, draft: count("draft"), approved: count("approved"), delivered: count("delivered"),
      pending: count("verification_pending"), verified: count("verified"), conflict: count("conflict"), failed: count("failed"),
    },
    items,
    actions: items.flatMap((item) => {
      const kind = ACTION_STATUS[item.status];
      return kind ? [{ id: item.id, url: item.url, field: item.field, kind, message: ACTION_MESSAGES[kind] }] : [];
    }),
    reaudits: reaudits(project.id, items),
  };
}
export type ChangeReport = ReturnType<typeof buildChangeReport>;
