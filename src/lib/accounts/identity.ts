/** 로그인 아이디 형식. 세션·프록시 헤더 검증과 동일한 규칙을 공유한다. */
export const USERNAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9@._+-]{0,127}$/;

export function isEmailLike(value: string): boolean {
  return value.includes("@");
}

/** 이메일 형태의 아이디는 대소문자를 구분하지 않도록 소문자로 맞춘다. 일반 아이디는 그대로 둔다. */
export function normalizeLoginId(value: string): string {
  const trimmed = value.trim();
  return isEmailLike(trimmed) ? trimmed.toLowerCase() : trimmed;
}

/** bcrypt는 72바이트 이후를 무시하므로 그보다 긴 비밀번호는 받지 않는다. */
export function exceedsBcryptLimit(password: string): boolean {
  return Buffer.byteLength(password, "utf8") > 72;
}
