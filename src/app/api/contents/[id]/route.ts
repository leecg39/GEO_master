import { NextRequest, NextResponse } from "next/server";
import { deleteContent, getContent, updateContent } from "@/lib/contents";
import { errorResponse } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ContentContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: ContentContext) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ content: getContent(id) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest, context: ContentContext) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ content: updateContent(id, await request.json()) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest, context: ContentContext) {
  try {
    const { id } = await context.params;
    deleteContent(id, await request.json());
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
