import { NextRequest } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/errors";
import { PDF_MAX_RESULTS, reportToPdf } from "@/lib/report-pdf";
import { buildAuditReport, buildShareReport, reportFilename, reportToCsv } from "@/lib/reports";
import { withRequestAccount } from "@/lib/request-account";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  type: z.enum(["audit", "share"]),
  format: z.enum(["json", "csv", "pdf"]).default("json"),
  id: z.coerce.number().int().positive().optional(),
});

export function GET(request: NextRequest) {
  try {
    const query = querySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    const report = withRequestAccount(request.headers, () => {
      // CSV에는 부록이 없으며, JSON(미리보기 포함)·PDF의 원천 권한은 빌더가 검증한다.
      const options = { includeObservations: query.format !== "csv" };
      return query.type === "audit" ? buildAuditReport(query.id, options) : buildShareReport(query.id, query.format === "pdf" ? PDF_MAX_RESULTS : undefined, options);
    });
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
