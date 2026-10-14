import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { lookupWordpressPage } from "@/lib/wordpress-connections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try { return NextResponse.json({ result: await lookupWordpressPage(request.nextUrl.searchParams.get("url")) }, { headers: { "cache-control": "no-store" } }); }
  catch (error) { return errorResponse(error); }
}
