import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/errors";
import { getOutcomeSummary, importOutcomeCsv } from "@/lib/outcomes/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// base64는 원본보다 약 4/3 크다. 원본 5MB 제한은 파서가 다시 확인한다
const bodySchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  sourceLabel: z.string().trim().min(1).max(80),
  contentBase64: z.string().min(1).max(7_000_000).regex(/^[A-Za-z0-9+/]+={0,2}$/, "base64 형식이 아닙니다."),
}).strict();

export function GET() {
  try { return NextResponse.json(getOutcomeSummary(), { headers: { "cache-control": "no-store" } }); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: NextRequest) {
  try {
    const body = bodySchema.parse(await request.json());
    const result = importOutcomeCsv({ fileName: body.fileName, sourceLabel: body.sourceLabel, buffer: Buffer.from(body.contentBase64, "base64") });
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (error) { return errorResponse(error); }
}
