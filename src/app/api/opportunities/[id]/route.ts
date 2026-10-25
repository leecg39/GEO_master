import { NextRequest, NextResponse } from "next/server";
import { requireHaloProject } from "@/lib/halo-feature";
import { errorResponse } from "@/lib/errors";
import { getOpportunity, updateOpportunity, deleteOpportunity } from "@/lib/opportunities";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, context: Context) {
  try { const { id } = await context.params; requireHaloProject(request); return NextResponse.json({ item: getOpportunity(id) }, { headers: { "cache-control": "no-store" } }); } catch (error) { return errorResponse(error); }
}
export async function PATCH(request: NextRequest, context: Context) {
  try { const input = await request.json(); const { id } = await context.params; requireHaloProject(request); return NextResponse.json({ item: updateOpportunity(id, input) }); } catch (error) { return errorResponse(error); }
}
export async function DELETE(request: NextRequest, context: Context) {
  try { const input = await request.json(); const { id } = await context.params; requireHaloProject(request); deleteOpportunity(id, input); return new NextResponse(null, { status: 204 }); } catch (error) { return errorResponse(error); }
}
