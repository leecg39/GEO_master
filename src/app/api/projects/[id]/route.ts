import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { deleteProject, getProjectDetail, updateProject } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProjectRouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: ProjectRouteContext) {
  try {
    const { id } = await context.params;
    return NextResponse.json(getProjectDetail(id), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest, context: ProjectRouteContext) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ project: updateProject(id, await request.json()) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest, context: ProjectRouteContext) {
  try {
    const { id } = await context.params;
    deleteProject(id, await request.json());
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
