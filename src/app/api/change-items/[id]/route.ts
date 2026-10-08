import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { approveChangeItem, deleteChangeItem, markDelivered, reportCurrentValue, updateChangeItem, verifyChangeItem } from "@/lib/change-items";
import { errorResponse } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Context = { params: Promise<{ id: string }> };

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("update"), changes: z.unknown() }).strict(),
  z.object({ action: z.literal("approve"), expectedUpdatedAt: z.string() }).strict(),
  z.object({ action: z.literal("deliver"), method: z.literal("manual") }).strict(),
  z.object({ action: z.literal("report-current"), currentValue: z.string().max(20_000) }).strict(),
  z.object({ action: z.literal("verify") }).strict(),
]);

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params;
    const body = actionSchema.parse(await request.json());
    if (body.action === "verify") return NextResponse.json(await verifyChangeItem(id));
    const item = body.action === "update" ? updateChangeItem(id, body.changes)
      : body.action === "approve" ? approveChangeItem(id, { expectedUpdatedAt: body.expectedUpdatedAt })
        : body.action === "deliver" ? markDelivered(id, { method: body.method })
          : reportCurrentValue(id, body.currentValue);
    return NextResponse.json({ item });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params;
    deleteChangeItem(id, await request.json());
    return new NextResponse(null, { status: 204 });
  } catch (error) { return errorResponse(error); }
}
