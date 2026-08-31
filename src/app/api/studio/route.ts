import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { runStudioTool } from "@/lib/studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    return NextResponse.json({ result: await runStudioTool(await request.json()) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
