import { withSemforgeAccount } from "@/lib/semforge-route";
import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { confirmSemforgePayment } from "@/lib/semforge-subscription";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(request: NextRequest) {
  try {
    return NextResponse.json({ subscription: confirmSemforgePayment(await request.json()) });
  } catch (error) {
    return errorResponse(error);
  }
}

export const POST = withSemforgeAccount(handlePOST);
