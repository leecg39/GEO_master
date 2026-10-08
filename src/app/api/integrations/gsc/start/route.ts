import { NextRequest, NextResponse } from "next/server";
import { AppError } from "@/lib/errors";
import { startGscOAuth } from "@/lib/gsc-api/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 브라우저 이동으로 여는 경로라 오류도 JSON이 아니라 화면으로 돌려보낸다 */
export function GET(request: NextRequest) {
  try {
    return NextResponse.redirect(startGscOAuth(), 302);
  } catch (error) {
    const reason = error instanceof AppError ? error.code : "GSC_START_FAILED";
    return NextResponse.redirect(new URL(`/search-console?gsc=error&reason=${encodeURIComponent(reason)}`, request.url), 302);
  }
}
