import { notFound } from "next/navigation";
import { OpportunitiesClient, type OpportunityOptions } from "@/components/OpportunitiesClient";
import { haloEnabled } from "@/lib/halo-feature";
import { listOpportunities } from "@/lib/opportunities";
import { requireActiveProject } from "@/lib/projects";
import { getDatabase } from "@/lib/db";
export const dynamic = "force-dynamic";
export const metadata = { title: "기회 발굴" };
export default function OpportunitiesPage() {
  if (!haloEnabled()) notFound();
  const project = requireActiveProject(), { sqlite } = getDatabase();
  const options: OpportunityOptions = {
    questionSets: sqlite.prepare("SELECT id, name FROM question_sets WHERE project_id = ? ORDER BY id").all(project.id) as OpportunityOptions["questionSets"],
    runs: sqlite.prepare("SELECT id, title, COALESCE(completed_at, created_at) AS at FROM measure_runs WHERE project_id = ? AND status = 'completed' ORDER BY id DESC").all(project.id) as OpportunityOptions["runs"],
  };
  return <OpportunitiesClient key={project.id} projectId={project.id} initialItems={listOpportunities()} options={options} />;
}
