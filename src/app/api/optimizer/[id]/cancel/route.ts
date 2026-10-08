import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { cancelOptimizationRun } from "@/lib/optimizer-runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RunContext = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, context: RunContext) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ run: cancelOptimizationRun(id) });
  } catch (error) {
    return errorResponse(error);
  }
}
