import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { deleteMeasureRun, getMeasureRun, updateMeasureRun } from "@/lib/measure-runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MeasureRunContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: MeasureRunContext) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ run: getMeasureRun(id) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest, context: MeasureRunContext) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ run: updateMeasureRun(id, await request.json()) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest, context: MeasureRunContext) {
  try {
    const { id } = await context.params;
    deleteMeasureRun(id, await request.json());
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
