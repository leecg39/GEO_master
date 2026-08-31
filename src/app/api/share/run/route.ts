import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { runShareMeasurement } from "@/lib/share";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const run = await runShareMeasurement(await request.json());
    return NextResponse.json({ run }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
