import { NextRequest, NextResponse } from "next/server";
import { accountRole } from "@/lib/account-policy";
import { accountHomePath } from "@/lib/accounts/home";
import { registerAccount, SIGNUP_RATE_LIMITS, signupMode, type SignupValues } from "@/lib/accounts/signup";
import { clientAddress, createAttemptLimiter, isFormRequest, readLimitedForm } from "@/lib/auth-form";
import { loginEnabled } from "@/lib/auth-mode";
import { createSession, isTrustedProxy, sameOriginMutation, SESSION_COOKIE, SESSION_SECONDS } from "@/lib/login-session";
import { publicHtmlResponse } from "@/lib/public-pages/document";
import { renderSignupPage } from "@/lib/public-pages/signup-page";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 같은 주소에서 10분에 10번, 전체 10분에 100번까지. 계정 대량 생성과 이메일 탐색을 늦춘다. */
const perAddress = createAttemptLimiter({ limit: SIGNUP_RATE_LIMITS.perAddress, windowMs: SIGNUP_RATE_LIMITS.windowMs });
const overall = createAttemptLimiter({ limit: SIGNUP_RATE_LIMITS.global, windowMs: SIGNUP_RATE_LIMITS.windowMs, maxKeys: 1 });

function redirect(path: string) {
  return new NextResponse(null, { status: 303, headers: { location: path, "cache-control": "private, no-store" } });
}

function signupPage(status: number, errors: string[], values?: SignupValues) {
  return publicHtmlResponse(renderSignupPage({ auth: "login", signupMode: signupMode(), plan: values?.plan ?? "free", values, errors }), status);
}

export async function POST(request: NextRequest) {
  if (!loginEnabled()) return publicHtmlResponse(renderSignupPage({ auth: "local", signupMode: signupMode(), plan: "free" }), 503);
  try {
    if (!isTrustedProxy(request.headers) || !sameOriginMutation(request)) return NextResponse.json({ error: "허용되지 않은 요청입니다." }, { status: 403 });
    if (!isFormRequest(request)) return new NextResponse(null, { status: 415 });
    if (!perAddress.allow(clientAddress(request)) || !overall.allow("all")) return signupPage(429, ["가입 시도가 너무 많습니다. 10분 후 다시 시도해 주세요."]);
    const fields = await readLimitedForm(request);
    if (!fields) return new NextResponse(null, { status: 413 });
    const result = await registerAccount(fields);
    if (!result.ok) return signupPage(result.status, result.messages, result.values);
    // 승인제에서는 로그인시키지 않고 승인 대기 안내로 보낸다.
    if (result.mode !== "auto") return redirect("/login?notice=pending");
    const user = result.account.loginId;
    const response = redirect(accountHomePath(user, accountRole(user)));
    response.cookies.set(SESSION_COOKIE, createSession(user), { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: SESSION_SECONDS });
    return response;
  } catch (error) {
    console.error("Signup failed", error instanceof Error ? error.name : "Unknown error");
    return NextResponse.json({ error: "회원가입 설정을 확인해 주세요." }, { status: 503 });
  }
}
