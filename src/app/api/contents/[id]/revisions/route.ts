import { NextRequest, NextResponse } from "next/server";
import { createContentRevision, listContentRevisions } from "@/lib/contents";
import { errorResponse } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ContentContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: ContentContext) {
  try {
    const { id } = await context.params;
    return NextResponse.json(listContentRevisions(id, Object.fromEntries(request.nextUrl.searchParams.entries())), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest, context: ContentContext) {
  try {
    const { id } = await context.params;
    return NextResponse.json(createContentRevision(id, await request.json()), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
