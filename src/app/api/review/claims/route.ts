import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { reviewClaim } from "@/lib/review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    return NextResponse.json({ review: reviewClaim(await request.json()) });
  } catch (error) {
    return errorResponse(error);
  }
}
