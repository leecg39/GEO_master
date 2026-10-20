import { NextRequest, NextResponse } from "next/server";
import { AppError, errorResponse } from "@/lib/errors";
import { getRequestAccount, withRequestAccount } from "@/lib/request-account";
import { deleteWordpressConnection, getWordpressConnection, saveWordpressConnection } from "@/lib/wordpress-connections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

function assertNotGuest() {
  if (getRequestAccount().role === "guest") {
    throw new AppError("게스트 계정은 WordPress 연결을 변경할 수 없습니다.", 403, "FORBIDDEN");
  }
}

export function GET() {
  try { return NextResponse.json({ connection: getWordpressConnection() }, { headers: NO_STORE }); }
  catch (error) { return errorResponse(error); }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    return await withRequestAccount(request.headers, async () => {
      assertNotGuest();
      return NextResponse.json({ connection: await saveWordpressConnection(body) }, { headers: NO_STORE });
    });
  } catch (error) { return errorResponse(error); }
}

export function DELETE(request?: NextRequest) {
  try {
    return withRequestAccount(request?.headers ?? new Headers(), () => {
      assertNotGuest();
      return NextResponse.json(deleteWordpressConnection(), { headers: NO_STORE });
    });
  } catch (error) { return errorResponse(error); }
}
