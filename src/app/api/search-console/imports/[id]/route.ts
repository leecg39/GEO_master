import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { deleteConsoleImport, getConsoleImport } from "@/lib/search-console/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: Context) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ import: getConsoleImport(id) }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(_request: NextRequest, context: Context) {
  try {
    const { id } = await context.params;
    deleteConsoleImport(id);
    return new NextResponse(null, { status: 204 });
  } catch (error) { return errorResponse(error); }
}
