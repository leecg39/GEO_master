import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/errors";
import { getSiteOpsWorkspace, performSiteOps } from "@/lib/site-ops";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: NextRequest) {
  try {
    return NextResponse.json(
      getSiteOpsWorkspace(
        z.coerce
          .number()
          .int()
          .positive()
          .parse(request.nextUrl.searchParams.get("campaignId")),
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    return NextResponse.json(
      await performSiteOps(await request.json(), request.signal),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
