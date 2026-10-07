import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { getReviewQuality, getReviewQueue } from "@/lib/review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const query = { ...(params.get("mode") ? { mode: params.get("mode") } : {}), ...(params.get("runId") ? { runId: params.get("runId") } : {}) };
    return NextResponse.json({ queue: getReviewQueue(query), quality: getReviewQuality() }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
