export type AccountRole = "admin" | "member" | "guest";

export function accountRole(user: string): AccountRole {
  const contains = (value: string | undefined) => (value ?? "").split(",").some((entry) => entry.trim() === user);
  // A guest designation always wins if configuration lists overlap.
  if (contains(process.env.GEO_GUEST_USERS ?? "guest")) return "guest";
  return contains(process.env.GEO_ADMIN_USERS) ? "admin" : "member";
}

const guestRestricted = [
  "/settings", "/subscription", "/workspace", "/semforge", "/ai-seo", "/site-audit",
  "/position-tracking", "/analytics", "/local-business", "/search-console", "/bot-logs", "/outcomes",
  "/api/settings", "/api/workspace", "/api/semforge", "/api/ai-seo", "/api/site-audit",
  "/api/position-tracking", "/api/analytics", "/api/local-business", "/api/search-console", "/api/bot-logs", "/api/outcomes", "/api/integrations",
  // 공개 링크는 데이터를 외부로 내보내므로 게스트가 만들 수 없다
  "/api/report-shares",
];

export function canAccessPath(role: AccountRole, pathname: string): boolean {
  let path: string;
  try { path = decodeURIComponent(pathname).replace(/\/{2,}/g, "/").toLowerCase(); }
  catch { return false; }
  return role !== "guest" || !guestRestricted.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** 리포트 부록에도 각 원천 API와 동일한 권한을 적용한다. */
export function canAccessReportObservations(role: AccountRole): boolean {
  return ["/api/search-console", "/api/bot-logs", "/api/outcomes"].every((path) => canAccessPath(role, path));
}
