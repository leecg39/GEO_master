import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { syncGscPerformance } from "@/lib/gsc-api/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try { return NextResponse.json({ sync: await syncGscPerformance(await request.json()) }, { status: 201 }); }
  catch (error) { return errorResponse(error); }
}
