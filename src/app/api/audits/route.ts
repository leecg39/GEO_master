import { NextRequest, NextResponse } from "next/server";
import { createAudit, listAudits } from "@/lib/audit";
import { errorResponse } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  try {
    const page = listAudits(Object.fromEntries(request.nextUrl.searchParams.entries()));
    return NextResponse.json({ ...page, audits: page.items }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    return NextResponse.json({ audit: await createAudit(await request.json()) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
