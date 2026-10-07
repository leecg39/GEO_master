import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { createFact, listFacts } from "@/lib/facts";
import { RECOMMENDED_ATTRIBUTES } from "@/lib/geo-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try {
    return NextResponse.json({ items: listFacts(), recommendedAttributes: RECOMMENDED_ATTRIBUTES }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    return NextResponse.json({ fact: createFact(await request.json()) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
