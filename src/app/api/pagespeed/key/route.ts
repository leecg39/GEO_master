import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { deletePageSpeedKey, pageSpeedKeyStatus, savePageSpeedKey } from "@/lib/pagespeed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

export function GET() {
  try { return NextResponse.json(pageSpeedKeyStatus(), { headers: NO_STORE }); } catch (error) { return errorResponse(error); }
}
export async function PUT(request: NextRequest) {
  try { return NextResponse.json(savePageSpeedKey(await request.json()), { headers: NO_STORE }); } catch (error) { return errorResponse(error); }
}
export function DELETE() {
  try { return NextResponse.json(deletePageSpeedKey(), { headers: NO_STORE }); } catch (error) { return errorResponse(error); }
}
