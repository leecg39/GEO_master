import { NextRequest, NextResponse } from "next/server";
import { requireHaloProject } from "@/lib/halo-feature";
import { errorResponse } from "@/lib/errors";
import { adoptOpportunity } from "@/lib/opportunities";
export const runtime = "nodejs";
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try { const input = await request.json(); const { id } = await context.params; requireHaloProject(request); return NextResponse.json({ item: adoptOpportunity(id, input) }); } catch (error) { return errorResponse(error); }
}
