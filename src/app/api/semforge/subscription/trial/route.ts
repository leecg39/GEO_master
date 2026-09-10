import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { startSemforgeTrial } from "@/lib/semforge-subscription";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    return NextResponse.json({ subscription: startSemforgeTrial() }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
