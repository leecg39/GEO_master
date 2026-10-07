import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { deleteOptimizationRun, getOptimizationRun } from "@/lib/optimizer-runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RunContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RunContext) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ run: getOptimizationRun(id) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: NextRequest, context: RunContext) {
  try {
    const { id } = await context.params;
    deleteOptimizationRun(id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
