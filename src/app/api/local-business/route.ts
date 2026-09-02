import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/errors";
import { semforgeError } from "@/lib/semforge/errors";
import {
  addMapRankKeyword,
  collectMapRank,
  connectGbpLocation,
  createMapRankCampaign,
  getLocalBusinessOverview,
  listMapRankKeywords,
  removeGbpConnection,
} from "@/lib/semforge/local-business";
import { getSemforgeSubscription } from "@/lib/semforge-subscription";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export function GET(request: NextRequest) {
  try {
    const campaignId = request.nextUrl.searchParams.get("campaignId");
    if (campaignId) return NextResponse.json({ keywords: listMapRankKeywords(campaignId) });
    return NextResponse.json({
      subscription: getSemforgeSubscription(),
      overview: getLocalBusinessOverview(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    if (body.locationName !== undefined) {
      return NextResponse.json({ connection: connectGbpLocation(body) }, { status: 201 });
    }
    if (body.keyword !== undefined) {
      return NextResponse.json({ keyword: addMapRankKeyword(body) }, { status: 201 });
    }
    return NextResponse.json({ campaign: createMapRankCampaign(body) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const id = z.coerce.number().int().positive().parse(request.nextUrl.searchParams.get("campaignId"));
    return NextResponse.json({ report: await collectMapRank(id) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const gbpId = request.nextUrl.searchParams.get("gbpId");
    if (gbpId) return NextResponse.json(removeGbpConnection(gbpId));
    throw semforgeError("VALIDATION_ERROR", "삭제 대상이 지정되지 않았습니다.");
  } catch (error) {
    return errorResponse(error);
  }
}
