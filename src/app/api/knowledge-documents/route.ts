import { NextRequest, NextResponse } from "next/server";
import { requireHaloProject } from "@/lib/halo-feature";
import { errorResponse } from "@/lib/errors";
import { knowledgeDocuments as store } from "@/lib/library";
import { requireActiveProject } from "@/lib/projects";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: NextRequest) {
  try { requireHaloProject(request); return NextResponse.json({ items: store.list(), projectId: requireActiveProject().id }, { headers: { "cache-control": "no-store" } }); } catch (error) { return errorResponse(error); }
}
export async function POST(request: NextRequest) {
  try { const input = await request.json(); requireHaloProject(request); return NextResponse.json({ item: store.create(input) }, { status: 201 }); } catch (error) { return errorResponse(error); }
}
