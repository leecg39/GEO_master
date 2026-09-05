import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/errors";
import { collectAiVisibility } from "@/lib/semforge/ai-visibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { domain?: unknown; forceRefresh?: unknown };
    const domain = z.string().trim().min(3).parse(body.domain);
    const forceRefresh = z.boolean().optional().parse(body.forceRefresh);
    return NextResponse.json({ report: await collectAiVisibility({ domain, forceRefresh }) });
  } catch (error) {
    return errorResponse(error);
  }
}
