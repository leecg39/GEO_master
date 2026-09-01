import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { getDomainOverview } from "@/lib/semforge/position-tracking";
import { getSemforgeSubscription } from "@/lib/semforge-subscription";
import { requireActiveProject } from "@/lib/projects";
import { normalizeDomain, projectDomainFromBrand } from "@/lib/semforge/utils/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  try {
    const project = requireActiveProject();
    const domain = normalizeDomain(
      request.nextUrl.searchParams.get("domain")
      ?? project.domain
      ?? projectDomainFromBrand(project.brandName),
    );
    return NextResponse.json({
      subscription: getSemforgeSubscription(),
      overview: getDomainOverview(domain),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
