import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AppError, errorResponse } from "@/lib/errors";
import { getRequestAccount, withRequestAccount } from "@/lib/request-account";
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
    return await withRequestAccount(request.headers, async () => {
      if (getRequestAccount().role === "guest") {
        throw new AppError("게스트 계정은 WordPress에 수정안을 전달할 수 없습니다.", 403, "FORBIDDEN");
      }
      if (body.action === "preview") return NextResponse.json({ preview: await previewWordpressDelivery(id) }, { headers: { "cache-control": "no-store" } });
      return NextResponse.json(await executeWordpressDelivery(id, { previewToken: body.previewToken }), { headers: { "cache-control": "no-store" } });
    });
  } catch (error) {
    return errorResponse(error);
  }
}
