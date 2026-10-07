import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { listChangeItems } from "@/lib/change-items";
import { errorResponse } from "@/lib/errors";
import { buildApplyGuide } from "@/lib/integrations/qshop-manual";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const editorSchema = z.enum(["site-settings", "blog"]).default("site-settings");

export function GET(request: NextRequest) {
  try {
    const editor = editorSchema.parse(request.nextUrl.searchParams.get("editor") ?? undefined);
    const guide = buildApplyGuide(listChangeItems(), editor);
    if (request.nextUrl.searchParams.get("format") === "md") {
      return new NextResponse(guide.markdown, { headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": 'attachment; filename="qshop-apply-guide.md"', "cache-control": "no-store" } });
    }
    return NextResponse.json({ guide }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
