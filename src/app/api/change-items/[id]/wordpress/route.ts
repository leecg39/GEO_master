import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/errors";
import { executeWordpressDelivery, previewWordpressDelivery } from "@/lib/wordpress-delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Context = { params: Promise<{ id: string }> };

/** 수정안 1건 단위만. 일괄 전달 엔드포인트는 두지 않는다 (R08) */
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview") }).strict(),
  z.object({ action: z.literal("execute"), previewToken: z.string() }).strict(),
]);

export async function POST(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params;
    const body = actionSchema.parse(await request.json());
    if (body.action === "preview") return NextResponse.json({ preview: await previewWordpressDelivery(id) }, { headers: { "cache-control": "no-store" } });
    return NextResponse.json(await executeWordpressDelivery(id, { previewToken: body.previewToken }), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
