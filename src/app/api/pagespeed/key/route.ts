import { NextRequest, NextResponse } from "next/server";
import { AppError, errorResponse } from "@/lib/errors";
import { deletePageSpeedKey, pageSpeedKeyStatus, savePageSpeedKey } from "@/lib/pagespeed";
import { getRequestAccount, withRequestAccount } from "@/lib/request-account";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

function assertCanManageKey() {
  const { role } = getRequestAccount();
  if (role === "guest" || role === "customer") {
    throw new AppError("공용 PageSpeed API 키는 관리자 또는 운영 계정만 변경할 수 있습니다.", 403, "FORBIDDEN");
  }
}

export function GET() {
  try { return NextResponse.json(pageSpeedKeyStatus(), { headers: NO_STORE }); } catch (error) { return errorResponse(error); }
}
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    return withRequestAccount(request.headers, () => {
      assertCanManageKey();
      return NextResponse.json(savePageSpeedKey(body), { headers: NO_STORE });
    });
  } catch (error) { return errorResponse(error); }
}
export function DELETE(request?: NextRequest) {
  try {
    return withRequestAccount(request?.headers ?? new Headers(), () => {
      assertCanManageKey();
      return NextResponse.json(deletePageSpeedKey(), { headers: NO_STORE });
    });
  } catch (error) { return errorResponse(error); }
}
