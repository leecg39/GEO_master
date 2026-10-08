import { withSemforgeAccount } from "@/lib/semforge-route";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AppError, errorResponse } from "@/lib/errors";
import { getPageSnapshot } from "@/lib/page-snapshots";
import { createSiteAuditCampaign, deleteSiteAuditCampaign, getSiteAuditOverview, getSiteAuditWorkspace } from "@/lib/semforge/siteaudit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function handleGET(request: NextRequest) {
  try {
    const snapshot = request.nextUrl.searchParams.get("snapshot");
    if (snapshot) return NextResponse.json({ snapshot: getPageSnapshot(snapshot) });
    const id = request.nextUrl.searchParams.get("id");
    if (id) return NextResponse.json({ overview: getSiteAuditOverview(id) });
    return NextResponse.json(getSiteAuditWorkspace());
  } catch (error) {
    return errorResponse(error);
  }
}

async function handlePOST(request: NextRequest) {
  try {
    return NextResponse.json({ campaign: createSiteAuditCampaign(await request.json()) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

async function handlePATCH(request: NextRequest) {
  try {
    const id = z.coerce.number().int().positive().parse(request.nextUrl.searchParams.get("id"));
    const text = await request.text();
    const body: unknown = text.trim() ? JSON.parse(text) : {};
    const { cancelSiteAuditCampaign, runSiteAuditCampaign } = await import("@/lib/semforge/siteaudit");
    if (body && typeof body === "object" && (body as { action?: unknown }).action === "cancel") {
      return NextResponse.json({ result: cancelSiteAuditCampaign(id) });
    }
    return NextResponse.json({ result: await runSiteAuditCampaign(id, body) });
  } catch (error) {
    return errorResponse(error instanceof SyntaxError ? new AppError("요청 본문이 올바른 JSON이 아닙니다.", 400, "INVALID_JSON") : error);
  }
}

async function handleDELETE(request: NextRequest) {
  try {
    const id = z.coerce.number().int().positive().parse(request.nextUrl.searchParams.get("id"));
    return NextResponse.json(deleteSiteAuditCampaign(id));
  } catch (error) {
    return errorResponse(error);
  }
}

export const GET = withSemforgeAccount(handleGET, { requireSubscription: true });
export const POST = withSemforgeAccount(handlePOST, { requireSubscription: true });
export const PATCH = withSemforgeAccount(handlePATCH, { requireSubscription: true });
export const DELETE = withSemforgeAccount(handleDELETE, { requireSubscription: true });
