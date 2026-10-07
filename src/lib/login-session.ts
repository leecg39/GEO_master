import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";

export const SESSION_COOKIE = "__Host-geo_session";
export const SESSION_SECONDS = 12 * 60 * 60;
const usernamePattern = /^[a-zA-Z0-9][a-zA-Z0-9@._+-]{0,127}$/;
const dummyHash = "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

function credentials() {
  return (process.env.GEO_HTTP_AUTH ?? "").split(",").flatMap((entry) => {
    const split = entry.indexOf(":");
    const user = entry.slice(0, split).trim();
    const hash = entry.slice(split + 1).trim();
    return usernamePattern.test(user) && /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(hash) ? [{ user, hash }] : [];
  });
}

function secret() {
  const value = process.env.GEO_AUTH_PROXY_SECRET?.trim();
  if (!value || value.length < 32) throw new Error("Invalid authentication configuration");
  return value;
}

function equal(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function isTrustedProxy(headers: Headers) {
  return equal(headers.get("x-geo-auth-secret") ?? "", secret());
}

export async function verifyPassword(user: string, password: string): Promise<string | null> {
  if (!usernamePattern.test(user) || !password || bcrypt.truncates(password)) return null;
  const entry = credentials().find((candidate) => candidate.user === user);
  const matched = await bcrypt.compare(password, entry?.hash ?? dummyHash);
  return entry && matched ? user : null;
}

function credentialVersion(user: string) {
  const entry = credentials().find((candidate) => candidate.user === user);
  return entry ? createHash("sha256").update(entry.hash).digest("base64url") : null;
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
