import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { deleteOutcomeImport } from "@/lib/outcomes/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    deleteOutcomeImport(id);
    return new NextResponse(null, { status: 204 });
  } catch (error) { return errorResponse(error); }
}
