import type { NextRequest } from "next/server";
import { signupMode } from "@/lib/accounts/signup";
import { loginEnabled } from "@/lib/auth-mode";
import { SESSION_COOKIE, sessionUser } from "@/lib/login-session";
import { publicHtmlResponse } from "@/lib/public-pages/document";
import { renderLandingPage } from "@/lib/public-pages/landing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 세션 확인은 버튼 문구 선택에만 쓴다. 설정 오류가 있어도 소개 화면은 열려야 한다. */
function signedIn(request: NextRequest): boolean {
  try {
    return Boolean(sessionUser(request.cookies.get(SESSION_COOKIE)?.value));
  } catch {
    return false;
  }
}

/** 서비스 소개 — 비로그인 사용자의 첫 화면. 프록시가 비로그인 `/` 요청을 이 경로로 다시 씁니다. */
export function GET(request: NextRequest) {
  const auth = loginEnabled() ? "login" : "local";
  return publicHtmlResponse(renderLandingPage({
    auth,
    signedIn: auth === "login" && signedIn(request),
    signupMode: signupMode(),
  }));
}
