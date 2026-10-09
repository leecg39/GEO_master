import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import bcrypt from "bcryptjs";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accountRole, canAccessPath } from "@/lib/account-policy";
import { normalizeLoginId } from "@/lib/accounts/identity";
import { envAdmin } from "@/lib/accounts/env-admin";
import { registerAccount, signupMode } from "@/lib/accounts/signup";
import { findAccount, listAccounts, updateAccountStatus } from "@/lib/accounts/store";
import { closeDatabase, getDatabase } from "@/lib/db";
import { createSession, sessionUser, verifyCredentials, verifyPassword } from "@/lib/login-session";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "geo-accounts-"));
const dbPath = path.join(directory, "accounts.db");
const secret = "accounts-test-secret-value-with-32-plus-bytes";
const strong = "correct-horse-42";

function form(values: Record<string, string>) {
  return new URLSearchParams({
    email: "new.user@example.com",
    displayName: "새 회원",
    password: strong,
    passwordConfirm: strong,
    plan: "free",
    consent: "on",
    ...values,
  });
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
  vi.stubEnv("GEO_SIGNUP_MODE", "");
  getDatabase().sqlite.exec("DELETE FROM accounts;");
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => {
  closeDatabase(dbPath);
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("login identifiers", () => {
  it("lowercases email-shaped identifiers and preserves plain ids", () => {
    expect(normalizeLoginId("  Foo.Bar@Example.COM ")).toBe("foo.bar@example.com");
    expect(normalizeLoginId(" Geo-Admin ")).toBe("Geo-Admin");
  });
});

describe("signup service", () => {
  it.each(["", "approval", "auto"])("closes %s signup when only an administrator role is configured", async (mode) => {
    vi.stubEnv("GEO_ADMIN_ID", "");
    vi.stubEnv("GEO_ADMIN_PASSWORD", "");
    vi.stubEnv("GEO_ADMIN_USERS", "geo-admin");
    vi.stubEnv("GEO_SIGNUP_MODE", mode);
    expect(signupMode()).toBe("closed");
    expect(await registerAccount(form({}))).toMatchObject({ ok: false, status: 403 });
    expect(listAccounts()).toHaveLength(0);
  });

  it.each([
    ["", "owner-password-1"],
    ["owner@example.com", ""],
    ["owner@example.com", "short"],
    ["bad id", "owner-password-1"],
    ["owner@example.com", "$2b$00$" + "a".repeat(53)],
  ])("closes signup for incomplete or invalid administrator credentials (%s)", (id, password) => {
    vi.stubEnv("GEO_ADMIN_ID", id);
    vi.stubEnv("GEO_ADMIN_PASSWORD", password);
    expect(signupMode()).toBe("closed");
  });

  it("requires valid HTTP credentials with an admin role and honors guest precedence", async () => {
    vi.stubEnv("GEO_ADMIN_ID", "");
    vi.stubEnv("GEO_ADMIN_PASSWORD", "");
    vi.stubEnv("GEO_ADMIN_USERS", "geo-admin");
    vi.stubEnv("GEO_HTTP_AUTH", "geo-admin:not-a-bcrypt-hash");
    expect(signupMode()).toBe("closed");
    vi.stubEnv("GEO_HTTP_AUTH", `geo-admin:$2b$00$${"a".repeat(53)}`);
    expect(signupMode()).toBe("closed");
    vi.stubEnv("GEO_HTTP_AUTH", `geo-admin:${bcrypt.hashSync("admin-password", 4)}`);
    expect(signupMode()).toBe("approval");
    expect(await verifyPassword("geo-admin", "admin-password")).toBe("geo-admin");
    expect((await registerAccount(form({}))).ok).toBe(true);
    vi.stubEnv("GEO_ADMIN_USERS", "someone-else");
    expect(signupMode()).toBe("closed");
    vi.stubEnv("GEO_ADMIN_USERS", "geo-admin");
    vi.stubEnv("GEO_GUEST_USERS", "geo-admin");
    expect(signupMode()).toBe("closed");
  });

  it("does not count a guest administrator or its shadowed HTTP identity", () => {
    vi.stubEnv("GEO_GUEST_USERS", "owner@example.com");
    vi.stubEnv("GEO_HTTP_AUTH", `OWNER@example.com:${bcrypt.hashSync("admin-password", 4)}`);
    vi.stubEnv("GEO_ADMIN_USERS", "OWNER@example.com");
    expect(signupMode()).toBe("closed");
  });

  it("retains approval signup with a bcrypt environment administrator", async () => {
    vi.stubEnv("GEO_ADMIN_PASSWORD", bcrypt.hashSync("admin-password", 4));
    expect(signupMode()).toBe("approval");
    expect(await verifyPassword("owner@example.com", "admin-password")).toBe("owner@example.com");
    expect((await registerAccount(form({}))).ok).toBe(true);
  });

  it("defaults to administrator approval and rejects unknown modes safely", () => {
    expect(signupMode()).toBe("approval");
    vi.stubEnv("GEO_SIGNUP_MODE", "auto");
    expect(signupMode()).toBe("auto");
    vi.stubEnv("GEO_SIGNUP_MODE", "everyone");
    expect(signupMode()).toBe("closed");
  });

  it("creates a pending free account with a bcrypt hash and normalized email", async () => {
    const result = await registerAccount(form({ email: " New.User@Example.COM " }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.account).toMatchObject({ loginId: "new.user@example.com", displayName: "새 회원", plan: "free", status: "pending" });
    const row = getDatabase().sqlite.prepare("SELECT password_hash FROM accounts WHERE login_id = ?").get("new.user@example.com") as { password_hash: string };
    expect(row.password_hash).toMatch(/^\$2[aby]\$10\$/);
    expect(await bcrypt.compare(strong, row.password_hash)).toBe(true);
    expect(JSON.stringify(result.account)).not.toContain("password");
  });

  it("activates immediately in auto mode and remembers the SEMForge plan", async () => {
    vi.stubEnv("GEO_SIGNUP_MODE", "auto");
    const result = await registerAccount(form({ email: "paid@example.com", plan: "semforge" }));
    expect(result.ok && result.account).toMatchObject({ status: "active", plan: "semforge" });
  });

  it("refuses signups while closed", async () => {
    vi.stubEnv("GEO_SIGNUP_MODE", "closed");
    const result = await registerAccount(form({}));
    expect(result).toMatchObject({ ok: false, status: 403 });
    expect(listAccounts()).toHaveLength(0);
  });

  it.each([
    [{ email: "not-an-email" }, /이메일/],
    [{ email: "quote'name@example.com" }, /이메일/],
    [{ displayName: "   " }, /이름/],
    [{ password: "short7!", passwordConfirm: "short7!" }, /8자/],
    [{ passwordConfirm: "different-value-1" }, /일치/],
    [{ password: "new.user@example.com", passwordConfirm: "new.user@example.com" }, /이메일과 같은/],
    [{ consent: "" }, /동의/],
    [{ plan: "enterprise" }, /가입 유형/],
  ])("rejects invalid input %o without storing it", async (override, message) => {
    const result = await registerAccount(form(override));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(422);
    expect(result.message).toMatch(message);
    expect(listAccounts()).toHaveLength(0);
  });

  it("rejects passwords that bcrypt would silently truncate", async () => {
    const long = "가".repeat(25);
    const result = await registerAccount(form({ password: long, passwordConfirm: long }));
    expect(result).toMatchObject({ ok: false, status: 422 });
  });

  it("returns entered values except passwords when validation fails", async () => {
    const result = await registerAccount(form({ email: "bad", displayName: "<b>홍길동</b>", plan: "semforge" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.values).toEqual({ email: "bad", displayName: "<b>홍길동</b>", plan: "semforge", consent: true });
    expect(JSON.stringify(result)).not.toContain(strong);
  });

  it("rejects duplicate emails case-insensitively", async () => {
    expect((await registerAccount(form({}))).ok).toBe(true);
    const duplicate = await registerAccount(form({ email: "NEW.USER@example.com" }));
    expect(duplicate).toMatchObject({ ok: false, status: 409 });
    expect(listAccounts()).toHaveLength(1);
  });

  it("never lets a signup claim configured administrator, guest or env account ids", async () => {
    vi.stubEnv("GEO_ADMIN_ID", "Owner@Example.com");
    vi.stubEnv("GEO_ADMIN_PASSWORD", "owner-password-1");
    vi.stubEnv("GEO_ADMIN_USERS", "boss@example.com");
    vi.stubEnv("GEO_GUEST_USERS", "visitor@example.com");
    vi.stubEnv("GEO_HTTP_AUTH", `team@example.com:${bcrypt.hashSync("x", 4)}`);
    for (const email of ["owner@example.com", "BOSS@example.com", "visitor@example.com", "Team@Example.com"]) {
      const result = await registerAccount(form({ email }));
      expect(result).toMatchObject({ ok: false, status: 409 });
    }
    expect(listAccounts()).toHaveLength(0);
  });
});

describe("account store", () => {
  it("lists newest first and records who approved an account", async () => {
    await registerAccount(form({ email: "first@example.com" }));
    await registerAccount(form({ email: "second@example.com", plan: "semforge" }));
    const [second, first] = listAccounts();
    expect(second.loginId).toBe("second@example.com");
    const approved = updateAccountStatus(first.id, "active", "geo-admin");
    expect(approved).toMatchObject({ status: "active", approvedBy: "geo-admin" });
    expect(approved.approvedAt).toBeTruthy();
    expect(first.status).toBe("pending");
    const disabled = updateAccountStatus(String(first.id), "disabled", "geo-admin");
    expect(disabled.status).toBe("disabled");
    expect(disabled.approvedAt).toBe(approved.approvedAt);
    expect(findAccount("FIRST@example.com")?.status).toBe("disabled");
  });

  it("reports missing accounts and invalid ids as errors", () => {
    expect(() => updateAccountStatus(9999, "active", "geo-admin")).toThrow(/찾을 수 없습니다/);
    expect(() => updateAccountStatus("abc", "active", "geo-admin")).toThrow();
    expect(() => updateAccountStatus(1, "deleted" as never, "geo-admin")).toThrow();
  });
});

describe("credentials across env admin, env accounts and signups", () => {
  it("authenticates the .env administrator with a plaintext or bcrypt password", async () => {
    vi.stubEnv("GEO_ADMIN_ID", "Admin@Example.com");
    vi.stubEnv("GEO_ADMIN_PASSWORD", "plain-admin-pass");
    expect(envAdmin()?.id).toBe("admin@example.com");
    expect(await verifyPassword("admin@example.com", "plain-admin-pass")).toBe("admin@example.com");
    expect(await verifyPassword("admin@example.com", "wrong-password")).toBeNull();
    expect(accountRole("admin@example.com")).toBe("admin");
    vi.stubEnv("GEO_ADMIN_ID", "root");
    vi.stubEnv("GEO_ADMIN_PASSWORD", bcrypt.hashSync("hashed-admin-pass", 4));
    expect(await verifyPassword("root", "hashed-admin-pass")).toBe("root");
    expect(accountRole("root")).toBe("admin");
  });

  it("ignores an incomplete or weak .env administrator", async () => {
    vi.stubEnv("GEO_ADMIN_ID", "root");
    vi.stubEnv("GEO_ADMIN_PASSWORD", "short");
    expect(envAdmin()).toBeNull();
    expect(await verifyPassword("root", "short")).toBeNull();
    expect(accountRole("root")).toBe("member");
    vi.stubEnv("GEO_ADMIN_ID", "bad id");
    vi.stubEnv("GEO_ADMIN_PASSWORD", "long-enough-password");
    expect(envAdmin()).toBeNull();
  });

  it("invalidates administrator sessions when the .env password changes", () => {
    vi.stubEnv("GEO_ADMIN_ID", "root");
    vi.stubEnv("GEO_ADMIN_PASSWORD", "first-admin-password");
    const token = createSession("root");
    expect(sessionUser(token)).toBe("root");
    vi.stubEnv("GEO_ADMIN_PASSWORD", "second-admin-password");
    expect(sessionUser(token)).toBeNull();
    expect(token).not.toContain("first-admin-password");
  });

  it("lets only active signups log in and reports pending or disabled state", async () => {
    const created = await registerAccount(form({}));
    if (!created.ok) throw new Error("signup failed");
    expect(await verifyCredentials("new.user@example.com", strong)).toEqual({ status: "pending", user: "new.user@example.com" });
    expect(await verifyCredentials("new.user@example.com", "wrong-password")).toBeNull();
    expect(await verifyPassword("new.user@example.com", strong)).toBeNull();
    expect(() => createSession("new.user@example.com")).toThrow();
    updateAccountStatus(created.account.id, "active", "root");
    expect(await verifyCredentials("NEW.USER@example.com", strong)).toEqual({ status: "active", user: "new.user@example.com" });
    const token = createSession("new.user@example.com");
    expect(sessionUser(token)).toBe("new.user@example.com");
    updateAccountStatus(created.account.id, "disabled", "root");
    expect(sessionUser(token)).toBeNull();
    expect(await verifyCredentials("new.user@example.com", strong)).toEqual({ status: "disabled", user: "new.user@example.com" });
  });

  it("gives env accounts precedence over a later signup with the same id", async () => {
    vi.stubEnv("GEO_SIGNUP_MODE", "auto");
    const created = await registerAccount(form({ email: "shared@example.com" }));
    expect(created.ok).toBe(true);
    vi.stubEnv("GEO_HTTP_AUTH", `shared@example.com:${bcrypt.hashSync("team-password", 4)}`);
    expect(await verifyPassword("shared@example.com", strong)).toBeNull();
    expect(await verifyPassword("shared@example.com", "team-password")).toBe("shared@example.com");
    expect(accountRole("shared@example.com")).toBe("member");
  });
});

describe("customer role policy", () => {
  it("classifies self-registered accounts as customers in every status", async () => {
    const created = await registerAccount(form({}));
    if (!created.ok) throw new Error("signup failed");
    expect(accountRole("new.user@example.com")).toBe("customer");
    updateAccountStatus(created.account.id, "disabled", "root");
    expect(accountRole("new.user@example.com")).toBe("customer");
    expect(accountRole("unknown@example.com")).toBe("member");
  });

  it("keeps operator areas and administration away from customers", () => {
    for (const blocked of ["/settings", "/workspace", "/api/settings", "/api/workspace/backups/1/restore", "/admin/accounts", "/api/admin/accounts/1"]) {
      expect(canAccessPath("customer", blocked)).toBe(false);
    }
    for (const allowed of ["/", "/audit", "/share", "/subscription", "/semforge/subscription", "/api/semforge/subscription/checkout", "/ai-seo"]) {
      expect(canAccessPath("customer", allowed)).toBe(true);
    }
  });

  it("reserves administration for administrators", () => {
    expect(canAccessPath("admin", "/admin/accounts")).toBe(true);
    expect(canAccessPath("admin", "/api/admin/accounts/3")).toBe(true);
    for (const role of ["member", "guest", "customer"] as const) {
      expect(canAccessPath(role, "/admin/accounts")).toBe(false);
      expect(canAccessPath(role, "/%61dmin/accounts")).toBe(false);
    }
  });
});
