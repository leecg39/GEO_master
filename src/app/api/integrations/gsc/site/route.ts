import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/errors";
import { getGscStatus, selectGscSite } from "@/lib/gsc-api/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(request: NextRequest) {
  try {
    const body = z.object({ siteUrl: z.string() }).strict().parse(await request.json());
    await selectGscSite(body.siteUrl);
    return NextResponse.json({ status: getGscStatus() });
  } catch (error) { return errorResponse(error); }
}
