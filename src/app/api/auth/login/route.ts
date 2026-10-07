import { NextRequest, NextResponse } from "next/server";
import { accountRole, canAccessPath } from "@/lib/account-policy";
import { createSession, isTrustedProxy, safeReturnPath, sameOriginMutation, SESSION_COOKIE, SESSION_SECONDS, verifyPassword } from "@/lib/login-session";

export const runtime = "nodejs";
const attempts = new Map<string, { count: number; until: number }>();
const windowMs = 5 * 60 * 1000;

function redirect(path: string) {
  return new NextResponse(null, { status: 303, headers: { location: path, "cache-control": "private, no-store" } });
}

export async function POST(request: NextRequest) {
  if (process.env.GEO_AUTH_MODE !== "proxy") return NextResponse.json({ error: "로그인이 구성되지 않았습니다." }, { status: 503 });
  try {
    if (!isTrustedProxy(request.headers) || !sameOriginMutation(request)) return NextResponse.json({ error: "허용되지 않은 요청입니다." }, { status: 403 });
    if (!/^application\/x-www-form-urlencoded(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) return new NextResponse(null, { status: 415 });
    // Use the last address appended by the trusted reverse proxy, not a client-provided first address.
    const key = request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || "unknown";
    const now = Date.now();
    for (const [address, entry] of attempts) if (entry.until <= now) attempts.delete(address);
    if (attempts.size >= 5000 && !attempts.has(key)) return redirect("/login?error=limited");
    const bucket = attempts.get(key) ?? { count: 0, until: now + windowMs };
    if (++bucket.count > 15) return redirect("/login?error=limited");
    attempts.set(key, bucket);
    if (Number(request.headers.get("content-length")) > 4096 || !request.body) return new NextResponse(null, { status: 413 });
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 4096) { await reader.cancel(); return new NextResponse(null, { status: 413 }); }
      chunks.push(value);
    }
    const fields = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
    const next = safeReturnPath(fields.get("next"));
    const user = await verifyPassword(fields.get("username")?.trim() ?? "", fields.get("password") ?? "");
    if (!user) return redirect(`/login?error=invalid&next=${encodeURIComponent(next)}`);
    attempts.delete(key);
    const destination = canAccessPath(accountRole(user), new URL(next, "https://geo.invalid").pathname) ? next : "/";
    const response = redirect(destination);
    response.cookies.set(SESSION_COOKIE, createSession(user), { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: SESSION_SECONDS });
    return response;
  } catch {
    return NextResponse.json({ error: "로그인 설정을 확인해 주세요." }, { status: 503 });
  }
}
