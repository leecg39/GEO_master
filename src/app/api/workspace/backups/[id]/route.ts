import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import {
  deleteWorkspaceBackup,
  getWorkspaceBackup,
  updateWorkspaceBackup,
} from "@/lib/workspace-backups";
import { serializeWorkspaceSnapshot, workspaceSnapshotSchema } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params;
    if (request.nextUrl.searchParams.get("download") === "1") {
      const backup = getWorkspaceBackup(id, true) as { name: string; snapshot: unknown };
      const snapshot = workspaceSnapshotSchema.parse(backup.snapshot);
      const body = serializeWorkspaceSnapshot(snapshot);
      return new NextResponse(body, {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": `attachment; filename="geo-backup-${backup.name.replace(/[^\w.-]+/g, "-")}.json"`,
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      });
    }
    return NextResponse.json({ backup: getWorkspaceBackup(id) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ backup: updateWorkspaceBackup(id, await request.json()) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params;
    deleteWorkspaceBackup(id, await request.json());
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
