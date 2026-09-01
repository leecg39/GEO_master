import { NextRequest, NextResponse } from "next/server";
import { duplicateContent } from "@/lib/contents";
import { errorResponse } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ContentContext = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, context: ContentContext) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ content: duplicateContent(id) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
