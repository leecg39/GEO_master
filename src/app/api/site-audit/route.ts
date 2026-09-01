import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/errors";
import { createSiteAuditCampaign, getSiteAuditOverview, listSiteAuditCampaigns } from "@/lib/semforge/siteaudit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("id");
    if (id) return NextResponse.json({ overview: getSiteAuditOverview(id) });
    return NextResponse.json({ campaigns: listSiteAuditCampaigns() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    return NextResponse.json({ campaign: createSiteAuditCampaign(await request.json()) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const id = z.coerce.number().int().positive().parse(request.nextUrl.searchParams.get("id"));
    const { runSiteAuditCampaign } = await import("@/lib/semforge/siteaudit");
    return NextResponse.json({ result: await runSiteAuditCampaign(id) });
  } catch (error) {
    return errorResponse(error);
  }
}
