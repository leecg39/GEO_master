import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { cancelSemforgeSubscription, getSemforgeSubscription } from "@/lib/semforge-subscription";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try {
    return NextResponse.json({ subscription: getSemforgeSubscription() }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE() {
  try {
    return NextResponse.json({ subscription: cancelSemforgeSubscription() });
  } catch (error) {
    return errorResponse(error);
  }
}
