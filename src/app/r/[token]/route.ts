import { NextRequest, NextResponse } from "next/server";
import { renderPublicReportHtml, renderUnavailableHtml } from "@/lib/public-report";
import { resolvePublicReport } from "@/lib/report-shares";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ShareContext = { params: Promise<{ token: string }> };

const HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "private, no-store",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "x-robots-tag": "noindex, nofollow",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

export async function GET(_request: NextRequest, context: ShareContext) {
  const { token } = await context.params;
  try {
    const resolved = resolvePublicReport(token);
    if (!resolved) return new NextResponse(renderUnavailableHtml(), { status: 404, headers: HEADERS });
    return new NextResponse(renderPublicReportHtml(resolved.report, resolved.expiresAt), { status: 200, headers: HEADERS });
  } catch {
    return new NextResponse(renderUnavailableHtml(), { status: 404, headers: HEADERS });
  }
}
