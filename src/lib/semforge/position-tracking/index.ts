import { z } from "zod";
import { getDatabase } from "@/lib/db";
import type { DomainAnalyticsDashboardData } from "@/lib/semforge/domain-overview";
import { semforgeError } from "@/lib/semforge/errors";
import { buildPositionTrackingBriefing } from "@/lib/semforge/position-tracking/briefing";
import { fetchSerp, talordataConfigured } from "@/lib/semforge/talordata/client";
import { normalizeDomain } from "@/lib/semforge/utils/domain";
import { requireSemforgeSubscription } from "@/lib/semforge-subscription";
import { requireActiveProject } from "@/lib/projects";

export function listPositionCampaigns() {
  const project = requireActiveProject();
  const { sqlite } = getDatabase();
  return sqlite.prepare(`
    SELECT id, name, domain, search_engine AS searchEngine, device, location, visibility, updated_at AS updatedAt
    FROM position_tracking_campaigns WHERE project_id = ? ORDER BY updated_at DESC, id DESC
  `).all(project.id);
}

export const campaignCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  domain: z.string().trim().min(3).max(253),
  searchEngine: z.enum(["google", "bing"]).optional().default("google"),
  device: z.enum(["desktop", "mobile"]).optional().default("desktop"),
}).strict();

export function createPositionCampaign(input: unknown) {
  requireSemforgeSubscription();
  const project = requireActiveProject();
  const parsed = campaignCreateSchema.parse(input);
  const domain = normalizeDomain(parsed.domain);
  const now = new Date().toISOString();
  const { sqlite } = getDatabase();
  const result = sqlite.prepare(`
    INSERT INTO position_tracking_campaigns (project_id, name, domain, search_engine, device, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(project.id, parsed.name, domain, parsed.searchEngine, parsed.device, now, now);
  return { id: Number(result.lastInsertRowid), name: parsed.name, domain };
}

export const keywordCreateSchema = z.object({
  campaignId: z.coerce.number().int().positive(),
  keyword: z.string().trim().min(1).max(200),
}).strict();

export function addTrackedKeyword(input: unknown) {
  requireSemforgeSubscription();
  const project = requireActiveProject();
  const parsed = keywordCreateSchema.parse(input);
  const { sqlite } = getDatabase();
  const campaign = sqlite.prepare("SELECT id FROM position_tracking_campaigns WHERE id = ? AND project_id = ?").get(parsed.campaignId, project.id);
  if (!campaign) throw semforgeError("NOT_FOUND", "캠페인을 찾을 수 없습니다.");
  const now = new Date().toISOString();
  const result = sqlite.prepare(`
    INSERT INTO tracked_keywords (campaign_id, keyword, created_at, updated_at) VALUES (?, ?, ?, ?)
  `).run(parsed.campaignId, parsed.keyword, now, now);
  return { id: Number(result.lastInsertRowid), keyword: parsed.keyword };
}

export function listTrackedKeywords(campaignIdInput: unknown) {
  const project = requireActiveProject();
  const campaignId = z.coerce.number().int().positive().parse(campaignIdInput);
  const { sqlite } = getDatabase();
  const campaign = sqlite.prepare("SELECT id FROM position_tracking_campaigns WHERE id = ? AND project_id = ?").get(campaignId, project.id);
  if (!campaign) throw semforgeError("NOT_FOUND", "캠페인을 찾을 수 없습니다.");
  return sqlite.prepare(`
    SELECT id, keyword, position, previous_position AS previousPosition, updated_at AS updatedAt
    FROM tracked_keywords WHERE campaign_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC
  `).all(campaignId);
}

export async function collectCampaignRankings(campaignIdInput: unknown) {
  requireSemforgeSubscription();
  if (!talordataConfigured()) throw semforgeError("INTERNAL", "TalorData API 토큰이 설정되지 않았습니다. 설정 화면에서 저장하거나 .env.local 에 TALORDATA_API_TOKEN 을 추가하세요.");
  const project = requireActiveProject();
  const campaignId = z.coerce.number().int().positive().parse(campaignIdInput);
  const { sqlite } = getDatabase();
  const campaign = sqlite.prepare(`
    SELECT * FROM position_tracking_campaigns WHERE id = ? AND project_id = ?
  `).get(campaignId, project.id) as { id: number; domain: string; device: string; search_engine: string } | undefined;
  if (!campaign) throw semforgeError("NOT_FOUND", "캠페인을 찾을 수 없습니다.");
  const keywords = sqlite.prepare(`
    SELECT id, keyword, position FROM tracked_keywords WHERE campaign_id = ? AND deleted_at IS NULL LIMIT 20
  `).all(campaignId) as Array<{ id: number; keyword: string; position: number | null }>;
  const outcomes = [];
  for (const kw of keywords) {
    try {
      const serp = await fetchSerp({ q: kw.keyword, device: campaign.device as "desktop" | "mobile", engine: campaign.search_engine as "google" | "bing" });
      const hit = serp.organic.find((item) => item.domain === campaign.domain || item.domain.endsWith(`.${campaign.domain}`));
      const now = new Date().toISOString();
      sqlite.prepare(`
        UPDATE tracked_keywords SET previous_position = position, position = ?, updated_at = ? WHERE id = ?
      `).run(hit?.position ?? null, now, kw.id);
      outcomes.push({ keyword: kw.keyword, position: hit?.position ?? null });
    } catch (error) {
      outcomes.push({ keyword: kw.keyword, position: kw.position, error: error instanceof Error ? error.message : "실패" });
    }
  }
  const ranked = outcomes.filter((o) => o.position !== null && o.position !== undefined).length;
  const visibility = keywords.length ? Math.round((ranked / keywords.length) * 100) : 0;
  sqlite.prepare("UPDATE position_tracking_campaigns SET visibility = ?, updated_at = ? WHERE id = ?").run(visibility, new Date().toISOString(), campaignId);
  return { campaignId, visibility, collected: outcomes.filter((o) => !("error" in o && o.error)).length, outcomes };
}

export function getDomainOverview(domainInput: string) {
  const project = requireActiveProject();
  const domain = normalizeDomain(domainInput);
  const locked = (() => { try { requireSemforgeSubscription(); return false; } catch { return true; } })();
  const { sqlite } = getDatabase();
  const campaigns = sqlite.prepare(`
    SELECT id, name, visibility, updated_at AS updatedAt
    FROM position_tracking_campaigns WHERE project_id = ? AND domain = ?
    ORDER BY updated_at DESC, id DESC
  `).all(project.id, domain) as Array<{ id: number; name: string; visibility: number; updatedAt: string | null }>;
  const campaignSummaries = campaigns.map((campaign) => {
    const keywordCount = (sqlite.prepare(`
      SELECT COUNT(*) AS count FROM tracked_keywords WHERE campaign_id = ? AND deleted_at IS NULL
    `).get(campaign.id) as { count: number }).count;
    return { ...campaign, keywordCount };
  });
  const primary = campaignSummaries[0] ?? null;
  const keywords = primary
    ? sqlite.prepare(`
        SELECT id, keyword, position, previous_position AS previousPosition, updated_at AS updatedAt
        FROM tracked_keywords WHERE campaign_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC
      `).all(primary.id) as Array<{ id: number; keyword: string; position: number | null; previousPosition: number | null; updatedAt: string | null }>
    : [];
  const briefing = primary ? buildPositionTrackingBriefing(keywords, primary.visibility) : null;

  const audits = sqlite.prepare(`
    SELECT id, name, site_health AS siteHealth, status, last_run_at AS lastRunAt
    FROM site_audit_campaigns WHERE project_id = ? AND domain = ?
    ORDER BY updated_at DESC LIMIT 8
  `).all(project.id, domain) as Array<{ id: number; name: string; siteHealth: number | null; status: string; lastRunAt: string | null }>;
  const latestAudit = audits[0];

  const aiQueries = sqlite.prepare(`
    SELECT id FROM ai_visibility_queries WHERE project_id = ? AND domain = ? AND deleted_at IS NULL
  `).all(project.id, domain) as Array<{ id: number }>;
  let collectedCount = 0;
  let aioCount = 0;
  let citedCount = 0;
  let lastCollectedAt: string | null = null;
  for (const query of aiQueries) {
    const snapshot = sqlite.prepare(`
      SELECT aio_present, cited, captured_at FROM ai_visibility_snapshots
      WHERE query_id = ? ORDER BY captured_at DESC, id DESC LIMIT 1
    `).get(query.id) as { aio_present: number; cited: number | null; captured_at: string } | undefined;
    if (!snapshot) continue;
    collectedCount += 1;
    if (snapshot.aio_present) aioCount += 1;
    if (snapshot.cited === 1) citedCount += 1;
    if (!lastCollectedAt || snapshot.captured_at > lastCollectedAt) lastCollectedAt = snapshot.captured_at;
  }

  const gscConnected = Boolean(sqlite.prepare("SELECT id FROM gsc_connections WHERE project_id = ? AND status = 'connected' LIMIT 1").get(project.id));
  const narratives: string[] = [];
  const recommendations: string[] = [];
  if (briefing?.ready) {
    narratives.push(...briefing.narratives.slice(0, 2));
    recommendations.push(...briefing.recommendations.slice(0, 2));
  } else if (primary) {
    narratives.push(`포지션 캠페인 「${primary.name}」이 연결되어 있습니다. 순위 수집 후 가시성 차트가 채워집니다.`);
    recommendations.push("포지션 추적에서 키워드를 추가하고 순위 수집을 실행하세요.");
  } else {
    narratives.push("이 도메인에 포지션 캠페인이 없습니다.");
    recommendations.push("포지션 추적에서 캠페인을 추가하세요.");
  }
  if (aiQueries.length) {
    narratives.push(`AI SEO 질의 ${aiQueries.length}개 · 수집 ${collectedCount} · AIO ${aioCount} · 인용 ${citedCount}.`);
  } else {
    recommendations.push("AI SEO에서 도메인 질의를 등록해 AI Overview 인용을 추적하세요.");
  }
  if (!latestAudit) recommendations.push("사이트 진단 캠페인을 만들고 Firecrawl 크롤을 실행하세요.");
  else if (latestAudit.siteHealth == null) recommendations.push("사이트 진단 캠페인을 실행해 건강 점수를 채우세요.");
  if (!gscConnected) recommendations.push("GSC 연결을 설정하면 Search Console 신호를 개요에 합칠 수 있습니다.");

  const dashboard: DomainAnalyticsDashboardData = {
    domain,
    gscConnected,
    siteHealth: latestAudit?.siteHealth ?? null,
    lastSiteAuditAt: latestAudit?.lastRunAt ?? null,
    position: {
      campaignCount: campaignSummaries.length,
      primary: primary
        ? { id: primary.id, name: primary.name, visibility: primary.visibility, updatedAt: primary.updatedAt }
        : null,
      briefing,
      campaigns: campaignSummaries,
    },
    aiSeo: {
      queryCount: aiQueries.length,
      collectedCount,
      aioCount,
      citedCount,
      lastCollectedAt,
    },
    siteAudits: audits,
    narratives: narratives.slice(0, 5),
    recommendations: recommendations.slice(0, 5),
    links: [
      { href: "/position-tracking", label: "포지션 추적", description: "키워드 순위·가시성" },
      { href: "/ai-seo", label: "AI SEO", description: "AIO 출현·인용" },
      { href: "/site-audit", label: "사이트 진단", description: "Firecrawl 건강 점수" },
      { href: "/local-business", label: "지역 SEO", description: "GBP · Map Rank" },
    ],
  };

  return {
    domain,
    locked,
    positionCampaigns: campaignSummaries.length,
    siteHealth: latestAudit?.siteHealth ?? null,
    lastSiteAuditAt: latestAudit?.lastRunAt ?? null,
    gscConnected,
    dashboard,
  };
}

export function listGscConnections() {
  const project = requireActiveProject();
  const { sqlite } = getDatabase();
  return sqlite.prepare("SELECT id, site_url AS siteUrl, status, updated_at AS updatedAt FROM gsc_connections WHERE project_id = ?").all(project.id);
}

export function connectGscPlaceholder(siteUrl: string) {
  requireSemforgeSubscription();
  const project = requireActiveProject();
  const configured = Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());
  if (!configured) throw semforgeError("INTERNAL", "Google OAuth 환경 변수가 설정되지 않았습니다.");
  const now = new Date().toISOString();
  const { sqlite } = getDatabase();
  sqlite.prepare(`
    INSERT INTO gsc_connections (project_id, site_url, status, created_at, updated_at) VALUES (?, ?, 'pending_oauth', ?, ?)
  `).run(project.id, siteUrl, now, now);
  return { oauthUrl: `/api/semforge/gsc/oauth?site=${encodeURIComponent(siteUrl)}`, status: "pending_oauth" };
}

export function listSites() {
  const project = requireActiveProject();
  const { sqlite } = getDatabase();
  return sqlite.prepare("SELECT id, domain, name, updated_at AS updatedAt FROM sites WHERE project_id = ? ORDER BY updated_at DESC").all(project.id);
}

export function upsertSite(input: { domain: string; name?: string }) {
  requireSemforgeSubscription();
  const project = requireActiveProject();
  const domain = normalizeDomain(input.domain);
  const now = new Date().toISOString();
  const { sqlite } = getDatabase();
  const existing = sqlite.prepare("SELECT id FROM sites WHERE project_id = ? AND domain = ?").get(project.id, domain) as { id: number } | undefined;
  if (existing) {
    sqlite.prepare("UPDATE sites SET name = ?, updated_at = ? WHERE id = ?").run(input.name ?? domain, now, existing.id);
    sqlite.prepare("UPDATE projects SET domain = ?, updated_at = ? WHERE id = ?").run(domain, now, project.id);
    return { id: existing.id, domain, name: input.name ?? domain };
  }
  const result = sqlite.prepare(`
    INSERT INTO sites (project_id, domain, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
  `).run(project.id, domain, input.name ?? domain, now, now);
  sqlite.prepare("UPDATE projects SET domain = ?, updated_at = ? WHERE id = ?").run(domain, now, project.id);
  return { id: Number(result.lastInsertRowid), domain, name: input.name ?? domain };
}
