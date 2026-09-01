import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { duplicateLlmsDocument } from "@/lib/llms-documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, context: Context) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ document: duplicateLlmsDocument(id) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
