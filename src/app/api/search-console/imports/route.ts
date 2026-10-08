import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/errors";
import { importConsoleExport, listConsoleImports } from "@/lib/search-console/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// base64는 원본보다 약 4/3 크다. 원본 2MB 제한은 파서가 다시 확인한다
const MAX_BASE64_CHARS = 3_000_000;
const bodySchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  propertyLabel: z.string().trim().min(1).max(120),
  contentBase64: z.string().min(1).max(MAX_BASE64_CHARS).regex(/^[A-Za-z0-9+/]+={0,2}$/, "base64 형식이 아닙니다."),
}).strict();

export function GET() {
  try { return NextResponse.json({ items: listConsoleImports() }, { headers: { "cache-control": "no-store" } }); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: NextRequest) {
  try {
    const body = bodySchema.parse(await request.json());
    const result = importConsoleExport({ fileName: body.fileName, propertyLabel: body.propertyLabel, buffer: Buffer.from(body.contentBase64, "base64") });
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (error) { return errorResponse(error); }
}
