import { NextRequest, NextResponse } from "next/server";
import { getRunDiagnostics } from "@/lib/claims";
import { errorResponse } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RunContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RunContext) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ diagnostics: getRunDiagnostics(id) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
