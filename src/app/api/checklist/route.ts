import { NextRequest, NextResponse } from "next/server";
import { getLearnChecklist, updateLearnChecklist } from "@/lib/checklist";
import { errorResponse } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try { return NextResponse.json({ checklist: getLearnChecklist() }); }
  catch (error) { return errorResponse(error); }
}

export async function PUT(request: NextRequest) {
  try { return NextResponse.json({ checklist: updateLearnChecklist(await request.json()) }); }
  catch (error) { return errorResponse(error); }
}
