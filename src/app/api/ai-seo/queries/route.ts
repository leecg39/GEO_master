import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/errors";
import { addAiVisibilityQuery, getAiVisibilityQueryReport, listAiVisibilityQueries, removeAiVisibilityQuery } from "@/lib/semforge/ai-visibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("id");
    if (id) return NextResponse.json({ report: getAiVisibilityQueryReport(id) });
    const domain = request.nextUrl.searchParams.get("domain") ?? undefined;
    return NextResponse.json({ queries: listAiVisibilityQueries(domain) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    return NextResponse.json({ query: addAiVisibilityQuery(await request.json()) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const id = z.coerce.number().int().positive().parse(request.nextUrl.searchParams.get("id"));
    return NextResponse.json(removeAiVisibilityQuery(id));
  } catch (error) {
    return errorResponse(error);
  }
}
