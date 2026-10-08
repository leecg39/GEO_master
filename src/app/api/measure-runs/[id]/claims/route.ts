import { NextRequest, NextResponse } from "next/server";
import { runClaimCheck } from "@/lib/claims";
import { errorResponse } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type RunContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RunContext) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ check: await runClaimCheck(id, await request.json()) });
  } catch (error) {
    return errorResponse(error);
  }
}
