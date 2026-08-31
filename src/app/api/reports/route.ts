import { NextRequest } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/errors";
import { buildAuditReport, buildShareReport, reportFilename, reportToCsv } from "@/lib/reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  type: z.enum(["audit", "share"]),
  format: z.enum(["json", "csv"]).default("json"),
  id: z.coerce.number().int().positive().optional(),
});

export function GET(request: NextRequest) {
  try {
    const query = querySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    const report = query.type === "audit" ? buildAuditReport(query.id) : buildShareReport(query.id);
    const id = report.kind === "audit" ? report.audit.id : report.run.id;
    const filename = reportFilename(query.type, id, query.format);
    if (query.format === "csv") {
      return new Response(reportToCsv(report), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="${filename}"`,
          "cache-control": "no-store",
        },
      });
    }
    return new Response(JSON.stringify(report, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
