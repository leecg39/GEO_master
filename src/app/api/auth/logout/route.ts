import { NextRequest, NextResponse } from "next/server";
import { sameOriginMutation, SESSION_COOKIE } from "@/lib/login-session";

export function POST(request: NextRequest) {
  if (!sameOriginMutation(request)) return new NextResponse(null, { status: 403 });
  const response = new NextResponse(null, { status: 303, headers: { location: "/login", "cache-control": "private, no-store" } });
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}
