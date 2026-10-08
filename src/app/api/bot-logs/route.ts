import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { importBotLog, listBotLogImports } from "@/lib/bot-logs/store";
import { errorResponse } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// base64는 원본보다 약 4/3 크다. 원본 10MB 제한은 파서가 다시 확인한다
const MAX_BASE64_CHARS = 14_000_000;
const bodySchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentBase64: z.string().min(1).max(MAX_BASE64_CHARS).regex(/^[A-Za-z0-9+/]+={0,2}$/, "base64 형식이 아닙니다."),
  // 역방향·정방향 DNS로 Googlebot·Bingbot 진위 확인(외부 DNS 질의 발생, 선택)
  verifyDns: z.boolean().default(false),
}).strict();

export function GET() {
  try { return NextResponse.json({ items: listBotLogImports() }, { headers: { "cache-control": "no-store" } }); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: NextRequest) {
  try {
    const body = bodySchema.parse(await request.json());
    const result = await importBotLog({ fileName: body.fileName, buffer: Buffer.from(body.contentBase64, "base64"), verifyDns: body.verifyDns });
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (error) { return errorResponse(error); }
}
