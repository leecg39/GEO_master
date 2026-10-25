import { notFound } from "next/navigation";
import { LibraryClient } from "@/components/LibraryClient";
import { haloEnabled } from "@/lib/halo-feature";
import { knowledgeDocuments, writingProfiles } from "@/lib/library";
import { requireActiveProject } from "@/lib/projects";
export const dynamic = "force-dynamic";
export const metadata = { title: "지식 자료·작성 페르소나" };
export default function LibraryPage() {
  if (!haloEnabled()) notFound();
  const project = requireActiveProject();
  return <LibraryClient key={project.id} projectId={project.id} documents={knowledgeDocuments.list()} profiles={writingProfiles.list()} />;
}
