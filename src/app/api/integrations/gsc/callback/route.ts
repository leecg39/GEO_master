import { NextRequest, NextResponse } from "next/server";
import { AppError } from "@/lib/errors";
import { completeGscOAuth } from "@/lib/gsc-api/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const back = (request: NextRequest, query: string) => NextResponse.redirect(new URL(`/search-console?${query}`, request.url), 302);

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const denied = params.get("error");
  // Google이 돌려준 오류 코드는 정해진 문자만 남겨 화면 주소에 싣는다
  if (denied) return back(request, `gsc=error&reason=${encodeURIComponent(denied.replace(/[^a-z_]/gi, "").slice(0, 40) || "denied")}`);
  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) return back(request, "gsc=error&reason=GSC_CALLBACK_INVALID");
  try {
    await completeGscOAuth({ code, state });
    return back(request, "gsc=connected");
  } catch (error) {
    return back(request, `gsc=error&reason=${encodeURIComponent(error instanceof AppError ? error.code : "GSC_CALLBACK_FAILED")}`);
  }
}
