import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { getLocalBusinessOverview } from "@/lib/semforge/position-tracking";
import { getSemforgeSubscription } from "@/lib/semforge-subscription";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try {
    return NextResponse.json({
      subscription: getSemforgeSubscription(),
      overview: getLocalBusinessOverview(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
