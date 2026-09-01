import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/errors";
import {
  addTrackedKeyword,
  collectCampaignRankings,
  createPositionCampaign,
  listPositionCampaigns,
  listTrackedKeywords,
} from "@/lib/semforge/position-tracking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export function GET(request: NextRequest) {
  try {
    const campaignId = request.nextUrl.searchParams.get("campaignId");
    if (campaignId) return NextResponse.json({ keywords: listTrackedKeywords(campaignId) });
    return NextResponse.json({ campaigns: listPositionCampaigns() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    if (body.keyword !== undefined) {
      return NextResponse.json({ keyword: addTrackedKeyword(body) }, { status: 201 });
    }
    return NextResponse.json({ campaign: createPositionCampaign(body) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const id = z.coerce.number().int().positive().parse(request.nextUrl.searchParams.get("campaignId"));
    return NextResponse.json({ report: await collectCampaignRankings(id) });
  } catch (error) {
    return errorResponse(error);
  }
}
