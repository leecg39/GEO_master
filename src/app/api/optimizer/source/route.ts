import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/errors";
import { fetchSourceText } from "@/lib/optimizer-runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  try {
    const { url } = z.object({ url: z.string() }).strict().parse(await request.json());
    return NextResponse.json({ source: await fetchSourceText(url) });
  } catch (error) {
    return errorResponse(error);
  }
}
