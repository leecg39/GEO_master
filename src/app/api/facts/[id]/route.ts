import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { deleteFact, updateFact } from "@/lib/facts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FactContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: FactContext) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ fact: updateFact(id, await request.json()) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest, context: FactContext) {
  try {
    const { id } = await context.params;
    deleteFact(id, await request.json());
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
