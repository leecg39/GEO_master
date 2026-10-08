import { NextRequest, NextResponse } from "next/server";
import { accountRole, canAccessPath, type AccountRole } from "@/lib/account-policy";
import { authSecret, basicUser, isTrustedProxy, sameOriginMutation, SESSION_COOKIE, sessionUser } from "@/lib/login-session";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const PUBLIC_PATHS = new Set(["/login", "/signup", "/welcome", "/link-preview.html", "/og/geo-master-20261007.jpg", "/og/geo-master-thumbnail-20261007.jpg", "/api/health"]);
/** HTML 폼으로 받는 인증 요청. JSON 대신 form-urlencoded를 쓰고 로그인 전에도 도달해야 한다. */
const AUTH_FORM_PATHS = new Set(["/api/auth/login", "/api/auth/logout", "/api/auth/signup"]);
/** 비로그인 사용자의 첫 화면(서비스 소개) */
const LANDING_PATH = "/welcome";
/** 만료형 공개 리포트 링크 — 32바이트 base64url 토큰 형식만 비로그인 GET 허용 */
const PUBLIC_REPORT_PATH = /^\/r\/[A-Za-z0-9_-]{43}$/;
const IDENTITY_HEADERS = ["x-geo-auth-user", "x-geo-auth-secret"];

function privateResponse(response: NextResponse) {
  response.headers.set("cache-control", "private, no-store");
  return response;
}

function withoutIdentity(source: Headers) {
  const headers = new Headers(source);
  for (const name of IDENTITY_HEADERS) headers.delete(name);
  return headers;
}

/** app 모드에서는 이 프록시가 신뢰 경계다. 클라이언트가 보낸 신원 헤더를 버리고 서버 비밀을 직접 넣는다. */
function trustedHeaders(request: NextRequest, mode: "app" | "proxy") {
  if (mode === "proxy") return new Headers(request.headers);
  const headers = withoutIdentity(request.headers);
  headers.set("x-geo-auth-secret", authSecret());
  return headers;
}

function forbidden(role: AccountRole, path: string) {
  const message = role === "guest" ? "게스트 계정은 이 기능에 접근할 수 없습니다." : "이 계정 권한으로는 이 기능에 접근할 수 없습니다.";
  if (path.startsWith("/api/")) return privateResponse(NextResponse.json({ error: message, code: "FORBIDDEN" }, { status: 403 }));
  const detail = role === "guest" ? "게스트 계정은 이 메뉴를 이용할 수 없습니다." : "이 메뉴는 관리자 또는 운영 계정만 이용할 수 있습니다.";
  return privateResponse(new NextResponse(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>접근 권한 안내 · GEO Master</title><main style="font-family:system-ui;max-width:480px;margin:15vh auto;padding:24px"><h1>접근 권한이 없습니다</h1><p>${detail}</p><a href="/">대시보드로 돌아가기</a></main></html>`, { status: 403, headers: { "content-type": "text/html; charset=utf-8" } }));
}

function anonymous(request: NextRequest, path: string, headers: Headers) {
  const readOnly = ["GET", "HEAD"].includes(request.method);
  // 비로그인 첫 화면은 서비스 소개다. Traefik 공개 라우터와 같은 조건으로, 자격 증명을 내지 않은 방문자만 해당한다.
  // 만료된 세션·틀린 Basic 인증이나 명시적인 /?login=1은 로그인 화면으로 보낸다. 주소는 /로 유지한다.
  const visitor = !request.headers.has("authorization") && !request.cookies.has(SESSION_COOKIE) && request.nextUrl.searchParams.get("login") !== "1";
  if (path === "/" && readOnly && visitor) {
    return privateResponse(NextResponse.rewrite(new URL(LANDING_PATH, request.url), { request: { headers: withoutIdentity(headers) } }));
  }
  if (path.startsWith("/api/") || !readOnly) {
    return privateResponse(NextResponse.json({ error: "로그인이 필요합니다.", code: "AUTH_REQUIRED", loginUrl: "/login" }, { status: 401 }));
  }
  const login = new URL("/login", request.url);
  login.searchParams.set("next", path + request.nextUrl.search);
  return privateResponse(NextResponse.redirect(login, 303));
}

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const authForm = AUTH_FORM_PATHS.has(path);
  if (MUTATING_METHODS.has(request.method) && path.startsWith("/api/")) {
    if (!sameOriginMutation(request)) {
      return NextResponse.json({ error: "교차 출처 요청은 허용되지 않습니다.", code: "CROSS_SITE_BLOCKED" }, { status: 403 });
    }
    if (!authForm && request.method !== "DELETE" && !request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      return NextResponse.json({ error: "application/json 요청만 허용됩니다.", code: "JSON_REQUIRED" }, { status: 415 });
    }
  }
  const mode = process.env.GEO_AUTH_MODE?.trim() || "local";
  if (mode === "local") return NextResponse.next();
  if ((PUBLIC_PATHS.has(path) || PUBLIC_REPORT_PATH.test(path)) && ["GET", "HEAD"].includes(request.method)) {
    return privateResponse(mode === "app" ? NextResponse.next({ request: { headers: withoutIdentity(request.headers) } }) : NextResponse.next());
  }
  try {
    if (mode !== "proxy" && mode !== "app") throw new Error("Invalid authentication mode");
    if (mode === "proxy" && !isTrustedProxy(request.headers)) return privateResponse(NextResponse.json({ error: "로그인이 필요합니다.", code: "AUTH_REQUIRED" }, { status: 401 }));
    const headers = trustedHeaders(request, mode);
    if (authForm && request.method === "POST") return privateResponse(mode === "app" ? NextResponse.next({ request: { headers } }) : NextResponse.next());
    const user = sessionUser(request.cookies.get(SESSION_COOKIE)?.value) ?? await basicUser(request.headers.get("authorization"));
    if (!user) return anonymous(request, path, headers);
    const role = accountRole(user);
    if (!canAccessPath(role, path)) return forbidden(role, path);
    headers.set("x-geo-auth-user", user);
    headers.delete("authorization");
    return privateResponse(NextResponse.next({ request: { headers } }));
  } catch {
    return privateResponse(NextResponse.json({ error: "로그인 설정을 확인해 주세요.", code: "AUTH_CONFIGURATION_INVALID" }, { status: 503 }));
  }
}

export const config = { matcher: "/:path*" };
