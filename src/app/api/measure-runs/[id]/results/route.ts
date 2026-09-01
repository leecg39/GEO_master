import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { listMeasureResults } from "@/lib/measure-runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MeasureRunContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: MeasureRunContext) {
  try {
    const { id } = await context.params;
    return NextResponse.json(listMeasureResults(id, Object.fromEntries(request.nextUrl.searchParams.entries())), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
