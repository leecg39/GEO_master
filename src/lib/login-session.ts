import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { BCRYPT_HASH_PATTERN, envAdmin } from "@/lib/accounts/env-admin";
import { isEmailLike, normalizeLoginId, USERNAME_PATTERN } from "@/lib/accounts/identity";
import { findAccountCredential, type AccountStatus } from "@/lib/accounts/store";
import { authMode } from "./auth-mode";
import { deriveServerSecret } from "./crypto";
import { getDatabasePath } from "./db";

export const SESSION_COOKIE = "__Host-geo_session";
export const SESSION_SECONDS = 12 * 60 * 60;
const usernamePattern = USERNAME_PATTERN;
const dummyHash = "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

export interface CredentialCheck {
  status: AccountStatus;
  user: string;
}

interface Credential {
  user: string;
  hash: string | null;
  /** .env 관리자 평문 비밀번호. 다른 계정은 항상 bcrypt 해시만 가진다. */
  plain: string | null;
  status: AccountStatus;
  version: string;
}

function credentials() {
  return (process.env.GEO_HTTP_AUTH ?? "").split(",").flatMap((entry) => {
    const split = entry.indexOf(":");
    const user = entry.slice(0, split).trim();
    const hash = entry.slice(split + 1).trim();
    return usernamePattern.test(user) && BCRYPT_HASH_PATTERN.test(hash) ? [{ user, hash }] : [];
  });
}

/** GEO_HTTP_AUTH에 등록된 운영 계정 아이디 */
export function configuredAccountIds(): string[] {
  return credentials().map((entry) => entry.user);
}

let derivedSecret: { key: string; value: string } | null = null;

function secret() {
  const value = process.env.GEO_AUTH_PROXY_SECRET?.trim();
  if (value && value.length >= 32) return value;
  // app 모드는 앞단 프록시가 없으므로 비워 두면 마스터 키에서 세션 서명 비밀을 파생한다.
  if (!value && authMode() === "app") {
    // 마스터 키 파일을 요청마다 읽지 않도록 키 출처가 같으면 파생값을 재사용한다.
    const key = `${process.env.GEO_MASTER_KEY ?? ""}\u0000${getDatabasePath()}`;
    const cached = derivedSecret?.key === key ? derivedSecret : { key, value: deriveServerSecret("geo-auth-session-v1") };
    derivedSecret = cached;
    return cached.value;
  }
  throw new Error("Invalid authentication configuration");
}

/** 세션 서명과 내부 신뢰 헤더에 쓰는 서버 비밀. 구성이 잘못되면 예외를 던진다. */
export function authSecret(): string {
  return secret();
}

function equal(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function digestEqual(a: string, b: string) {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

export function isTrustedProxy(headers: Headers) {
  return equal(headers.get("x-geo-auth-secret") ?? "", secret());
}

function hashVersion(hash: string) {
  return createHash("sha256").update(hash).digest("base64url");
}

/** env 계정이 이메일 아이디를 대소문자만 바꿔 가로채지 못하도록 같은 아이디의 가입 계정을 가린다. */
function shadowedByEnvAccount(normalized: string) {
  return credentials().some((entry) => normalizeLoginId(entry.user) === normalized);
}

function findCredential(input: string): Credential | null {
  const normalized = normalizeLoginId(input);
  const admin = envAdmin();
  if (admin && admin.id === normalized) {
    return admin.kind === "bcrypt"
      ? { user: admin.id, hash: admin.password, plain: null, status: "active", version: hashVersion(admin.password) }
      // 평문 원문 대신 서버 비밀로 만든 HMAC을 세션 버전으로 쓴다. 비밀번호를 바꾸면 기존 세션이 무효가 된다.
      : { user: admin.id, hash: null, plain: admin.password, status: "active", version: createHmac("sha256", secret()).update(`geo-admin-password-v1:${admin.password}`).digest("base64url") };
  }
  const entry = credentials().find((candidate) => candidate.user === input);
  if (entry) return { user: entry.user, hash: entry.hash, plain: null, status: "active", version: hashVersion(entry.hash) };
  if (!isEmailLike(normalized) || !usernamePattern.test(normalized) || shadowedByEnvAccount(normalized)) return null;
  const account = findAccountCredential(normalized);
  return account
    ? { user: account.loginId, hash: account.passwordHash, plain: null, status: account.status, version: hashVersion(account.passwordHash) }
    : null;
}

/** 회원가입으로 만든 계정인지. .env 관리자·GEO_HTTP_AUTH 계정이 같은 아이디를 쓰면 그쪽이 우선한다. */
export function isSelfRegisteredAccount(user: string): boolean {
  const normalized = normalizeLoginId(user);
  if (!isEmailLike(normalized) || !usernamePattern.test(normalized) || envAdmin()?.id === normalized || shadowedByEnvAccount(normalized)) return false;
  return findAccountCredential(normalized) !== null;
}

async function passwordMatches(credential: Credential | null, password: string) {
  if (credential?.plain != null) {
    // 평문 비교도 bcrypt 한 번과 같은 시간이 걸리도록 맞춘다.
    await bcrypt.compare(password, dummyHash);
    return digestEqual(password, credential.plain);
  }
  return bcrypt.compare(password, credential?.hash ?? dummyHash);
}

/** 비밀번호가 맞으면 계정 상태와 정식 아이디를 돌려준다. 승인 대기·중지 계정도 비밀번호가 맞을 때만 상태를 알린다. */
export async function verifyCredentials(user: string, password: string): Promise<CredentialCheck | null> {
  const input = user.trim();
  if (!usernamePattern.test(input) || !password || bcrypt.truncates(password)) return null;
  const credential = findCredential(input);
  const matched = await passwordMatches(credential, password);
  return credential && matched ? { status: credential.status, user: credential.user } : null;
}

export async function verifyPassword(user: string, password: string): Promise<string | null> {
  const result = await verifyCredentials(user, password);
  return result?.status === "active" ? result.user : null;
}

function credentialVersion(user: string) {
  const credential = findCredential(user);
  return credential?.status === "active" ? credential.version : null;
}

function sign(payload: string) {
  return createHmac("sha256", secret()).update(`geo-session-v1:${payload}`).digest("base64url");
}

export function createSession(user: string, now = Date.now()) {
  const version = credentialVersion(user);
  if (!version) throw new Error("Unknown account");
  const payload = Buffer.from(JSON.stringify({ user, version, expires: now + SESSION_SECONDS * 1000 })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function sessionUser(token: string | undefined, now = Date.now()): string | null {
  if (!token || token.length > 1024) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra || !equal(sign(payload), signature)) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof value.user !== "string" || !usernamePattern.test(value.user)
      || typeof value.expires !== "number" || value.expires <= now || value.expires > now + SESSION_SECONDS * 1000
      || value.version !== credentialVersion(value.user)) return null;
    return value.user;
  } catch { return null; }
}

export async function basicUser(authorization: string | null) {
  if (!authorization || authorization.length > 1024 || !authorization.startsWith("Basic ")) return null;
  const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
  const split = decoded.indexOf(":");
  if (split < 1) return null;
  return verifyPassword(decoded.slice(0, split), decoded.slice(split + 1));
}

export function safeReturnPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\x00-\x1f\x7f]/.test(value)) return "/";
  try {
    const parsed = new URL(value, "https://geo.invalid");
    if (parsed.origin !== "https://geo.invalid" || parsed.pathname.startsWith("/login") || parsed.pathname.startsWith("/api/")) return "/";
    return parsed.pathname + parsed.search;
  } catch { return "/"; }
}

export function sameOriginMutation(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try { return new URL(origin).host === (request.headers.get("host") ?? new URL(request.url).host); }
  catch { return false; }
}
