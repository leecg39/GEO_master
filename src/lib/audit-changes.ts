/**
 * 진단 결과 → 수정안 연결.
 * 진단이 실제로 읽은 페이지 필드(metadata.pageFields)만 근거로 쓴다. 제안 문구는 만들지 않고 사용자가 입력한다.
 * 길이 기준은 검색엔진의 공식 규격이 아니라 일반적인 권고이며, 그렇게 표시한다.
 */
import { z } from "zod";
import { createChangeItem, type ChangeItem } from "./change-items";
import { resourceIdSchema } from "./crud";
import { getDatabase } from "./db";
import { AppError } from "./errors";
import { requireActiveProject } from "./projects";

const TRACKED = ["title", "description", "canonical", "og_image", "robots_meta"] as const;
type Tracked = (typeof TRACKED)[number];
type PageFields = Partial<Record<Tracked, string | null>>;

export const auditChangeSchema = z.object({
  field: z.enum(TRACKED),
  proposedValue: z.string().min(1).max(20_000),
  rationale: z.string().trim().max(2_000).optional().default(""),
}).strict();

function loadAudit(idInput: unknown) {
  const id = resourceIdSchema.parse(idInput);
  const row = getDatabase().sqlite.prepare("SELECT id, project_id, url, metadata FROM audits WHERE id = ?").get(id) as
    { id: number; project_id: number | null; url: string; metadata: string } | undefined;
  if (!row) throw new AppError("진단을 찾을 수 없습니다.", 404, "AUDIT_NOT_FOUND");
  requireActiveProject(row.project_id);
  let metadata: { finalUrl?: string; pageFields?: PageFields } = {};
  try { metadata = JSON.parse(row.metadata); } catch { /* 빈 메타데이터로 처리 */ }
  if (!metadata.pageFields) {
    throw new AppError("이 진단은 페이지 필드를 기록하지 않았습니다. 다시 진단하면 현재 값을 읽어 옵니다.", 409, "AUDIT_FIELDS_MISSING");
  }
  return { url: metadata.finalUrl ?? row.url, fields: metadata.pageFields };
}

const RULES: Array<{ field: Tracked; code: string; test: (value: string) => boolean; guidance: string }> = [
  { field: "title", code: "TITLE_MISSING", test: (v) => v.length === 0, guidance: "제목이 없습니다. 권고: 페이지 핵심 답변과 브랜드를 담은 제목을 쓰세요." },
  { field: "title", code: "TITLE_SHORT", test: (v) => v.length > 0 && [...v].length < 10, guidance: "권고: 제목이 너무 짧습니다. 브랜드·카테고리·핵심 가치를 함께 담는 것이 일반적입니다." },
  { field: "title", code: "TITLE_LONG", test: (v) => [...v].length > 70, guidance: "권고: 제목이 길어 검색 결과에서 잘릴 수 있습니다(공식 한도는 아니며 일반적인 기준)." },
  { field: "description", code: "DESCRIPTION_MISSING", test: (v) => v.length === 0, guidance: "설명(meta description)이 없습니다. 권고: 페이지 요약을 1~2문장으로 쓰세요." },
  { field: "description", code: "DESCRIPTION_SHORT", test: (v) => v.length > 0 && [...v].length < 40, guidance: "권고: 설명이 너무 짧습니다." },
  { field: "og_image", code: "OG_IMAGE_MISSING", test: (v) => v.length === 0, guidance: "공유 이미지(og:image)가 없습니다. 권고: 공개 접근 가능한 절대 URL을 지정하세요." },
  { field: "canonical", code: "CANONICAL_MISSING", test: (v) => v.length === 0, guidance: "대표(canonical) URL이 없습니다. 권고: 자기 자신을 가리키는 canonical을 두는 것이 일반적입니다." },
];

export function suggestChangesFromAudit(auditId: unknown) {
  const { url, fields } = loadAudit(auditId);
  return RULES
    .filter((rule) => rule.field in fields)
    .filter((rule) => rule.test((fields[rule.field] ?? "").trim()))
    .map((rule) => ({ field: rule.field, url, currentValue: fields[rule.field] ?? "", reasonCode: rule.code, guidance: rule.guidance }));
}

export function createChangeItemFromAudit(auditId: unknown, input: unknown): ChangeItem {
  const parsed = auditChangeSchema.parse(input);
  const { url, fields } = loadAudit(auditId);
  if (!(parsed.field in fields)) {
    throw new AppError("이 진단은 해당 필드를 읽지 않았습니다.", 409, "AUDIT_FIELD_NOT_RECORDED");
  }
  return createChangeItem({ url, field: parsed.field, originalValue: fields[parsed.field] ?? "", proposedValue: parsed.proposedValue, rationale: parsed.rationale });
}
