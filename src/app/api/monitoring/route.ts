import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors";
import { getMonitoringData, monitoringCsv, monitoringQuerySchema } from "@/lib/monitoring";
import { withSemforgeAccount } from "@/lib/semforge-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withSemforgeAccount((request) => {
  const query = monitoringQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
  const data = getMonitoringData(query);
  if (query.format === "csv") {
    if (data.selectionMissing) throw new AppError("선택한 질문을 이 기간에 찾을 수 없습니다.", 404, "QUESTION_NOT_FOUND");
    return new Response(monitoringCsv(data), { headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="monitoring-${data.project.id}-${data.range.start}-${data.range.end}.csv"`,
      "x-content-type-options": "nosniff",
    } });
  }
  return NextResponse.json(data);
});
