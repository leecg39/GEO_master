import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { confirmSemforgePayment } from "@/lib/semforge-subscription";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    return NextResponse.json({ subscription: confirmSemforgePayment(await request.json()) });
  } catch (error) {
    return errorResponse(error);
  }
}
