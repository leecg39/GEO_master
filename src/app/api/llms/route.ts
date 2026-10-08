import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/errors";
import { generateLlmsTxt, validateLlmsTxt, verifyRemoteLlmsTxt } from "@/lib/llms-txt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("generate"), input: z.unknown() }),
  z.object({ action: z.literal("validate"), document: z.string().max(102_400), website: z.string().url().optional(), path: z.string().max(512).optional() }),
  z.object({ action: z.literal("remote"), website: z.string().url().max(2048), path: z.string().max(512).optional() }),
]);

export async function POST(request: NextRequest) {
  try {
    const body = requestSchema.parse(await request.json());
    if (body.action === "generate") return NextResponse.json({ result: generateLlmsTxt(body.input) });
    if (body.action === "validate") return NextResponse.json({ result: { document: body.document, validation: validateLlmsTxt(body.document, body.website, { path: body.path }) } });
    return NextResponse.json({ result: await verifyRemoteLlmsTxt(body.website, body.path) });
  } catch (error) {
    return errorResponse(error);
  }
}
