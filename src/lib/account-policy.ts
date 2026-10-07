export type AccountRole = "admin" | "member" | "guest";

export function accountRole(user: string): AccountRole {
  const contains = (value: string | undefined) => (value ?? "").split(",").some((entry) => entry.trim() === user);
  // A guest designation always wins if configuration lists overlap.
  if (contains(process.env.GEO_GUEST_USERS ?? "guest")) return "guest";
  return contains(process.env.GEO_ADMIN_USERS) ? "admin" : "member";
}

const guestRestricted = [
  "/settings", "/subscription", "/workspace", "/semforge", "/ai-seo", "/site-audit",
  "/position-tracking", "/analytics", "/local-business",
  "/api/settings", "/api/workspace", "/api/semforge", "/api/ai-seo", "/api/site-audit",
  "/api/position-tracking", "/api/analytics", "/api/local-business",
];

export function canAccessPath(role: AccountRole, pathname: string): boolean {
  let path: string;
  try { path = decodeURIComponent(pathname).replace(/\/{2,}/g, "/").toLowerCase(); }
  catch { return false; }
  return role !== "guest" || !guestRestricted.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}
