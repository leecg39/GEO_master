import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/errors";
import { activateProject } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const activateSchema = z.object({}).strict();
type ProjectRouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: ProjectRouteContext) {
  try {
    activateSchema.parse(await request.json());
    const { id } = await context.params;
    return NextResponse.json({ project: activateProject(id) });
  } catch (error) {
    return errorResponse(error);
  }
}
