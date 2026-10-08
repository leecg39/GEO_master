import { withSemforgeAccount } from "@/lib/semforge-route";
import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { runAllInSemforge } from "@/lib/semforge/all-in";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handlePOST(request: NextRequest) {
  try {
    return NextResponse.json({ report: await runAllInSemforge(await request.json()) });
  } catch (error) {
    return errorResponse(error);
  }
}

export const POST = withSemforgeAccount(handlePOST, { requireSubscription: true });
