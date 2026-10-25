import { NextRequest, NextResponse } from "next/server";
import { requireHaloProject } from "@/lib/halo-feature";
import { errorResponse } from "@/lib/errors";
import { createOpportunity, listOpportunities } from "@/lib/opportunities";
import { requireActiveProject } from "@/lib/projects";
import { getDatabase } from "@/lib/db";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: NextRequest) {
  try { requireHaloProject(request);
    const items = listOpportunities(), project = requireActiveProject(), { sqlite } = getDatabase();
    return NextResponse.json({ items, projectId: project.id,
      questionSets: sqlite.prepare("SELECT id, name FROM question_sets WHERE project_id = ? ORDER BY id").all(project.id),
      runs: sqlite.prepare("SELECT id, title, COALESCE(completed_at, created_at) AS at FROM measure_runs WHERE project_id = ? AND status = 'completed' ORDER BY id DESC").all(project.id),
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: NextRequest) {
  try { const input = await request.json(); requireHaloProject(request); return NextResponse.json({ item: createOpportunity(input) }, { status: 201 }); } catch (error) { return errorResponse(error); }
}
