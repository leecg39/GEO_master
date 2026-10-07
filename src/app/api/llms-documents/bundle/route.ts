import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkAiFileBundle } from "@/lib/ai-file-bundle";
import { errorResponse } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const bodySchema = z.object({ website: z.string().trim().min(1).max(2048) }).strict();

export async function POST(request: NextRequest) {
  try {
    const { website } = bodySchema.parse(await request.json());
    return NextResponse.json({ bundle: await checkAiFileBundle(website) }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
