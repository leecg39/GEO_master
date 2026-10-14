// Frozen RSI benchmark for the landing, sign-up and member administration feature.
// SHA-256 pinned in eval/frozen.json. Experiments adapt the product code, never this file.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { load, type CheerioAPI } from "cheerio";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as signup } from "@/app/api/auth/signup/route";
import { GET as loginPage } from "@/app/login/route";
import { GET as signupPage } from "@/app/signup/route";
import { GET as welcomePage } from "@/app/welcome/route";
import { registerAccount } from "@/lib/accounts/signup";
import { findAccount } from "@/lib/accounts/store";
import { closeDatabase, getDatabase } from "@/lib/db";
import { createSession, SESSION_COOKIE } from "@/lib/login-session";
import { proxy } from "@/proxy";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "geo-signup-rsi-"));
const dbPath = path.join(directory, "eval.db");
const secret = "signup-rsi-eval-secret-with-32-plus-bytes!";
const strong = "tide-Orbit-73";
const formHeaders = { "content-type": "application/x-www-form-urlencoded", origin: "https://geo.example" };
let address = 0;

type Init = { method?: string; body?: string; headers?: Record<string, string>; user?: string };
type Cheerio = ReturnType<CheerioAPI>;

function request(pathname: string, init: Init = {}) {
  const headers = new Headers(init.headers);
  headers.set("host", "geo.example");
  if (!headers.has("x-forwarded-for")) headers.set("x-forwarded-for", `203.0.113.${(address++ % 250) + 1}`);
  headers.set("x-geo-auth-secret", secret);
  if (init.user) headers.set("cookie", `${SESSION_COOKIE}=${createSession(init.user)}`);
  return new NextRequest(`https://geo.example${pathname}`, { method: init.method, body: init.body, headers });
}

function fields(values: Record<string, string> = {}) {
  return new URLSearchParams({ email: "new.user@example.com", displayName: "새 회원", password: strong, passwordConfirm: strong, plan: "free", consent: "on", ...values });
}

function post(values: Record<string, string> = {}, extra: Record<string, string> = {}, remove: string[] = []) {
  const body = fields({ ...values, ...extra });
  for (const name of remove) body.delete(name);
  return request("/api/auth/signup", { method: "POST", body: body.toString(), headers: formHeaders });
}

async function activeMember(email: string, plan = "free", displayName = "회원") {
  vi.stubEnv("GEO_SIGNUP_MODE", "auto");
  const result = await registerAccount(fields({ email, plan, displayName }));
  vi.stubEnv("GEO_SIGNUP_MODE", "approval");
  if (!result.ok) throw new Error(`seed failed: ${result.message}`);
  return result.account.loginId;
}

async function rejected(values: Record<string, string>, remove: string[] = []) {
  const response = await signup(post(values, {}, remove));
  expect(response.status).toBe(422);
  return load(await response.text());
}

function describedText($: CheerioAPI, selector: string) {
  return ($(selector).attr("aria-describedby") ?? "").split(/\s+/).filter(Boolean).map((id) => $(`[id="${id}"]`).text()).join(" ");
}

function locationPath(response: Response) {
  return new URL(response.headers.get("location") ?? "", "https://geo.example");
}

/** Microdata property owned directly by `scope` (not by a nested item). */
function own($: CheerioAPI, scope: Cheerio, prop: string) {
  return scope.find(`[itemprop~="${prop}"]`).filter((_, element) => $(element).parent().closest("[itemscope]").is(scope)).first();
}

function value(element: Cheerio) {
  return element.attr("content") ?? element.text().trim();
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

describe("security", () => {
  it("rejects common, sequential, repeated and service-derived passwords but accepts a strong one", async () => {
    for (const weak of ["password1", "12345678", "qwerty123", "1q2w3e4r", "qwer1234", "11111111", "abcdefgh", "87654321", "iloveyou1", "geomaster1"]) {
      const result = await registerAccount(fields({ password: weak, passwordConfirm: weak }));
      expect(result.ok, weak).toBe(false);
    }
    expect(findAccount("new.user@example.com")).toBeNull();
    expect((await registerAccount(fields())).ok).toBe(true);
  });

  it("rejects passwords built from the e-mail name", async () => {
    const result = await registerAccount(fields({ email: "minjun.kim@example.com", password: "Minjun.Kim-2026", passwordConfirm: "Minjun.Kim-2026" }));
    expect(result.ok).toBe(false);
    expect(findAccount("minjun.kim@example.com")).toBeNull();
  });

  it("rejects invisible or direction-changing characters in the display name", async () => {
    for (const name of ["관리자‮", "회​원", "⁦운영팀⁩", "﻿회원"]) {
      const result = await registerAccount(fields({ displayName: name }));
      expect(result.ok, JSON.stringify(name)).toBe(false);
    }
    expect(findAccount("new.user@example.com")).toBeNull();
  });

  it("silently drops honeypot sign-ups and renders the trap field for bots only", async () => {
    const $ = load(await (await signupPage(request("/signup"))).text());
    const trap = $('form[action="/api/auth/signup"] input[name="website"]');
    expect(trap.length).toBe(1);
    expect(trap.attr("tabindex")).toBe("-1");
    expect(trap.attr("autocomplete")).toBe("off");
    expect(trap.closest('[aria-hidden="true"]').length).toBe(1);
    const bot = await signup(post({}, { website: "https://spam.example" }));
    expect(bot.status).toBeLessThan(500);
    expect(findAccount("new.user@example.com")).toBeNull();
    const human = await signup(post({ email: "human@example.com" }, { website: "" }));
    expect(human.status).toBe(303);
    expect(findAccount("human@example.com")).not.toBeNull();
  });

  it("hardens the access-denied page like the public pages", async () => {
    const member = await activeMember("member@example.com");
    const response = await proxy(request("/settings", { user: member }));
    expect(response.status).toBe(403);
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("sends a referrer policy with the login page", async () => {
    const response = await loginPage(request("/login"));
    expect(response.headers.get("referrer-policy")).toMatch(/^(no-referrer|same-origin|strict-origin|strict-origin-when-cross-origin)$/);
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });
});

describe("a11y", () => {
  it("marks only the invalid field with aria-invalid", async () => {
    const $ = await rejected({ email: "not-an-email" });
    expect($("#email").attr("aria-invalid")).toBe("true");
    for (const id of ["displayName", "password", "passwordConfirm"]) expect([undefined, "false"]).toContain($(`#${id}`).attr("aria-invalid"));
  });

  it("links each invalid field to its own error message", async () => {
    const $ = await rejected({ email: "not-an-email" });
    expect(describedText($, "#email")).toContain("이메일");
  });

  it("summarizes errors with links that jump to the fields", async () => {
    const $ = await rejected({ email: "not-an-email" });
    expect($('[role="alert"] a[href="#email"]').length).toBeGreaterThan(0);
  });

  it("puts focus on the first invalid field", async () => {
    const $ = await rejected({ email: "not-an-email" });
    expect($("[autofocus]").length).toBe(1);
    expect($("#email").attr("autofocus")).toBeDefined();
  });

  it("announces the error state in the page title", async () => {
    const $ = await rejected({ email: "not-an-email" });
    expect($("title").text()).toMatch(/^오류/);
  });

  it("ties a missing consent to the consent checkbox", async () => {
    const $ = await rejected({}, ["consent"]);
    expect($('input[name="consent"]').attr("aria-invalid")).toBe("true");
    expect(describedText($, 'input[name="consent"]')).toContain("동의");
  });

  it("keeps a confirmation mismatch on the confirmation field", async () => {
    const $ = await rejected({ passwordConfirm: "different-Value-91" });
    expect($("#passwordConfirm").attr("aria-invalid")).toBe("true");
    expect([undefined, "false"]).toContain($("#password").attr("aria-invalid"));
    expect(describedText($, "#passwordConfirm")).toContain("일치");
  });
});

describe("flow", () => {
  it("sends signed-in visitors from the sign-up page to their workspace", async () => {
    const member = await activeMember("member@example.com");
    const response = await signupPage(request("/signup", { user: member }));
    expect(response.status).toBe(303);
    expect(locationPath(response).pathname).not.toBe("/signup");
  });

  it("sends signed-in visitors from the login page to the requested page", async () => {
    const response = await loginPage(request("/login?next=%2Faudit", { user: "owner@example.com" }));
    expect(response.status).toBe(303);
    expect(locationPath(response).pathname).toBe("/audit");
    const unsafe = await loginPage(request("/login?next=%2F%2Fevil.example", { user: "owner@example.com" }));
    expect(locationPath(unsafe).host).toBe("geo.example");
  });

  it("carries the requested page from login into sign-up", async () => {
    const login = load(await (await loginPage(request("/login?next=%2Faudit"))).text());
    const links = login('a[href^="/signup"]').map((_, element) => login(element).attr("href") ?? "").get();
    expect(links.some((href) => new URL(href, "https://geo.example").searchParams.get("next") === "/audit")).toBe(true);
    const form = load(await (await signupPage(request("/signup?next=%2Faudit"))).text());
    expect(form('form[action="/api/auth/signup"] input[type="hidden"][name="next"]').attr("value")).toBe("/audit");
  });

  it("returns auto-approved members to the page they asked for", async () => {
    vi.stubEnv("GEO_SIGNUP_MODE", "auto");
    const response = await signup(post({}, { next: "/audit" }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/audit");
  });

  it("never redirects a new member off-site or into APIs", async () => {
    vi.stubEnv("GEO_SIGNUP_MODE", "auto");
    const offsite = await signup(post({ email: "first@example.com" }, { next: "//evil.example/x" }));
    expect(offsite.headers.get("location")).toBe("/");
    const api = await signup(post({ email: "second@example.com" }, { next: "/api/settings" }));
    expect(api.headers.get("location")).toBe("/");
  });
});

describe("structured", () => {
  const landing = async () => load(await (await welcomePage(request("/welcome"))).text());

  it("marks the FAQ as schema.org FAQPage microdata", async () => {
    const $ = await landing();
    const faq = $('[itemscope][itemtype="https://schema.org/FAQPage"]');
    expect(faq.length).toBe(1);
    const questions = faq.find('[itemprop~="mainEntity"][itemscope][itemtype="https://schema.org/Question"]');
    expect(questions.length).toBeGreaterThanOrEqual(5);
    questions.each((_, element) => {
      const question = $(element);
      expect(value(own($, question, "name")).length).toBeGreaterThan(5);
      const answer = own($, question, "acceptedAnswer");
      expect(answer.attr("itemtype")).toBe("https://schema.org/Answer");
      expect(value(own($, answer, "text")).length).toBeGreaterThan(10);
    });
  });

  it("keeps FAQ microdata on the visible questions", async () => {
    const $ = await landing();
    const visible = $("details summary").map((_, element) => $(element).text().trim()).get();
    const marked = $('[itemtype="https://schema.org/Question"]').map((_, element) => value(own($, $(element), "name"))).get();
    expect(marked.length).toBeGreaterThan(0);
    expect(marked.every((name) => visible.includes(name))).toBe(true);
    expect($("[itemprop][hidden], [hidden] [itemprop]").length).toBe(0);
  });

  it("describes GEO Master as a SoftwareApplication", async () => {
    const $ = await landing();
    const app = $('[itemscope][itemtype="https://schema.org/SoftwareApplication"]');
    expect(app.length).toBe(1);
    expect(value(own($, app, "name"))).toBe("GEO Master");
    expect(value(own($, app, "applicationCategory")).length).toBeGreaterThan(0);
  });

  it("publishes both plans as KRW offers", async () => {
    const $ = await landing();
    const app = $('[itemscope][itemtype="https://schema.org/SoftwareApplication"]').first();
    const offers = app.find('[itemprop~="offers"][itemscope][itemtype="https://schema.org/Offer"]');
    const prices = offers.map((_, element) => {
      const offer = $(element);
      return [[value(own($, offer, "price")), value(own($, offer, "priceCurrency"))].join(" ")];
    }).get();
    expect(prices).toEqual(expect.arrayContaining(["0 KRW", "300000 KRW"]));
  });

  it("prioritises the hero artwork for loading", async () => {
    const $ = await landing();
    const hero = $("main img").first();
    expect(hero.attr("fetchpriority")).toBe("high");
    expect(hero.attr("width")).toBeTruthy();
    expect(hero.attr("height")).toBeTruthy();
  });
});

describe("admin", () => {
  type AdminRoute = { GET?: (request: NextRequest) => Promise<Response> };

  async function adminList(query = "", user = "owner@example.com") {
    const route = await import(/* @vite-ignore */ path.resolve(process.cwd(), "src/app/api/admin/accounts/route.ts")).catch(() => null) as AdminRoute | null;
    expect(typeof route?.GET).toBe("function");
    return (route as Required<AdminRoute>).GET(request(`/api/admin/accounts${query}`, { headers: { "x-geo-auth-user": user } }));
  }

  async function seedMembers() {
    await activeMember("free@example.com", "free", "무료 회원");
    await activeMember("pro@example.com", "semforge", "프로 회원");
    const pending = await registerAccount(fields({ email: "pending@example.com", displayName: "대기 회원" }));
    if (!pending.ok) throw new Error("seed failed");
  }

  const ids = (body: { accounts: { loginId: string }[] }) => body.accounts.map((account) => account.loginId).sort();

  it("lists members for administrators only", async () => {
    await seedMembers();
    const response = await adminList();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const body = await response.json();
    expect(ids(body)).toEqual(["free@example.com", "pending@example.com", "pro@example.com"]);
    expect(JSON.stringify(body)).not.toMatch(/password/i);
    expect((await adminList("", "free@example.com")).status).toBe(403);
  });

  it("filters members by status", async () => {
    await seedMembers();
    expect(ids(await (await adminList("?status=pending")).json())).toEqual(["pending@example.com"]);
  });

  it("searches members by e-mail or name", async () => {
    await seedMembers();
    expect(ids(await (await adminList("?q=PRO")).json())).toEqual(["pro@example.com"]);
    expect(ids(await (await adminList(`?q=${encodeURIComponent("대기")}`)).json())).toEqual(["pending@example.com"]);
  });

  it("rejects unknown filters", async () => {
    expect((await adminList("?status=deleted")).status).toBe(422);
  });
});
