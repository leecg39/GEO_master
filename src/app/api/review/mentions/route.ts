import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { reviewMention } from "@/lib/review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    return NextResponse.json({ review: reviewMention(await request.json()) });
  } catch (error) {
    return errorResponse(error);
  }
}
