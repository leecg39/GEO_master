import { NextRequest, NextResponse } from "next/server";
import { createChangeItemFromAudit, suggestChangesFromAudit } from "@/lib/audit-changes";
import { errorResponse } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: Context) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ suggestions: suggestChangesFromAudit(id) }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ item: createChangeItemFromAudit(id, await request.json()) }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
