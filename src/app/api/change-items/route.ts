import { NextRequest, NextResponse } from "next/server";
import { createChangeItem, listChangeItems } from "@/lib/change-items";
import { errorResponse } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try { return NextResponse.json({ items: listChangeItems() }, { headers: { "cache-control": "no-store" } }); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: NextRequest) {
  try { return NextResponse.json({ item: createChangeItem(await request.json()) }, { status: 201 }); }
  catch (error) { return errorResponse(error); }
}
