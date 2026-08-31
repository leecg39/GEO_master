import { NextRequest, NextResponse } from "next/server";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function proxy(request: NextRequest) {
  if (!MUTATING_METHODS.has(request.method)) return NextResponse.next();

  const fetchSite = request.headers.get("sec-fetch-site");
  const origin = request.headers.get("origin");
  const expectedHost = request.headers.get("host") ?? request.nextUrl.host;
  if (fetchSite === "cross-site") {
    return NextResponse.json({ error: "교차 출처 요청은 허용되지 않습니다.", code: "CROSS_SITE_BLOCKED" }, { status: 403 });
  }
  if (origin) {
    try {
      if (new URL(origin).host !== expectedHost) {
        return NextResponse.json({ error: "교차 출처 요청은 허용되지 않습니다.", code: "ORIGIN_BLOCKED" }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ error: "올바르지 않은 Origin입니다.", code: "ORIGIN_BLOCKED" }, { status: 403 });
    }
  }
  if (request.method !== "DELETE" && !request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "application/json 요청만 허용됩니다.", code: "JSON_REQUIRED" }, { status: 415 });
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
