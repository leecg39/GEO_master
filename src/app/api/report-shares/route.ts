import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { createReportShare, listReportShares } from "@/lib/report-shares";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  try {
    return NextResponse.json({ items: listReportShares(request.nextUrl.searchParams.get("runId")) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    return NextResponse.json(createReportShare(await request.json()), { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
