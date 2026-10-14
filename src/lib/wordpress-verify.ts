/**
 * 반영 확인 때 WordPress 저장값도 읽는다 (R09).
 * "WordPress에 저장됐는가"와 "공개 페이지에 보이는가"를 나눠 기록해, 캐시·CDN 지연을 구분할 수 있게 한다.
 * 실패해도 공개 페이지 확인은 계속한다. 매핑할 수 없는 필드나 연결이 없으면 아무것도 하지 않는다.
 */
import { recordVerification } from "./change-verifications";
import { AppError } from "./errors";
import { findWordpressPost, readWordpressMeta, WORDPRESS_WRITABLE_FIELDS } from "./integrations/wordpress";
import { fieldMatches } from "./page-fields";
import { getWordpressCredentials } from "./wordpress-connections";

export async function recordWordpressStoredValue(change: { id: number; url: string; field: string; proposedValue: string }) {
  let credentials: ReturnType<typeof getWordpressCredentials>;
  try { credentials = getWordpressCredentials(); } catch { return; }
  const metaKey = credentials ? WORDPRESS_WRITABLE_FIELDS[credentials.seoPlugin]?.[change.field] : undefined;
  if (!credentials || !metaKey) return;
  const started = performance.now();
  const base = { source: "wordpress" as const, checkedUrl: change.url, finalUrl: null };
  try {
    const post = await findWordpressPost(credentials, change.url);
    if (post.status !== "found") {
      recordVerification(change.id, { ...base, result: "fetch_error", httpStatus: null, matched: null, actual: null, durationMs: performance.now() - started,
        errorCode: post.status === "none" ? "WORDPRESS_POST_NOT_FOUND" : "WORDPRESS_POST_AMBIGUOUS", checkedAt: new Date().toISOString() });
      return;
    }
    const stored = await readWordpressMeta(credentials, post.type, post.id);
    const value = typeof stored.meta[metaKey] === "string" ? stored.meta[metaKey] as string : null;
    const matched = fieldMatches(change.field, value, change.proposedValue);
    recordVerification(change.id, { ...base, result: matched ? "matched" : "pending", httpStatus: 200, matched, actual: value, durationMs: performance.now() - started, errorCode: null, checkedAt: new Date().toISOString() });
  } catch (error) {
    recordVerification(change.id, { ...base, result: "fetch_error", httpStatus: null, matched: null, actual: null, durationMs: performance.now() - started,
      errorCode: error instanceof AppError ? error.code : "WORDPRESS_READ_FAILED", checkedAt: new Date().toISOString() });
  }
}
