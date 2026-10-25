import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StudioClient } from "@/components/StudioClient";
import type { StudioContentResource } from "@/components/StudioHistoryPanel";
import { haloEnabled } from "@/lib/halo-feature";
import { knowledgeDocuments, writingProfiles } from "@/lib/library";
import { listOpportunities } from "@/lib/opportunities";
import { requireActiveProject } from "@/lib/projects";
import { getContent } from "@/lib/contents";
export const metadata: Metadata = { title: "콘텐츠 스튜디오" };
export const dynamic = "force-dynamic";
export default async function StudioPage({ searchParams }: { searchParams: Promise<{ opportunityId?: string; contentId?: string }> }) {
  const query = await searchParams, project = requireActiveProject(), enabled = haloEnabled();
  const opportunities = enabled ? listOpportunities().filter(item => item.status === "accepted") : [];
  let initialContent: StudioContentResource | undefined;
  if (query.contentId) {
    try { const content = getContent(query.contentId); if (!["rewrite", "intro", "faq", "entity"].includes(content.tool)) notFound(); initialContent = content as StudioContentResource; } catch { notFound(); }
  }
  return <StudioClient key={`${project.id}:${query.opportunityId ?? ""}:${query.contentId ?? ""}`} projectId={project.id} haloEnabled={enabled}
    documents={enabled ? knowledgeDocuments.list() : []} profiles={enabled ? writingProfiles.list() : []}
    opportunities={opportunities.map(({ id, question }) => ({ id, question }))}
    initialOpportunityId={opportunities.find(item => item.id === Number(query.opportunityId))?.id} initialContent={initialContent} />;
}
