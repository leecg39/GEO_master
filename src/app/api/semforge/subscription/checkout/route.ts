import { withSemforgeAccount } from "@/lib/semforge-route";
import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { createSemforgeCheckout } from "@/lib/semforge-subscription";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST() {
  try {
    return NextResponse.json({ checkout: createSemforgeCheckout() }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export const POST = withSemforgeAccount(handlePOST);
