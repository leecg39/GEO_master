import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { getPublicSettings, providers } from "@/lib/settings";

export const dynamic = "force-dynamic";

// Only the inputs needed by measurement/editor screens. No settings, key hints, or billing details.
export function GET() {
  try {
    const settings = getPublicSettings();
    return NextResponse.json({ settings: {
      brandName: settings.brandName, category: settings.category, repetitions: settings.repetitions,
      apiKeys: Object.fromEntries(providers.map((provider) => [provider, { configured: settings.apiKeys[provider].configured }])),
    } }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
