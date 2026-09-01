import { NextRequest, NextResponse } from "next/server";
import { deleteAudit, getAuditResource, updateAudit } from "@/lib/audit";
import { errorResponse } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AuditContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: AuditContext) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ audit: getAuditResource(id) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest, context: AuditContext) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ audit: updateAudit(id, await request.json()) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest, context: AuditContext) {
  try {
    const { id } = await context.params;
    deleteAudit(id, await request.json());
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
