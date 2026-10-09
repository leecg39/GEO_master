import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as signup } from "@/app/api/auth/signup/route";
import { SIGNUP_RATE_LIMITS } from "@/lib/accounts/signup";
import { createAttemptLimiter } from "@/lib/auth-form";
import { closeDatabase } from "@/lib/db";

// 가입 라우트의 시도 제한은 모듈 상태라 다른 가입 테스트와 섞이지 않도록 이 파일에서만 검증한다.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "geo-signup-limit-"));
const dbPath = path.join(directory, "limit.db");
const secret = "signup-limit-secret-value-with-32-plus-bytes";

function attempt(forwardedFor: string) {
  return signup(new NextRequest("https://geo.example/api/auth/signup", {
    method: "POST",
    body: new URLSearchParams({ email: "bad", displayName: "x", password: "p", passwordConfirm: "p", plan: "free", consent: "on" }).toString(),
    headers: { host: "geo.example", origin: "https://geo.example", "content-type": "application/x-www-form-urlencoded", "x-geo-auth-secret": secret, "x-forwarded-for": forwardedFor },
  }));
}

beforeEach(() => {
  vi.stubEnv("GEO_DB_PATH", dbPath);
  vi.stubEnv("GEO_AUTH_MODE", "app");
  vi.stubEnv("GEO_AUTH_PROXY_SECRET", secret);
  vi.stubEnv("GEO_SIGNUP_MODE", "approval");
  vi.stubEnv("GEO_ADMIN_ID", "owner@example.com");
  vi.stubEnv("GEO_ADMIN_PASSWORD", "owner-password-1");
  vi.stubEnv("GEO_GUEST_USERS", "guest");
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => {
  closeDatabase(dbPath);
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("attempt limiter", () => {
  it("caps attempts per key within the window and forgets them afterwards", () => {
    const limiter = createAttemptLimiter({ limit: 2, windowMs: 1000 });
    expect([limiter.allow("a", 0), limiter.allow("a", 10), limiter.allow("a", 20)]).toEqual([true, true, false]);
    expect(limiter.allow("b", 20)).toBe(true);
    expect(limiter.allow("a", 1001)).toBe(true);
  });

  it("refuses new keys once the key table is full", () => {
    const limiter = createAttemptLimiter({ limit: 5, windowMs: 1000, maxKeys: 2 });
    expect([limiter.allow("a", 0), limiter.allow("b", 0), limiter.allow("c", 0)]).toEqual([true, true, false]);
    expect(limiter.allow("a", 1)).toBe(true);
  });
});

describe("sign-up rate limits", () => {
  it("caps sign-ups globally even when every request claims a new address", async () => {
    const statuses: number[] = [];
    for (let index = 0; index <= SIGNUP_RATE_LIMITS.global; index += 1) {
      const response = await attempt(`192.0.2.${index % 250}, 10.0.${Math.floor(index / 250)}.${index % 250}`);
      statuses.push(response.status);
    }
    expect(statuses.slice(0, SIGNUP_RATE_LIMITS.global).every((status) => status === 422)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
    expect(await (await attempt("198.51.100.77")).text()).toContain("가입 시도가 너무 많습니다");
  });
});
