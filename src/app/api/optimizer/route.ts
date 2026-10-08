import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { listOptimizationRuns, startOptimizationRun, suggestedCompetitorPages } from "@/lib/optimizer-runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try {
    return NextResponse.json({ items: listOptimizationRuns(), suggestions: suggestedCompetitorPages() }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    return NextResponse.json({ run: startOptimizationRun(await request.json()) }, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
