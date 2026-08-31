import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { getShareHistory, QUESTION_TEMPLATES } from "@/lib/share";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try {
    return NextResponse.json({ runs: getShareHistory(), templates: QUESTION_TEMPLATES });
  } catch (error) {
    return errorResponse(error);
  }
}
