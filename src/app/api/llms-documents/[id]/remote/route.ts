import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { verifyStoredLlmsDocument } from "@/lib/llms-documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ document: await verifyStoredLlmsDocument(id, await request.json()) });
  } catch (error) {
    return errorResponse(error);
  }
}
