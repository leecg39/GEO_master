import { withSemforgeAccount } from "@/lib/semforge-route";
import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { cancelSemforgeSubscription, getSemforgeSubscription } from "@/lib/semforge-subscription";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function handleGET() {
  try {
    return NextResponse.json({ subscription: getSemforgeSubscription() }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

async function handleDELETE() {
  try {
    return NextResponse.json({ subscription: cancelSemforgeSubscription() });
  } catch (error) {
    return errorResponse(error);
  }
}

export const GET = withSemforgeAccount(handleGET);
export const DELETE = withSemforgeAccount(handleDELETE);
