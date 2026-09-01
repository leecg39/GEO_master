import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { listMeasureRuns } from "@/lib/measure-runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  try {
    return NextResponse.json(listMeasureRuns(Object.fromEntries(request.nextUrl.searchParams.entries())), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
