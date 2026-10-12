import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { buildChangeReport } from "@/lib/change-report";
import { changeReportToMarkdown } from "@/lib/change-report-markdown";
import { changeReportToPdf } from "@/lib/change-report-pdf";
import { errorResponse } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  url: z.string().optional(),
  ids: z.string().regex(/^\d+(,\d+)*$/, "ids는 쉼표로 구분한 숫자여야 합니다.").optional(),
  format: z.enum(["json", "md", "pdf"]).default("json"),
  download: z.enum(["1"]).optional(),
}).strict();

const SECURITY_HEADERS = { "cache-control": "no-store", "x-content-type-options": "nosniff" } as const;

export function GET(request: NextRequest) {
  try {
    const query = querySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    const report = buildChangeReport({ url: query.url, ids: query.ids?.split(",").map(Number) });
    const filename = `geo-changes-${report.generatedAt.slice(0, 10)}.${query.format}`;
    if (query.format === "pdf") {
      return new Response(changeReportToPdf(report), {
        headers: { ...SECURITY_HEADERS, "content-type": "application/pdf", "content-disposition": `attachment; filename="${filename}"` },
      });
    }
    if (query.format === "md") {
      return new Response(changeReportToMarkdown(report), {
        headers: { ...SECURITY_HEADERS, "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename="${filename}"` },
      });
    }
    const headers: Record<string, string> = { ...SECURITY_HEADERS };
    if (query.download) headers["content-disposition"] = `attachment; filename="${filename}"`;
    return NextResponse.json(report, { headers });
  } catch (error) {
    const response = errorResponse(error);
    Object.entries(SECURITY_HEADERS).forEach(([name, value]) => response.headers.set(name, value));
    return response;
  }
}
