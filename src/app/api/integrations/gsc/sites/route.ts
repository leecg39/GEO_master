import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { listGscSites } from "@/lib/gsc-api/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try { return NextResponse.json(await listGscSites(), { headers: { "cache-control": "no-store" } }); }
  catch (error) { return errorResponse(error); }
}
