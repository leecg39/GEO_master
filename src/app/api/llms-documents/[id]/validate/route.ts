import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { validateStoredLlmsDocument } from "@/lib/llms-documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ document: validateStoredLlmsDocument(id, await request.json()) });
  } catch (error) {
    return errorResponse(error);
  }
}
