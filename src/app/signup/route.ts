import { NextResponse, type NextRequest } from "next/server";
import { accountRole, canAccessPath } from "@/lib/account-policy";
import { parsePlan, signupMode } from "@/lib/accounts/signup";
import { loginEnabled } from "@/lib/auth-mode";
import { safeReturnPath, SESSION_COOKIE, sessionUser } from "@/lib/login-session";
import { publicHtmlResponse } from "@/lib/public-pages/document";
import { renderSignupPage } from "@/lib/public-pages/signup-page";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 이미 로그인한 방문자가 갈 곳. 권한이 없는 경로는 대시보드로 바꾼다. 세션을 확인할 수 없으면 null. */
function signedInDestination(request: NextRequest, next: string): string | null {
  if (!loginEnabled()) return null;
  try {
    const user = sessionUser(request.cookies.get(SESSION_COOKIE)?.value);
    if (!user) return null;
    return canAccessPath(accountRole(user), new URL(next, "https://geo.invalid").pathname) ? next : "/";
  } catch {
    return null;
  }
}

/**
 * 회원가입 화면. `?plan=free`(무료 · GEO 측정) 또는 `?plan=semforge`(SEMForge Pro 유료)로 가입 유형을 미리 고르고,
 * `?next=`로 가입 뒤 돌아갈 화면을 전달한다. 이미 로그인했다면 가입 화면 대신 그 화면으로 보낸다.
 */
export function GET(request: NextRequest) {
  const next = safeReturnPath(request.nextUrl.searchParams.get("next"));
  const destination = signedInDestination(request, next);
  if (destination) return new NextResponse(null, { status: 303, headers: { location: destination, "cache-control": "private, no-store" } });
  return publicHtmlResponse(renderSignupPage({
    auth: loginEnabled() ? "login" : "local",
    signupMode: signupMode(),
    plan: parsePlan(request.nextUrl.searchParams.get("plan")),
    next,
  }));
}
