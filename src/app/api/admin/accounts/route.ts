import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { listAdminAccounts, requireAdminAccount } from "@/lib/accounts/admin";
import { ACCOUNT_STATUSES } from "@/lib/accounts/store";
import { errorResponse } from "@/lib/errors";
import { withRequestAccount } from "@/lib/request-account";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  status: z.enum(ACCOUNT_STATUSES).optional(),
  q: z.string().trim().max(128).optional(),
}).strict();

/** 관리자: 회원 목록. `?status=pending|active|disabled`로 상태를, `?q=`로 이메일·이름을 거른다. */
export function GET(request: NextRequest) {
  try {
    return withRequestAccount(request.headers, () => {
      // 권한을 먼저 확인해 비관리자에게는 입력 오류 대신 403을 준다.
      requireAdminAccount();
      const filters = querySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
      return NextResponse.json({ accounts: listAdminAccounts(filters) }, { headers: { "cache-control": "private, no-store" } });
    });
  } catch (error) {
    const response = errorResponse(error);
    response.headers.set("cache-control", "private, no-store");
    return response;
  }
}
