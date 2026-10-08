import type { NextRequest } from "next/server";
import { parsePlan, signupMode } from "@/lib/accounts/signup";
import { loginEnabled } from "@/lib/auth-mode";
import { publicHtmlResponse } from "@/lib/public-pages/document";
import { renderSignupPage } from "@/lib/public-pages/signup-page";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 회원가입 화면. `?plan=free`(무료 · GEO 측정) 또는 `?plan=semforge`(SEMForge Pro 유료)로 가입 유형을 미리 고른다. */
export function GET(request: NextRequest) {
  return publicHtmlResponse(renderSignupPage({
    auth: loginEnabled() ? "login" : "local",
    signupMode: signupMode(),
    plan: parsePlan(request.nextUrl.searchParams.get("plan")),
  }));
}
