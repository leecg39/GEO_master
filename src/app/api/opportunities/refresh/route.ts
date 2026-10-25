import { NextRequest, NextResponse } from "next/server";
import { requireHaloProject } from "@/lib/halo-feature";
import { errorResponse } from "@/lib/errors";
import { refreshOpportunities } from "@/lib/opportunities";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try { requireHaloProject(request); return NextResponse.json(refreshOpportunities()); } catch (error) { return errorResponse(error); }
}
