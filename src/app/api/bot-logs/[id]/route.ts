import { NextRequest, NextResponse } from "next/server";
import { deleteBotLogImport, getBotLogImport } from "@/lib/bot-logs/store";
import { errorResponse } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: Context) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ import: getBotLogImport(id) }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(_request: NextRequest, context: Context) {
  try {
    const { id } = await context.params;
    deleteBotLogImport(id);
    return new NextResponse(null, { status: 204 });
  } catch (error) { return errorResponse(error); }
}
