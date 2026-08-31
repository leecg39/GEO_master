import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { runMultimodalAudit } from "@/lib/multimodal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try { return NextResponse.json({ audit: await runMultimodalAudit(await request.json()) }, { status: 201 }); }
  catch (error) { return errorResponse(error); }
}
