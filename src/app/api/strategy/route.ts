import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/errors";
import { createStrategyItem, deleteStrategyItem, listStrategyItems, STRATEGY_GUIDE, updateStrategyItem } from "@/lib/strategy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try { return NextResponse.json({ items: listStrategyItems(), guide: STRATEGY_GUIDE }); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: NextRequest) {
  try { return NextResponse.json({ item: createStrategyItem(await request.json()) }, { status: 201 }); }
  catch (error) { return errorResponse(error); }
}

export async function PATCH(request: NextRequest) {
  try { return NextResponse.json({ item: updateStrategyItem(await request.json()) }); }
  catch (error) { return errorResponse(error); }
}

export async function DELETE(request: NextRequest) {
  try {
    const id = z.coerce.number().int().positive().parse(request.nextUrl.searchParams.get("id"));
    deleteStrategyItem(id);
    return new NextResponse(null, { status: 204 });
  } catch (error) { return errorResponse(error); }
}
