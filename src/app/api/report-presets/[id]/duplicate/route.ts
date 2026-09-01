import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { duplicateReportPreset } from "@/lib/report-presets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, context: Context) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ preset: duplicateReportPreset(id) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
