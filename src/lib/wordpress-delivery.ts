/**
 * 승인된 수정안을 WordPress에 쓴다 (R08). 근거: docs/planning/rankseo-wordpress-spike.md
 * RankSEO의 fixSEOMeta는 단일 글 수정이 없으면 seo_fix_all(dry_run:false)로 사이트 전체를 고쳤다. 여기서는:
 * - 승인된 수정안 1건 → 글 1개 → 메타 키 1개만. 대체 경로·일괄 쓰기는 없다
 * - 공개 페이지와 1:1 반영이 확인된 필드(Yoast 제목·설명)만, 연결에서 플러그인 메타 쓰기를 허용한 경우만
 * - 미리보기 토큰(대상 글·키·저장값·수정 시각)이 실행 직전과 같아야 쓴다
 * - 공개 페이지의 현재 값이 원래 값과 다르면 쓰지 않고 conflict
 * - 쓰기 응답의 값을 다시 확인한다(등록되지 않은 키는 200이어도 저장되지 않는다). 반영 확인(verified)은 공개 페이지 재수집이 한다
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { recordDelivery, type DeliveryTarget } from "./change-deliveries";
import { approvedChangeRow, markConflict, markDeliveredByWordpress, matchesOriginal } from "./change-items";
import { AppError } from "./errors";
import { findWordpressPost, normalizeWordpressSite, readWordpressMeta, WORDPRESS_WRITABLE_FIELDS, wordpressRequest } from "./integrations/wordpress";
import { extractPageField, fieldMatches } from "./page-fields";
import { fetchPublicText } from "./url-security";
import { requireWordpressCredentials } from "./wordpress-connections";

const PAGE_TIMEOUT_MS = 10_000;

export const executeSchema = z.object({ previewToken: z.string().regex(/^[a-f0-9]{64}$/) }).strict();

async function publicFieldValue(url: string, field: string) {
  try {
    const page = await fetchPublicText(url, PAGE_TIMEOUT_MS);
    if (page.status < 200 || page.status >= 300) throw new AppError(`공개 페이지가 HTTP ${page.status}로 응답해 현재 값을 확인할 수 없습니다.`, 502, "WORDPRESS_PUBLIC_CHECK_FAILED");
    return extractPageField(page.text, field);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("공개 페이지를 가져오지 못해 현재 값을 확인할 수 없습니다.", 502, "WORDPRESS_PUBLIC_CHECK_FAILED");
  }
}

async function plan(idInput: unknown) {
  const change = approvedChangeRow(idInput);
  const credentials = requireWordpressCredentials();
  const metaKey = WORDPRESS_WRITABLE_FIELDS[credentials.seoPlugin]?.[change.field];
  if (!metaKey) {
    throw new AppError("이 필드는 WordPress에 직접 쓸 수 없습니다. 수동 적용 안내를 따라 반영하세요. (지원: Yoast SEO 제목·설명)", 422, "WORDPRESS_FIELD_UNSUPPORTED");
  }
  if (!credentials.allowSeoPluginWrites) {
    throw new AppError("WordPress 연결에서 'SEO 플러그인 메타 쓰기'를 허용해야 합니다.", 409, "WORDPRESS_WRITES_DISABLED");
  }
  const post = await findWordpressPost(credentials, change.url);
  if (post.status === "none") throw new AppError("이 URL에 해당하는 WordPress 글을 찾지 못했습니다.", 404, "WORDPRESS_POST_NOT_FOUND");
  if (post.status === "ambiguous") throw new AppError(`이 URL에 해당하는 글이 ${post.count}개라 대상을 정할 수 없습니다.`, 409, "WORDPRESS_POST_AMBIGUOUS");
  const stored = await readWordpressMeta(credentials, post.type, post.id);
  const storedValue = typeof stored.meta[metaKey] === "string" ? stored.meta[metaKey] as string : null;
  if (storedValue === null) throw new AppError("WordPress가 이 메타 키를 REST로 노출하지 않습니다. 수동으로 적용하세요.", 422, "WORDPRESS_FIELD_UNSUPPORTED");
  const site = normalizeWordpressSite(credentials.siteUrl);
  const previewToken = createHash("sha256").update(JSON.stringify([change.id, change.updatedAt, site, post.id, metaKey, storedValue, stored.modifiedGmt])).digest("hex");
  return { change, credentials, site, post, metaKey, storedValue, modifiedGmt: stored.modifiedGmt, previewToken };
}

/** 무엇을 어디에 쓰는지 보여 준다. 아무것도 바꾸지 않는다 */
export async function previewWordpressDelivery(idInput: unknown) {
  const planned = await plan(idInput);
  return {
    changeId: planned.change.id, site: planned.site, postId: planned.post.id, postType: planned.post.type, metaKey: planned.metaKey,
    storedValue: planned.storedValue, publicValue: await publicFieldValue(planned.change.url, planned.change.field),
    proposedValue: planned.change.proposedValue, modifiedGmt: planned.modifiedGmt, previewToken: planned.previewToken,
  };
}

export async function executeWordpressDelivery(idInput: unknown, input: unknown) {
  const { previewToken } = executeSchema.parse(input);
  const started = performance.now();
  const startedAt = new Date().toISOString();
  const planned = await plan(idInput);
  if (planned.previewToken !== previewToken) {
    throw new AppError("미리보기 이후 WordPress 글이나 수정안이 바뀌었습니다. 다시 미리보기 하세요.", 409, "WORDPRESS_PREVIEW_STALE");
  }
  const { change, credentials, site, post, metaKey, storedValue } = planned;
  const target: DeliveryTarget = { site, postId: post.id, postType: post.type, metaKey };
  const base = { method: "wordpress" as const, target, previousValue: storedValue, startedAt };
  const current = await publicFieldValue(change.url, change.field);
  if (!matchesOriginal(change.originalHash, current)) {
    recordDelivery(change.id, { ...base, result: "conflict", httpStatus: null, errorCode: "CHANGE_CONFLICT", remoteModifiedAt: planned.modifiedGmt, durationMs: performance.now() - started });
    markConflict(change.id);
    throw new AppError("공개 페이지의 현재 값이 수정안을 만들 때의 값과 다릅니다. 충돌로 표시했습니다.", 409, "CHANGE_CONFLICT");
  }
  let written: { modified_gmt?: string; meta?: Record<string, unknown> };
  try {
    written = await wordpressRequest(site, `/wp-json/wp/v2/${post.type}s/${post.id}?_fields=id,modified_gmt,meta`, { credentials, method: "POST", body: { meta: { [metaKey]: change.proposedValue } } });
  } catch (error) {
    const code = error instanceof AppError ? error.code : "WORDPRESS_WRITE_FAILED";
    recordDelivery(change.id, { ...base, result: "error", httpStatus: null, errorCode: code, remoteModifiedAt: null, durationMs: performance.now() - started });
    throw error;
  }
  const writtenValue = typeof written.meta?.[metaKey] === "string" ? written.meta[metaKey] as string : null;
  if (!fieldMatches(change.field, writtenValue, change.proposedValue)) {
    recordDelivery(change.id, { ...base, result: "error", httpStatus: 200, errorCode: "WORDPRESS_WRITE_IGNORED", remoteModifiedAt: written.modified_gmt ?? null, durationMs: performance.now() - started });
    throw new AppError("WordPress가 요청을 받았지만 값을 저장하지 않았습니다. 플러그인 설정을 확인하고 수동으로 적용하세요.", 502, "WORDPRESS_WRITE_IGNORED");
  }
  recordDelivery(change.id, { ...base, result: "ok", httpStatus: 200, errorCode: null, remoteModifiedAt: written.modified_gmt ?? null, durationMs: performance.now() - started });
  return { item: markDeliveredByWordpress(change.id), target, previousValue: storedValue };
}
