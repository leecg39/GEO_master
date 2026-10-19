import { NextRequest } from "next/server";
import { z } from "zod";
import { withRequestAccount } from "@/lib/request-account";
import { AppError, errorResponse } from "@/lib/errors";
import { auditReportToMarkdown } from "@/lib/report-markdown";
import { buildAuditMarkdownInput } from "@/lib/report-markdown-data";
import { PDF_MAX_RESULTS, reportToPdf } from "@/lib/report-pdf";
import { buildAuditReport, buildShareReport, reportFilename, reportToCsv } from "@/lib/reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  type: z.enum(["audit", "share"]),
  format: z.enum(["json", "csv", "pdf", "md"]).default("json"),
  id: z.coerce.number().int().positive().optional(),
});

const SECURITY_HEADERS = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" } as const;

function downloadReport(query: z.infer<typeof querySchema>) {
  if (query.format === "md" && query.type !== "audit") {
    throw new AppError("Markdown 보고서는 진단 결과만 지원합니다.", 400, "REPORT_FORMAT_UNSUPPORTED");
  }
  const report = query.type === "audit" ? buildAuditReport(query.id) : buildShareReport(query.id, query.format === "pdf" ? PDF_MAX_RESULTS : undefined);
  const id = report.kind === "audit" ? report.audit.id : report.run.id;
  const filename = reportFilename(query.type, id, query.format);
  let body: BodyInit;
  let contentType: string;
  if (query.format === "pdf") {
    body = reportToPdf(report);
    contentType = "application/pdf";
  } else if (query.format === "md" && report.kind === "audit") {
    body = auditReportToMarkdown(buildAuditMarkdownInput(report));
    contentType = "text/markdown; charset=utf-8";
  } else if (query.format === "csv") {
    body = reportToCsv(report);
    contentType = "text/csv; charset=utf-8";
  } else {
    body = JSON.stringify(report, null, 2);
    contentType = "application/json; charset=utf-8";
  }
  return new Response(body, {
    headers: { ...SECURITY_HEADERS, "content-type": contentType, "content-disposition": `attachment; filename="${filename}"` },
  });
}

export function GET(request: NextRequest) {
  try {
    return withRequestAccount(request.headers, () => downloadReport(querySchema.parse(Object.fromEntries(request.nextUrl.searchParams))));
  } catch (error) {
    const response = errorResponse(error);
    Object.entries(SECURITY_HEADERS).forEach(([name, value]) => response.headers.set(name, value));
    return response;
  }
}
