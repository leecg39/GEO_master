import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/errors";
import { getLlmsRevisionDiff, listLlmsRevisions, restoreLlmsRevision } from "@/lib/llms-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };
const revision = z.coerce.number().int().positive();

/** ?from=2&to=3 이면 두 리비전의 줄 단위 차이, 없으면 리비전 목록 */
export async function GET(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params;
    const params = request.nextUrl.searchParams;
    if (params.has("from") || params.has("to")) {
      return NextResponse.json({ diff: getLlmsRevisionDiff(id, revision.parse(params.get("from")), revision.parse(params.get("to"))) }, { headers: { "cache-control": "no-store" } });
    }
    return NextResponse.json({ items: listLlmsRevisions(id) }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params;
    const body = z.object({ revision, expectedUpdatedAt: z.string() }).strict().parse(await request.json());
    return NextResponse.json({ restored: restoreLlmsRevision(id, body.revision, { expectedUpdatedAt: body.expectedUpdatedAt }) });
  } catch (error) { return errorResponse(error); }
}
