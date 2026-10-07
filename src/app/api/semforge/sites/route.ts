import { withSemforgeAccount } from "@/lib/semforge-route";
import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { listSites, upsertSite } from "@/lib/semforge/position-tracking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function handleGET() {
  try {
    return NextResponse.json({ sites: listSites() });
  } catch (error) {
    return errorResponse(error);
  }
}

async function handlePOST(request: NextRequest) {
  try {
    const body = await request.json() as { domain?: unknown; name?: unknown };
    return NextResponse.json({ site: upsertSite({ domain: String(body.domain ?? ""), name: body.name ? String(body.name) : undefined }) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export const GET = withSemforgeAccount(handleGET, { requireSubscription: true });
export const POST = withSemforgeAccount(handlePOST, { requireSubscription: true });
