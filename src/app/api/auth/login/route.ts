import { NextRequest, NextResponse } from "next/server";
import { accountRole, canAccessPath } from "@/lib/account-policy";
import { accountHomePath } from "@/lib/accounts/home";
import { loginEnabled } from "@/lib/auth-mode";
import { createSession, isTrustedProxy, safeReturnPath, sameOriginMutation, SESSION_COOKIE, SESSION_SECONDS, verifyCredentials } from "@/lib/login-session";

export const runtime = "nodejs";
const attempts = new Map<string, { count: number; until: number }>();
const windowMs = 5 * 60 * 1000;

function redirect(path: string) {
  return new NextResponse(null, { status: 303, headers: { location: path, "cache-control": "private, no-store" } });
}

export async function POST(request: NextRequest) {
  if (!loginEnabled()) return NextResponse.json({ error: "로그인이 구성되지 않았습니다." }, { status: 503 });
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
    const result = await verifyCredentials(fields.get("username")?.trim() ?? "", fields.get("password") ?? "");
    if (!result) return redirect(`/login?error=invalid&next=${encodeURIComponent(next)}`);
    // 비밀번호가 맞은 승인 대기·이용 중지 계정에만 상태를 알린다.
    if (result.status !== "active") return redirect(`/login?error=${result.status}&next=${encodeURIComponent(next)}`);
    attempts.delete(key);
    const { user } = result;
    const role = accountRole(user);
    // 돌아갈 화면이 없으면 가입 유형에 맞는 첫 화면으로 보낸다(SEMForge Pro 가입자는 결제·SEMForge 화면).
    const requested = next === "/" ? accountHomePath(user, role) : next;
    const destination = canAccessPath(role, new URL(requested, "https://geo.invalid").pathname) ? requested : "/";
    const response = redirect(destination);
    response.cookies.set(SESSION_COOKIE, createSession(user), { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: SESSION_SECONDS });
    return response;
  } catch {
    return NextResponse.json({ error: "로그인 설정을 확인해 주세요." }, { status: 503 });
  }
}
