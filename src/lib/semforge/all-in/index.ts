import { z } from "zod";
import { getDatabase } from "@/lib/db";
import { collectAiVisibility, seedAiVisibilityFromProject } from "@/lib/semforge/ai-visibility";
import { connectGbpLocation, createMapRankCampaign, addMapRankKeyword, collectMapRank, listGbpConnections } from "@/lib/semforge/local-business";
import { getDomainOverview, upsertSite, createPositionCampaign, addTrackedKeyword, collectCampaignRankings } from "@/lib/semforge/position-tracking";
import { createSiteAuditCampaign, firecrawlConfigured, runSiteAuditCampaign } from "@/lib/semforge/siteaudit";
import { normalizeDomain } from "@/lib/semforge/utils/domain";
import { requireSemforgeSubscription } from "@/lib/semforge-subscription";
import { requireActiveProject } from "@/lib/projects";
import { talordataConfigured } from "@/lib/semforge/talordata/client";

export const allInSemforgeSchema = z.object({
  brandName: z.string().trim().min(1).max(120),
  domain: z.string().trim().min(3).max(253),
  locationLabel: z.string().trim().min(1).max(200).optional().default("서울"),
}).strict();

export type AllInStepStatus = "ok" | "skipped" | "error";

export interface AllInStepResult {
  key: string;
  label: string;
  status: AllInStepStatus;
  message: string;
  href: string;
  detail?: unknown;
}

function buildSeedQueries(brandName: string, category: string): string[] {
  const queries = [
    brandName,
    category ? `${brandName} ${category}` : "",
    `${brandName} 추천`,
    `${brandName} 후기`,
    `${brandName} 공식 사이트`,
  ].map((query) => query.trim()).filter((query) => query.length >= 2);
  return [...new Set(queries)].slice(0, 5);
}

function findSiteAuditCampaignId(projectId: number, domain: string): number | null {
  const { sqlite } = getDatabase();
  const row = sqlite.prepare(`
    SELECT id FROM site_audit_campaigns WHERE project_id = ? AND domain = ? ORDER BY updated_at DESC LIMIT 1
  `).get(projectId, domain) as { id: number } | undefined;
  return row?.id ?? null;
}

function findPositionCampaignId(projectId: number, domain: string): number | null {
  const { sqlite } = getDatabase();
  const row = sqlite.prepare(`
    SELECT id FROM position_tracking_campaigns WHERE project_id = ? AND domain = ? ORDER BY updated_at DESC LIMIT 1
  `).get(projectId, domain) as { id: number } | undefined;
  return row?.id ?? null;
}

function findMapRankCampaignId(projectId: number, businessName: string, locationLabel: string): number | null {
  const { sqlite } = getDatabase();
  const row = sqlite.prepare(`
    SELECT id FROM map_rank_campaigns
    WHERE project_id = ? AND business_name = ? AND location_label = ?
    ORDER BY updated_at DESC LIMIT 1
  `).get(projectId, businessName, locationLabel) as { id: number } | undefined;
  return row?.id ?? null;
}

function ensureKeywords(
  add: (campaignId: number, keyword: string) => unknown,
  campaignId: number,
  keywords: string[],
) {
  for (const keyword of keywords) {
    try {
      add(campaignId, keyword);
    } catch {
      // duplicate ok
    }
  }
}

export async function runAllInSemforge(input: unknown): Promise<{
  brandName: string;
  domain: string;
  locationLabel: string;
  steps: AllInStepResult[];
}> {
  requireSemforgeSubscription();
  const project = requireActiveProject();
  const parsed = allInSemforgeSchema.parse(input);
  const domain = normalizeDomain(parsed.domain);
  const brandName = parsed.brandName.trim();
  const locationLabel = parsed.locationLabel?.trim() || "서울";
  const seedQueries = buildSeedQueries(brandName, project.category);
  const steps: AllInStepResult[] = [];

  const site = upsertSite({ domain, name: brandName });
  steps.push({
    key: "site",
    label: "도메인 등록",
    status: "ok",
    message: `${site.domain} 워크스페이스에 연결했습니다.`,
    href: "/analytics/overview",
    detail: site,
  });

  try {
    seedAiVisibilityFromProject(domain, seedQueries);
    if (!talordataConfigured()) {
      steps.push({
        key: "ai-seo",
        label: "AI SEO (SERP)",
        status: "skipped",
        message: "TalorData가 연결되지 않아 쿼리만 등록했습니다.",
        href: "/ai-seo",
      });
    } else {
      const report = await collectAiVisibility({ domain });
      steps.push({
        key: "ai-seo",
        label: "AI SEO (SERP)",
        status: "ok",
        message: `${report.collected}개 쿼리 SERP 실측 완료 · AIO·인용·오가닉 순위 수집`,
        href: "/ai-seo",
        detail: report,
      });
    }
  } catch (error) {
    steps.push({
      key: "ai-seo",
      label: "AI SEO (SERP)",
      status: "error",
      message: error instanceof Error ? error.message : "AI SEO 실행 실패",
      href: "/ai-seo",
    });
  }

  try {
    if (!firecrawlConfigured()) {
      steps.push({
        key: "site-audit",
        label: "사이트 진단",
        status: "skipped",
        message: "Firecrawl이 연결되지 않았습니다. 설정에서 API 키를 추가하세요.",
        href: "/site-audit",
      });
    } else {
      let campaignId = findSiteAuditCampaignId(project.id, domain);
      if (!campaignId) {
        const created = createSiteAuditCampaign({ name: `${brandName} 진단`, domain });
        campaignId = created.id;
      }
      const result = await runSiteAuditCampaign(campaignId);
      steps.push({
        key: "site-audit",
        label: "사이트 진단",
        status: "ok",
        message: `크롤 완료 · ${result.crawledPages ?? 0}페이지 · 건강 ${result.siteHealth ?? "—"}점`,
        href: "/site-audit",
        detail: result,
      });
    }
  } catch (error) {
    steps.push({
      key: "site-audit",
      label: "사이트 진단",
      status: "error",
      message: error instanceof Error ? error.message : "사이트 진단 실패",
      href: "/site-audit",
    });
  }

  try {
    let campaignId = findPositionCampaignId(project.id, domain);
    if (!campaignId) {
      const created = createPositionCampaign({ name: `${brandName} SERP`, domain });
      campaignId = created.id;
    }
    ensureKeywords(
      (id, keyword) => addTrackedKeyword({ campaignId: id, keyword }),
      campaignId,
      seedQueries.slice(0, 3),
    );
    if (!talordataConfigured()) {
      steps.push({
        key: "position-tracking",
        label: "포지션 추적",
        status: "skipped",
        message: "TalorData 미연결 · 키워드만 등록했습니다.",
        href: "/position-tracking",
      });
    } else {
      const report = await collectCampaignRankings(campaignId);
      steps.push({
        key: "position-tracking",
        label: "포지션 추적",
        status: "ok",
        message: `순위 수집 ${report.collected}건 · 가시성 ${report.visibility}%`,
        href: "/position-tracking",
        detail: report,
      });
    }
  } catch (error) {
    steps.push({
      key: "position-tracking",
      label: "포지션 추적",
      status: "error",
      message: error instanceof Error ? error.message : "포지션 추적 실패",
      href: "/position-tracking",
    });
  }

  try {
    const overview = getDomainOverview(domain);
    steps.push({
      key: "analytics-overview",
      label: "도메인 개요",
      status: "ok",
      message: `포지션 캠페인 ${overview.positionCampaigns} · 사이트 건강 ${overview.siteHealth ?? "—"}`,
      href: "/analytics/overview",
      detail: overview,
    });
  } catch (error) {
    steps.push({
      key: "analytics-overview",
      label: "도메인 개요",
      status: "error",
      message: error instanceof Error ? error.message : "도메인 개요 조회 실패",
      href: "/analytics/overview",
    });
  }

  try {
    const existingGbp = listGbpConnections().find((item) => item.locationName === brandName);
    if (!existingGbp) {
      connectGbpLocation({ locationName: brandName, address: locationLabel });
    }
    let campaignId = findMapRankCampaignId(project.id, brandName, locationLabel);
    if (!campaignId) {
      const created = createMapRankCampaign({
        name: `${brandName} 지역`,
        businessName: brandName,
        locationLabel,
      });
      campaignId = created.id;
    }
    ensureKeywords(
      (id, keyword) => addMapRankKeyword({ campaignId: id, keyword }),
      campaignId,
      [`${brandName} ${locationLabel}`, `${brandName} 추천`, seedQueries[0] ?? brandName].filter(Boolean),
    );
    if (!talordataConfigured()) {
      steps.push({
        key: "local-business",
        label: "지역 SEO",
        status: "skipped",
        message: "TalorData 미연결 · GBP·키워드만 등록했습니다.",
        href: "/local-business",
      });
    } else {
      const report = await collectMapRank(campaignId);
      steps.push({
        key: "local-business",
        label: "지역 SEO",
        status: "ok",
        message: `Map Rank 수집 ${report.collected}건 · 가시성 ${report.visibility}%`,
        href: "/local-business",
        detail: report,
      });
    }
  } catch (error) {
    steps.push({
      key: "local-business",
      label: "지역 SEO",
      status: "error",
      message: error instanceof Error ? error.message : "지역 SEO 실패",
      href: "/local-business",
    });
  }

  return { brandName, domain, locationLabel, steps };
}
