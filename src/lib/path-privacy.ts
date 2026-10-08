/** 경로 개인정보 보호: 쿼리스트링·조각 제거, 토큰처럼 보이는 경로 조각은 :id로 가린다. */
const MAX_PATH_LENGTH = 300;
const MAX_DECODE_PASSES = 3;
const LONG_TOKEN = /^[A-Za-z0-9._~+\-=]{20,}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WORD_SLUG = /^[a-z]+(?:-[a-z]+)+$/;

function maskSegment(segment: string) {
  let decoded = segment;
  try {
    for (let pass = 0; pass < MAX_DECODE_PASSES && decoded.includes("%"); pass += 1) {
      decoded = decodeURIComponent(decoded);
    }
  } catch {
    // 손상된 인코딩도 원문을 남기지 않는다.
    return ":id";
  }
  // 반복 인코딩과 인코딩된 구분자는 쪼개지 않고 전체 조각을 가린다.
  if (/%|[/\\?#@;=\s]|\p{Cc}/u.test(decoded)) return ":id";
  // 일반 소문자 단어 slug는 보존한다. 숫자·대문자·점 등이 섞인 긴 URL-safe 값은 가린다.
  if (UUID.test(decoded) || (LONG_TOKEN.test(decoded) && !WORD_SLUG.test(decoded))) return ":id";
  return segment;
}

export function sanitizePath(target: string) {
  let path = target.trim();
  if (/^https?:\/\//i.test(path)) {
    try { path = new URL(path).pathname; } catch { path = "/"; }
  }
  path = path.split(/[?#]/)[0] ?? "";
  // 길이 제한 전에 검사해 토큰의 잘린 앞부분이 저장되지 않게 한다.
  return path.split("/").map(maskSegment).join("/").slice(0, MAX_PATH_LENGTH);
}
