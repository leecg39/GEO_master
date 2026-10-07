import { NextRequest, NextResponse } from "next/server";
import { accountRole, canAccessPath } from "@/lib/account-policy";
import { basicUser, isTrustedProxy, sameOriginMutation, SESSION_COOKIE, sessionUser } from "@/lib/login-session";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const PUBLIC_PATHS = new Set(["/login", "/link-preview.html", "/og/geo-master-20261007.jpg", "/og/geo-master-thumbnail-20261007.jpg", "/api/health"]);

function privateResponse(response: NextResponse) {
  response.headers.set("cache-control", "private, no-store");
  return response;
}

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const authForm = path === "/api/auth/login" || path === "/api/auth/logout";
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
  if (PUBLIC_PATHS.has(path) && ["GET", "HEAD"].includes(request.method)) return privateResponse(NextResponse.next());
  try {
    if (mode !== "proxy") throw new Error("Invalid authentication mode");
    if (!isTrustedProxy(request.headers)) return privateResponse(NextResponse.json({ error: "로그인이 필요합니다.", code: "AUTH_REQUIRED" }, { status: 401 }));
    if (authForm && request.method === "POST") return privateResponse(NextResponse.next());
    const user = sessionUser(request.cookies.get(SESSION_COOKIE)?.value) ?? await basicUser(request.headers.get("authorization"));
    if (!user) {
      if (path.startsWith("/api/") || !["GET", "HEAD"].includes(request.method)) {
        return privateResponse(NextResponse.json({ error: "로그인이 필요합니다.", code: "AUTH_REQUIRED", loginUrl: "/login" }, { status: 401 }));
      }
      const login = new URL("/login", request.url);
      login.searchParams.set("next", path + request.nextUrl.search);
      return privateResponse(NextResponse.redirect(login, 303));
    }
    if (!canAccessPath(accountRole(user), path)) {
      if (path.startsWith("/api/")) return privateResponse(NextResponse.json({ error: "게스트 계정은 이 기능에 접근할 수 없습니다.", code: "FORBIDDEN" }, { status: 403 }));
      return privateResponse(new NextResponse('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>접근 권한 안내 · GEO Master</title><main style="font-family:system-ui;max-width:480px;margin:15vh auto;padding:24px"><h1>접근 권한이 없습니다</h1><p>게스트 계정은 이 메뉴를 이용할 수 없습니다.</p><a href="/">대시보드로 돌아가기</a></main></html>', { status: 403, headers: { "content-type": "text/html; charset=utf-8" } }));
    }
    const headers = new Headers(request.headers);
    headers.set("x-geo-auth-user", user);
    headers.delete("authorization");
    return privateResponse(NextResponse.next({ request: { headers } }));
  } catch {
    return privateResponse(NextResponse.json({ error: "로그인 설정을 확인해 주세요.", code: "AUTH_CONFIGURATION_INVALID" }, { status: 503 }));
  }
}

export const config = { matcher: "/:path*" };
