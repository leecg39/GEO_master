import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { setAccountStatus } from "@/lib/accounts/admin";
import { ACCOUNT_STATUSES } from "@/lib/accounts/store";
import { errorResponse } from "@/lib/errors";
import { withRequestAccount } from "@/lib/request-account";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.object({ status: z.enum(ACCOUNT_STATUSES) }).strict();
type AccountRouteContext = { params: Promise<{ id: string }> };

/** 관리자: 가입 신청 승인(active)·이용 중지(disabled)·다시 활성화 */
export async function PATCH(request: NextRequest, context: AccountRouteContext) {
  try {
    return await withRequestAccount(request.headers, async () => {
      const input = updateSchema.parse(await request.json());
      const { id } = await context.params;
      const account = setAccountStatus(id, input.status);
      return NextResponse.json({ account }, { headers: { "cache-control": "private, no-store" } });
    });
  } catch (error) {
    const response = errorResponse(error);
    response.headers.set("cache-control", "private, no-store");
    return response;
  }
}
