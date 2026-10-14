import { NextRequest } from "next/server";
import { z } from "zod";
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

export function GET(request: NextRequest) {
  try {
    const query = querySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    if (query.format === "md" && query.type !== "audit") {
      throw new AppError("Markdown 보고서는 진단 결과만 지원합니다.", 400, "REPORT_FORMAT_UNSUPPORTED");
    }
    const report = query.type === "audit" ? buildAuditReport(query.id) : buildShareReport(query.id, query.format === "pdf" ? PDF_MAX_RESULTS : undefined);
    const id = report.kind === "audit" ? report.audit.id : report.run.id;
    const filename = reportFilename(query.type, id, query.format);
    if (query.format === "pdf") {
      return new Response(reportToPdf(report), {
        headers: {
          "content-type": "application/pdf",
          "content-disposition": `attachment; filename="${filename}"`,
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      });
    }
    if (query.format === "md" && report.kind === "audit") {
      return new Response(auditReportToMarkdown(buildAuditMarkdownInput(report)), {
        headers: {
          "content-type": "text/markdown; charset=utf-8",
          "content-disposition": `attachment; filename="${filename}"`,
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      });
    }
    if (query.format === "csv") {
      return new Response(reportToCsv(report), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="${filename}"`,
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      });
    }
    return new Response(JSON.stringify(report, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    const response = errorResponse(error);
    response.headers.set("cache-control", "no-store");
    response.headers.set("x-content-type-options", "nosniff");
    return response;
  }
}
