/** 경로 개인정보 보호: 쿼리스트링·조각 제거, 재설정 링크·세션 ID 같은 토큰 조각은 :id로 가린다 */
const MAX_PATH_LENGTH = 300;

const LONG_TOKEN = /^[A-Za-z0-9_]{20,}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function maskSegment(segment: string) {
  // 하이픈으로 이어진 글 주소(slug)는 남기고, 하이픈 없는 긴 토큰과 UUID만 가린다
  return LONG_TOKEN.test(segment) || UUID.test(segment) ? ":id" : segment;
}

export function sanitizePath(target: string) {
  let path = target.trim();
  if (/^https?:\/\//i.test(path)) {
    try { path = new URL(path).pathname; } catch { path = "/"; }
  }
  path = path.split(/[?#]/)[0] ?? "";
  return path.split("/").map(maskSegment).join("/").slice(0, MAX_PATH_LENGTH);
}
