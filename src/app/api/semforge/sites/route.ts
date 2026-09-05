import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { listSites, upsertSite } from "@/lib/semforge/position-tracking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try {
    return NextResponse.json({ sites: listSites() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { domain?: unknown; name?: unknown };
    return NextResponse.json({ site: upsertSite({ domain: String(body.domain ?? ""), name: body.name ? String(body.name) : undefined }) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
