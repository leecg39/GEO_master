import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { disconnectGsc, getGscStatus, getLatestGscSync } from "@/lib/gsc-api/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try { return NextResponse.json({ status: getGscStatus(), latest: getLatestGscSync() }, { headers: { "cache-control": "no-store" } }); }
  catch (error) { return errorResponse(error); }
}

export async function DELETE() {
  try { await disconnectGsc(); return new NextResponse(null, { status: 204 }); }
  catch (error) { return errorResponse(error); }
}
