import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { getPublicSettings, updateSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try {
    return NextResponse.json({ settings: getPublicSettings() }, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const settings = updateSettings(await request.json());
    return NextResponse.json({ settings });
  } catch (error) {
    return errorResponse(error);
  }
}
