import { envAdmin, isEnvAdmin } from "@/lib/accounts/env-admin";
import { normalizeLoginId } from "@/lib/accounts/identity";
import { configuredAccountIds, isSelfRegisteredAccount } from "./login-session";

/**
 * admin: .env 관리자 또는 GEO_ADMIN_USERS · member: 운영 계정(GEO_HTTP_AUTH)
 * customer: 회원가입 계정 · guest: GEO_GUEST_USERS
 */
export type AccountRole = "admin" | "member" | "customer" | "guest";

export function accountRole(user: string): AccountRole {
  const contains = (value: string | undefined) => (value ?? "").split(",").some((entry) => entry.trim() === user);
  // A guest designation always wins if configuration lists overlap.
  if (contains(process.env.GEO_GUEST_USERS ?? "guest")) return "guest";
  if (isEnvAdmin(user) || contains(process.env.GEO_ADMIN_USERS)) return "admin";
  return isSelfRegisteredAccount(user) ? "customer" : "member";
}

/** Role names alone do not create credentials. Guests cannot approve accounts. */
export function hasConfiguredAdministrator(): boolean {
  const admin = envAdmin();
  const users = [...(admin ? [admin.id] : []), ...configuredAccountIds()];
  // Match login's .env-admin precedence and normalized identity, including
  // an HTTP account shadowed by the same email-shaped administrator id.
  return users.some((user) => accountRole(admin?.id === normalizeLoginId(user) ? admin.id : user) === "admin");
}

/** 회원 승인 등 관리 화면은 관리자만 */
const adminOnly = ["/admin", "/api/admin"];

const guestRestricted = [
  "/settings", "/subscription", "/workspace", "/semforge", "/ai-seo", "/site-audit",
  "/position-tracking", "/analytics", "/local-business", "/search-console",
  "/api/settings", "/api/workspace", "/api/semforge", "/api/ai-seo", "/api/site-audit",
  "/api/position-tracking", "/api/analytics", "/api/local-business", "/api/search-console",
  // 공개 링크는 데이터를 외부로 내보내므로 게스트가 만들 수 없다
  "/api/report-shares",
];

/** 회원가입 계정은 공용 API 키·모델 설정과 워크스페이스 백업·복원(전체 교체)에 접근할 수 없다 */
const customerRestricted = ["/settings", "/workspace", "/api/settings", "/api/workspace"];

export function canAccessPath(role: AccountRole, pathname: string): boolean {
  let path: string;
  try { path = decodeURIComponent(pathname).replace(/\/{2,}/g, "/").toLowerCase(); }
  catch { return false; }
  const matches = (prefixes: readonly string[]) => prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  if (matches(adminOnly)) return role === "admin";
  if (role === "guest") return !matches(guestRestricted);
  if (role === "customer") return !matches(customerRestricted);
  return true;
}
