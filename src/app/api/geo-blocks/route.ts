import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { getGeoBlocksOverviewPublic, runGeoBlocksAction } from "@/lib/semforge/geo-blocks";
import { getSemforgeSubscription } from "@/lib/semforge-subscription";
import { requireActiveProject } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try {
    requireActiveProject();
    return NextResponse.json({
      subscription: getSemforgeSubscription(),
      overview: getGeoBlocksOverviewPublic(),
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    requireActiveProject();
    const body = await request.json();
    const result = await runGeoBlocksAction(body);
    return NextResponse.json(result, { status: body?.action === "generate" || String(body?.action ?? "").startsWith("suggest") ? 201 : 200 });
  } catch (error) {
    return errorResponse(error);
  }
}
