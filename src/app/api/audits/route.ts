import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuditHistory, runAudit } from "@/lib/audit";
import { errorResponse } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  url: z.string().trim().min(1).max(2048),
  manualOverrides: z.record(z.string(), z.boolean()).optional().default({}),
});

export async function GET() {
  try {
    return NextResponse.json({ audits: getAuditHistory() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const input = requestSchema.parse(await request.json());
    return NextResponse.json({ audit: await runAudit(input.url, input.manualOverrides) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
