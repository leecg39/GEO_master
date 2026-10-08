/** 로그인 계열 HTML 폼(application/x-www-form-urlencoded) 요청 처리 도구 */
export const FORM_BODY_LIMIT = 4096;

export function isFormRequest(request: Request): boolean {
  return /^application\/x-www-form-urlencoded(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "");
}

/** 신뢰 프록시가 마지막에 덧붙인 주소를 쓴다. 클라이언트가 보낸 앞쪽 값은 믿지 않는다. */
export function clientAddress(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || "unknown";
}

/** 본문을 제한 크기까지만 읽는다. 크기를 넘거나 본문이 없으면 null. */
export async function readLimitedForm(request: Request, limit = FORM_BODY_LIMIT): Promise<URLSearchParams | null> {
  if (Number(request.headers.get("content-length")) > limit || !request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

export interface AttemptLimiter {
  /** 이번 시도를 기록하고 허용 여부를 돌려준다 */
  allow(key: string, now?: number): boolean;
}

/** 단일 프로세스 메모리 기준 고정 창 시도 제한. 키 수가 상한에 닿으면 새 키를 거절한다. */
export function createAttemptLimiter({ limit, windowMs, maxKeys = 5000 }: { limit: number; windowMs: number; maxKeys?: number }): AttemptLimiter {
  const attempts = new Map<string, { count: number; until: number }>();
  return {
    allow(key, now = Date.now()) {
      for (const [entryKey, entry] of attempts) if (entry.until <= now) attempts.delete(entryKey);
      const current = attempts.get(key);
      if (!current && attempts.size >= maxKeys) return false;
      const next = { count: (current?.count ?? 0) + 1, until: current?.until ?? now + windowMs };
      attempts.set(key, next);
      return next.count <= limit;
    },
  };
}
