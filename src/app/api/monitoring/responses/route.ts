import { NextResponse } from "next/server";
import { getMonitoringResponses } from "@/lib/monitoring-responses";
import { withSemforgeAccount } from "@/lib/semforge-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = withSemforgeAccount((request) => NextResponse.json(getMonitoringResponses(Object.fromEntries(request.nextUrl.searchParams))));
