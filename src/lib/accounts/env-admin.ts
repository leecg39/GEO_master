import { exceedsBcryptLimit, normalizeLoginId, USERNAME_PATTERN } from "./identity";

export const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;
export const MIN_PASSWORD_LENGTH = 8;

export interface EnvAdmin {
  /** 정규화된 로그인 아이디 */
  id: string;
  /** bcrypt 해시 또는 평문 비밀번호 원문 */
  password: string;
  kind: "bcrypt" | "plain";
}

/**
 * .env의 GEO_ADMIN_ID / GEO_ADMIN_PASSWORD로 지정한 관리자 계정.
 * 비밀번호는 bcrypt 해시($2b$...) 또는 8자 이상 평문을 받는다. 둘 중 하나라도 비었거나 형식이 틀리면 비활성으로 본다.
 */
export function envAdmin(): EnvAdmin | null {
  const id = normalizeLoginId(process.env.GEO_ADMIN_ID ?? "");
  const password = (process.env.GEO_ADMIN_PASSWORD ?? "").trim();
  if (!id || !USERNAME_PATTERN.test(id) || !password) return null;
  if (BCRYPT_HASH_PATTERN.test(password)) return { id, password, kind: "bcrypt" };
  if (password.length < MIN_PASSWORD_LENGTH || exceedsBcryptLimit(password)) return null;
  return { id, password, kind: "plain" };
}

export function isEnvAdmin(user: string): boolean {
  const admin = envAdmin();
  return Boolean(admin) && admin?.id === normalizeLoginId(user);
}
