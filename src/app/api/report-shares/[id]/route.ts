import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { revokeReportShare } from "@/lib/report-shares";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ShareContext = { params: Promise<{ id: string }> };

export async function DELETE(_request: NextRequest, context: ShareContext) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ share: revokeReportShare(id) });
  } catch (error) {
    return errorResponse(error);
  }
}
