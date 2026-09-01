import { NextRequest, NextResponse } from "next/server";
import { getLearnChecklist, resetLearnChecklist, updateLearnChecklist } from "@/lib/checklist";
import { errorResponse } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try { return NextResponse.json({ checklist: getLearnChecklist() }); }
  catch (error) { return errorResponse(error); }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json() as { reset?: unknown };
    const checklist = body.reset ? resetLearnChecklist(body) : updateLearnChecklist(body);
    return NextResponse.json({ checklist });
  } catch (error) { return errorResponse(error); }
}
