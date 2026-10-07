import { NextRequest, NextResponse } from "next/server";
import { safeReturnPath } from "@/lib/login-session";

export const dynamic = "force-dynamic";
const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export function GET(request: NextRequest) {
  const next = escape(safeReturnPath(request.nextUrl.searchParams.get("next")));
  const error = request.nextUrl.searchParams.get("error");
  const message = error === "limited" ? "로그인 시도가 많습니다. 5분 후 다시 시도해 주세요." : error ? "아이디 또는 비밀번호를 확인해 주세요." : "";
  return new NextResponse(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>로그인 · GEO Master</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:24px;background:#130d23;color:#f9f6ff;font-family:system-ui,-apple-system,sans-serif}main{width:min(100%,420px);padding:36px;border:1px solid #403455;border-radius:24px;background:#20172f}small{color:#c7f34c;font-weight:700;letter-spacing:.12em}h1{font-size:30px;margin:16px 0 12px}p{color:#bcb2cd;line-height:1.6}label{display:block;margin:22px 0 8px;font-size:14px;font-weight:600}input{width:100%;padding:14px;border:1px solid #655379;border-radius:10px;background:#171021;color:white;font:inherit}input:focus{outline:2px solid #c7f34c;outline-offset:2px}button{width:100%;margin:28px 0 12px;padding:14px;border:0;border-radius:10px;background:#c7f34c;color:#171021;font:inherit;font-weight:700;cursor:pointer}a{color:#c7f34c;font-size:14px}form p{color:#ffb4c2;font-size:14px}.note{font-size:12px}
</style></head><body><main><small>GEO MASTER</small><h1>워크스페이스 로그인</h1><p>계정으로 로그인해 분석을 이어가세요.</p><form method="post" action="/api/auth/login"><input type="hidden" name="next" value="${next}"><label for="username">아이디</label><input id="username" name="username" autocomplete="username" maxlength="128" required autofocus><label for="password">비밀번호</label><input id="password" name="password" type="password" autocomplete="current-password" maxlength="72" required>${message ? `<p role="alert">${message}</p>` : ""}<button type="submit">로그인</button></form><p class="note">로그인 상태는 최대 12시간 유지됩니다.</p><a href="/link-preview.html">서비스 소개 보기</a></main></body></html>`, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" },
  });
}
