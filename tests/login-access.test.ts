import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accountRole } from "@/lib/account-policy";
import { createSession, safeReturnPath, SESSION_COOKIE, sessionUser, verifyPassword } from "@/lib/login-session";
import { proxy } from "@/proxy";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { GET as loginPage } from "@/app/login/route";

const secret = "s".repeat(64);
const hash = bcrypt.hashSync("demo", 4);
function request(path: string, user?: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("host", "geo.example");
  headers.set("x-geo-auth-secret", secret);
  if (user) headers.set("cookie", `${SESSION_COOKIE}=${createSession(user)}`);
  return new NextRequest(`https://geo.example${path}`, { ...init, signal: undefined, headers });
}
beforeEach(() => {
  vi.stubEnv("GEO_AUTH_MODE", "proxy");
  vi.stubEnv("GEO_AUTH_PROXY_SECRET", secret);
  vi.stubEnv("GEO_HTTP_AUTH", `geo-admin:${hash},guest:${hash},member:${hash}`);
  vi.stubEnv("GEO_ADMIN_USERS", "geo-admin");
  vi.stubEnv("GEO_GUEST_USERS", "guest");
});
afterEach(() => vi.unstubAllEnvs());

describe("login and session boundary", () => {
  it("renders a login form and redirects anonymous pages instead of Basic Auth challenges", async () => {
    const page = loginPage(request("/login"));
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('action="/api/auth/login"');
    const response = await proxy(request("/subscription"));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("/login?next=%2Fsubscription");
    expect(response.headers.has("www-authenticate")).toBe(false);
    expect((await proxy(request("/api/settings"))).status).toBe(401);
  });
  it("validates bcrypt passwords including Traefik 2y hashes", async () => {
    vi.stubEnv("GEO_HTTP_AUTH", `guest:${hash.replace("$2b$", "$2y$")}`);
    expect(await verifyPassword("guest", "demo")).toBe("guest");
    expect(await verifyPassword("guest", "incorrect")).toBeNull();
    expect(await verifyPassword("missing", "demo")).toBeNull();
    expect(await verifyPassword("guest", "a".repeat(73))).toBeNull();
  });
  it("rejects expired, tampered, removed-account and password-rotated sessions", () => {
    const now = Date.now();
    const token = createSession("guest", now);
    expect(sessionUser(token, now)).toBe("guest");
    expect(sessionUser(token, now + 13 * 3600000)).toBeNull();
    expect(sessionUser(token + "x", now)).toBeNull();
    vi.stubEnv("GEO_HTTP_AUTH", `guest:${bcrypt.hashSync("changed", 4)}`);
    expect(sessionUser(token, now)).toBeNull();
    vi.stubEnv("GEO_HTTP_AUTH", "");
    expect(sessionUser(token, now)).toBeNull();
  });
  it("logs in with a secure cookie, preserves return paths, and clears it on logout", async () => {
    const response = await login(request("/api/auth/login", undefined, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://geo.example" }, body: "username=guest&password=demo&next=%2Faudit" }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/audit");
    const cookie = response.headers.get("set-cookie")!;
    for (const attribute of ["HttpOnly", "Secure", "SameSite=lax", "Path=/"]) expect(cookie).toContain(attribute);
    const token = response.cookies.get(SESSION_COOKIE)!.value;
    expect(sessionUser(token)).toBe("guest");
    const cleared = logout(request("/api/auth/logout", "guest", { method: "POST" }));
    expect(cleared.headers.get("set-cookie")).toContain("Max-Age=0");
  });
  it("rejects login CSRF, oversized payloads, wrong passwords and unsafe redirects", async () => {
    const form = { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "username=guest&password=wrong" };
    expect((await login(request("/api/auth/login", undefined, { ...form, headers: { ...form.headers, origin: "https://evil.example" } }))).status).toBe(403);
    expect((await login(request("/api/auth/login", undefined, { ...form, body: "x".repeat(4097) }))).status).toBe(413);
    const bad = await login(request("/api/auth/login", undefined, form));
    expect(bad.headers.get("location")).toContain("error=invalid");
    expect(bad.headers.has("set-cookie")).toBe(false);
    for (const value of ["//evil.example", "/\\evil.example", "https://evil.example", "/api/settings", "/login"]) expect(safeReturnPath(value)).toBe("/");
  });
  it("does not trust forged account headers or an unsigned cookie", async () => {
    const forged = await proxy(request("/api/settings", undefined, { headers: { "x-geo-auth-user": "geo-admin", cookie: `${SESSION_COOKIE}=guest` } }));
    expect(forged.status).toBe(401);
    const allowed = await proxy(request("/api/projects", "guest", { headers: { "x-geo-auth-user": "geo-admin" } }));
    expect(allowed.headers.get("x-middleware-request-x-geo-auth-user")).toBe("guest");
    const direct = new NextRequest("https://geo.example/api/projects", { headers: { cookie: `${SESSION_COOKIE}=${createSession("guest")}` } });
    expect((await proxy(direct)).status).toBe(401);
  });
});

describe("guest restrictions", () => {
  it.each(["/settings", "/settings/", "/subscription", "/workspace", "/semforge", "/ai-seo", "/api/settings", "/api/workspace?download=1", "/api/workspace/backups/1", "/api/semforge/subscription", "/api/semforge/subscription/checkout", "/api/semforge/subscription/confirm", "/api/site-audit", "/api/%73ettings"])("blocks direct access to %s", async (path) => {
    expect((await proxy(request(path, "guest"))).status).toBe(403);
  });
  it("blocks guest settings mutations and payment requests even with forged headers", async () => {
    for (const path of ["/api/settings", "/api/semforge/subscription/checkout", "/api/workspace/backups/1/restore"]) {
      const response = await proxy(request(path, "guest", { method: "POST", headers: { "content-type": "application/json", "x-geo-auth-user": "geo-admin" }, body: "{}" }));
      expect(response.status).toBe(403);
    }
  });
  it("keeps core guest routes open and preserves admin/member access", async () => {
    for (const path of ["/", "/audit", "/share", "/api/projects", "/api/measurement-context"]) expect((await proxy(request(path, "guest"))).status).toBe(200);
    for (const user of ["geo-admin", "member"]) for (const path of ["/settings", "/subscription", "/api/semforge/subscription"]) expect((await proxy(request(path, user))).status).toBe(200);
    vi.stubEnv("GEO_ADMIN_USERS", "geo-admin,guest");
    expect(accountRole("guest")).toBe("guest");
  });
  it("does not let a cached admin Basic header override the guest cookie", async () => {
    const response = await proxy(request("/api/settings", "guest", { headers: { authorization: `Basic ${Buffer.from("geo-admin:demo").toString("base64")}` } }));
    expect(response.status).toBe(403);
  });
});
