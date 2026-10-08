import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/errors";
import { deleteOutcomeDefinition, upsertOutcomeDefinition } from "@/lib/outcomes/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(request: NextRequest) {
  try { return NextResponse.json({ definition: upsertOutcomeDefinition(await request.json()) }); }
  catch (error) { return errorResponse(error); }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = z.object({ eventName: z.string() }).strict().parse(await request.json());
    deleteOutcomeDefinition(body.eventName);
    return new NextResponse(null, { status: 204 });
  } catch (error) { return errorResponse(error); }
}
