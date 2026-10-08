import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH as patchAccount } from "@/app/api/admin/accounts/[id]/route";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as signup } from "@/app/api/auth/signup/route";
import { GET as loginPage } from "@/app/login/route";
import { GET as signupPage } from "@/app/signup/route";
import { GET as welcomePage } from "@/app/welcome/route";
import { findAccount, updateAccountStatus } from "@/lib/accounts/store";
import { closeDatabase, getDatabase } from "@/lib/db";
import { authSecret, createSession, SESSION_COOKIE, sessionUser } from "@/lib/login-session";
import { getRequestAccount, withRequestAccount } from "@/lib/request-account";
import { proxy } from "@/proxy";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "geo-signup-flow-"));
const dbPath = path.join(directory, "flow.db");
const secret = "signup-flow-secret-value-with-32-plus-bytes!";
const password = "correct-horse-42";
let address = 0;

function request(pathname: string, init: RequestInit & { user?: string; trusted?: boolean } = {}) {
  const headers = new Headers(init.headers);
  headers.set("host", "geo.example");
  if (!headers.has("x-forwarded-for")) headers.set("x-forwarded-for", `198.51.100.${(address++ % 250) + 1}`);
  if (init.trusted !== false) headers.set("x-geo-auth-secret", process.env.GEO_AUTH_PROXY_SECRET || authSecret());
  if (init.user) headers.set("cookie", `${SESSION_COOKIE}=${createSession(init.user)}`);
  return new NextRequest(`https://geo.example${pathname}`, { method: init.method, body: init.body, headers, signal: undefined });
}

function signupForm(values: Record<string, string> = {}) {
  return new URLSearchParams({
    email: "member@example.com", displayName: "회원", password, passwordConfirm: password, plan: "free", consent: "on", ...values,
  }).toString();
}

function postForm(pathname: string, body: string, headers: Record<string, string> = {}) {
  return request(pathname, { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://geo.example", ...headers } });
}

async function activeCustomer(values: Record<string, string> = {}) {
  vi.stubEnv("GEO_SIGNUP_MODE", "auto");
  const response = await signup(postForm("/api/auth/signup", signupForm(values)));
  vi.stubEnv("GEO_SIGNUP_MODE", "approval");
  return response;
}

function adminHeaders(user: string) {
  return { "x-geo-auth-user": user, "content-type": "application/json", origin: "https://geo.example" };
}

beforeEach(() => {
  vi.stubEnv("GEO_DB_PATH", dbPath);
  vi.stubEnv("GEO_AUTH_MODE", "proxy");
  vi.stubEnv("GEO_AUTH_PROXY_SECRET", secret);
  vi.stubEnv("GEO_HTTP_AUTH", "");
  vi.stubEnv("GEO_ADMIN_USERS", "");
  vi.stubEnv("GEO_GUEST_USERS", "guest");
  vi.stubEnv("GEO_ADMIN_ID", "owner@example.com");
  vi.stubEnv("GEO_ADMIN_PASSWORD", "owner-password-1");
  vi.stubEnv("GEO_SIGNUP_MODE", "approval");
  vi.stubEnv("SEMFORGE_BILLING_MODE", "live");
  getDatabase().sqlite.exec("DELETE FROM accounts; DELETE FROM semforge_subscriptions; DELETE FROM semforge_payment_intents;");
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => {
  closeDatabase(dbPath);
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("landing page as the first screen", () => {
  it("explains GEO Master and separates the free and SEMForge sign-up paths", async () => {
    const response = welcomePage(request("/welcome"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const page = await response.text();
    for (const text of ["GEO란?", "검색 결과에서 AI 답변으로", "응답 점유율", "SEMForge Pro", "₩300,000", "무료 · GEO 측정", "관리자 승인", "og:image"]) {
      expect(page).toContain(text);
    }
    expect(page).toContain('href="/signup?plan=free"');
    expect(page).toContain('href="/signup?plan=semforge"');
    expect(page).toContain('href="/login"');
    expect(page).not.toMatch(/<script/i);
  });

  it("offers the workspace instead of sign-up in local mode or when already signed in", async () => {
    vi.stubEnv("GEO_AUTH_MODE", "local");
    const local = await welcomePage(request("/welcome")).text();
    expect(local).toContain("워크스페이스 열기");
    expect(local).not.toContain("/signup?plan=free");
    vi.stubEnv("GEO_AUTH_MODE", "proxy");
    const signedIn = await welcomePage(request("/welcome", { user: "owner@example.com" })).text();
    expect(signedIn).toContain('href="/subscription"');
    expect(signedIn).not.toContain("/signup?plan=semforge");
  });

  it("hides sign-up links while sign-up is closed", async () => {
    vi.stubEnv("GEO_SIGNUP_MODE", "closed");
    const page = await welcomePage(request("/welcome")).text();
    expect(page).not.toContain("/signup?plan=");
    expect(page).toContain("신규 가입은 받지 않습니다");
  });

  it("rewrites anonymous root requests to the landing page in proxy and app modes", async () => {
    for (const mode of ["proxy", "app"]) {
      vi.stubEnv("GEO_AUTH_MODE", mode);
      const response = await proxy(request("/"));
      expect(response.status).toBe(200);
      expect(response.headers.get("x-middleware-rewrite")).toBe("https://geo.example/welcome");
      expect((await proxy(request("/audit"))).headers.get("location")).toContain("/login?next=%2Faudit");
      // 명시적 로그인 요청, 만료·위조 세션, 틀린 Basic 인증은 소개 화면이 아니라 로그인으로 보낸다.
      expect((await proxy(request("/?login=1"))).status).toBe(303);
      expect((await proxy(request("/", { headers: { cookie: `${SESSION_COOKIE}=expired.token` } }))).status).toBe(303);
      expect((await proxy(request("/", { headers: { authorization: `Basic ${Buffer.from("owner@example.com:wrong").toString("base64")}` } }))).status).toBe(303);
      expect((await proxy(request("/", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }))).status).toBe(401);
    }
    for (const pathname of ["/welcome", "/signup", "/login"]) expect((await proxy(request(pathname, { trusted: false }))).status).toBe(200);
  });
});

describe("sign-up page", () => {
  it("preselects the requested plan and asks for consent", async () => {
    const page = await signupPage(request("/signup?plan=semforge")).text();
    expect(page).toContain('action="/api/auth/signup"');
    expect(page).toMatch(/value="semforge" checked/);
    expect(page).not.toMatch(/value="free" checked/);
    expect(page).toContain("개인정보 수집·이용");
    expect(page).toContain("가입 신청하기");
  });

  it("explains why sign-up is unavailable in local or closed mode", async () => {
    vi.stubEnv("GEO_AUTH_MODE", "local");
    expect(await signupPage(request("/signup")).text()).toContain("단일 사용자 모드");
    vi.stubEnv("GEO_AUTH_MODE", "proxy");
    vi.stubEnv("GEO_SIGNUP_MODE", "closed");
    const closed = await signupPage(request("/signup")).text();
    expect(closed).toContain("현재 신규 가입을 받지 않습니다");
    expect(closed).not.toContain('action="/api/auth/signup"');
  });
});

describe("sign-up submission", () => {
  it("files an approval request without logging the visitor in", async () => {
    const response = await signup(postForm("/api/auth/signup", signupForm()));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login?notice=pending");
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(findAccount("member@example.com")).toMatchObject({ status: "pending", plan: "free" });
    expect(await loginPage(request("/login?notice=pending")).text()).toContain("관리자 승인 후");
  });

  it("logs auto-approved accounts in and routes them by plan", async () => {
    const free = await activeCustomer();
    expect(free.headers.get("location")).toBe("/");
    expect(sessionUser(free.cookies.get(SESSION_COOKIE)?.value)).toBe("member@example.com");
    const paid = await activeCustomer({ email: "pro@example.com", plan: "semforge" });
    expect(paid.headers.get("location")).toBe("/subscription");
  });

  it("re-renders invalid input with escaped values and without the password", async () => {
    const response = await signup(postForm("/api/auth/signup", signupForm({ email: "bad", displayName: "<img src=x onerror=alert(1)>", passwordConfirm: "mismatch-value" })));
    expect(response.status).toBe(422);
    const page = await response.text();
    expect(page).toContain("올바른 이메일 주소");
    expect(page).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(page).not.toContain("<img src=x");
    expect(page).not.toContain(password);
    expect(response.headers.get("content-security-policy")).toContain("form-action 'self'");
  });

  it("refuses duplicate, reserved and closed sign-ups", async () => {
    await activeCustomer();
    expect((await signup(postForm("/api/auth/signup", signupForm({ email: "MEMBER@example.com" })))).status).toBe(409);
    expect((await signup(postForm("/api/auth/signup", signupForm({ email: "owner@example.com" })))).status).toBe(409);
    vi.stubEnv("GEO_SIGNUP_MODE", "closed");
    const closed = await signup(postForm("/api/auth/signup", signupForm({ email: "late@example.com" })));
    expect(closed.status).toBe(403);
    expect(findAccount("late@example.com")).toBeNull();
  });

  it("enforces the same request boundary as the login form", async () => {
    expect((await signup(postForm("/api/auth/signup", signupForm(), { origin: "https://evil.example" }))).status).toBe(403);
    expect((await signup(request("/api/auth/signup", { method: "POST", body: signupForm(), trusted: false, headers: { "content-type": "application/x-www-form-urlencoded" } }))).status).toBe(403);
    expect((await signup(request("/api/auth/signup", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }))).status).toBe(415);
    expect((await signup(postForm("/api/auth/signup", "x".repeat(5000)))).status).toBe(413);
    vi.stubEnv("GEO_AUTH_MODE", "local");
    expect((await signup(postForm("/api/auth/signup", signupForm()))).status).toBe(503);
  });

  it("rate-limits repeated attempts from one address", async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      const response = await signup(postForm("/api/auth/signup", signupForm({ email: "bad" }), { "x-forwarded-for": "203.0.113.9" }));
      statuses.push(response.status);
    }
    expect(statuses.slice(0, 10).every((status) => status === 422)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});

describe("login after sign-up", () => {
  const loginBody = (username: string, secretValue = password, next = "/") => new URLSearchParams({ username, password: secretValue, next }).toString();

  it("tells pending and disabled members why they cannot log in yet", async () => {
    await signup(postForm("/api/auth/signup", signupForm()));
    const pending = await login(postForm("/api/auth/login", loginBody("Member@Example.com")));
    expect(pending.headers.get("location")).toContain("error=pending");
    expect(pending.headers.has("set-cookie")).toBe(false);
    expect(await loginPage(request("/login?error=pending")).text()).toContain("승인 대기");
    const account = findAccount("member@example.com");
    updateAccountStatus(account!.id, "disabled", "owner@example.com");
    expect((await login(postForm("/api/auth/login", loginBody("member@example.com")))).headers.get("location")).toContain("error=disabled");
    expect((await login(postForm("/api/auth/login", loginBody("member@example.com", "wrong-password")))).headers.get("location")).toContain("error=invalid");
  });

  it("sends free members to GEO measurement and SEMForge members to billing", async () => {
    await activeCustomer();
    await activeCustomer({ email: "pro@example.com", plan: "semforge" });
    expect((await login(postForm("/api/auth/login", loginBody("member@example.com")))).headers.get("location")).toBe("/");
    expect((await login(postForm("/api/auth/login", loginBody("pro@example.com")))).headers.get("location")).toBe("/subscription");
    expect((await login(postForm("/api/auth/login", loginBody("pro@example.com", password, "/audit")))).headers.get("location")).toBe("/audit");
    expect((await login(postForm("/api/auth/login", loginBody("pro@example.com", password, "/settings")))).headers.get("location")).toBe("/");
  });

  it("logs the .env administrator in with full access", async () => {
    const response = await login(postForm("/api/auth/login", loginBody("OWNER@example.com", "owner-password-1", "/admin/accounts")));
    expect(response.headers.get("location")).toBe("/admin/accounts");
    const token = response.cookies.get(SESSION_COOKIE)!.value;
    expect(sessionUser(token)).toBe("owner@example.com");
    expect(await loginPage(request("/login")).text()).toContain('href="/signup"');
  });
});

describe("role-aware proxy", () => {
  it("keeps customers out of operator settings and lets administrators manage members", async () => {
    await activeCustomer();
    expect((await proxy(request("/settings", { user: "member@example.com" }))).status).toBe(403);
    expect((await proxy(request("/api/workspace", { user: "member@example.com" }))).status).toBe(403);
    expect((await proxy(request("/subscription", { user: "member@example.com" }))).status).toBe(200);
    expect((await proxy(request("/admin/accounts", { user: "member@example.com" }))).status).toBe(403);
    const admin = await proxy(request("/admin/accounts", { user: "owner@example.com" }));
    expect(admin.status).toBe(200);
    expect(admin.headers.get("x-middleware-request-x-geo-auth-user")).toBe("owner@example.com");
  });

  it("acts as the trust boundary in app mode", async () => {
    vi.stubEnv("GEO_AUTH_MODE", "app");
    vi.stubEnv("GEO_AUTH_PROXY_SECRET", "");
    const derived = authSecret();
    expect(derived.length).toBeGreaterThanOrEqual(32);
    const forged = await proxy(request("/welcome", { trusted: false, headers: { "x-geo-auth-user": "owner@example.com", "x-geo-auth-secret": "forged" } }));
    expect(forged.headers.get("x-middleware-override-headers")).not.toContain("x-geo-auth-user");
    expect(forged.headers.get("x-middleware-request-x-geo-auth-secret")).toBeNull();
    const anonymousApi = await proxy(request("/api/projects", { trusted: false, headers: { "x-geo-auth-user": "owner@example.com", "x-geo-auth-secret": derived } }));
    expect(anonymousApi.status).toBe(401);
    const signedIn = await proxy(request("/api/projects", { trusted: false, user: "owner@example.com" }));
    expect(signedIn.headers.get("x-middleware-request-x-geo-auth-user")).toBe("owner@example.com");
    expect(signedIn.headers.get("x-middleware-request-x-geo-auth-secret")).toBe(derived);
    const form = await proxy(postForm("/api/auth/signup", signupForm()));
    expect(form.headers.get("x-middleware-request-x-geo-auth-secret")).toBe(derived);
    const account = withRequestAccount(new Headers({ "x-geo-auth-user": "owner@example.com", "x-geo-auth-secret": derived }), getRequestAccount);
    expect(account).toEqual({ id: "owner@example.com", role: "admin" });
  });
});

describe("member administration API", () => {
  it("lets the administrator approve and suspend sign-ups", async () => {
    await signup(postForm("/api/auth/signup", signupForm({ plan: "semforge" })));
    const id = String(findAccount("member@example.com")!.id);
    const approve = await patchAccount(request(`/api/admin/accounts/${id}`, { method: "PATCH", body: JSON.stringify({ status: "active" }), headers: adminHeaders("owner@example.com") }), { params: Promise.resolve({ id }) });
    expect(approve.status).toBe(200);
    expect(approve.headers.get("cache-control")).toBe("private, no-store");
    expect((await approve.json()).account).toMatchObject({ status: "active", plan: "semforge", approvedBy: "owner@example.com", semforge: { active: false } });
    const suspend = await patchAccount(request(`/api/admin/accounts/${id}`, { method: "PATCH", body: JSON.stringify({ status: "disabled" }), headers: adminHeaders("owner@example.com") }), { params: Promise.resolve({ id }) });
    expect((await suspend.json()).account.status).toBe("disabled");
  });

  it("rejects non-administrators, invalid statuses and unknown accounts", async () => {
    await activeCustomer();
    const id = String(findAccount("member@example.com")!.id);
    const patch = (user: string, body: unknown, target = id) => patchAccount(
      request(`/api/admin/accounts/${target}`, { method: "PATCH", body: JSON.stringify(body), headers: adminHeaders(user) }),
      { params: Promise.resolve({ id: target }) },
    );
    expect((await patch("member@example.com", { status: "active" })).status).toBe(403);
    expect((await patch("guest", { status: "active" })).status).toBe(403);
    expect((await patch("owner@example.com", { status: "deleted" })).status).toBe(422);
    expect((await patch("owner@example.com", { status: "active", role: "admin" })).status).toBe(422);
    expect((await patch("owner@example.com", { status: "active" }, "9999")).status).toBe(404);
  });
});
