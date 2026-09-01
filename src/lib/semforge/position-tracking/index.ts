import { z } from "zod";
import { getDatabase } from "@/lib/db";
import { semforgeError } from "@/lib/semforge/errors";
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
  if (!talordataConfigured()) throw semforgeError("INTERNAL", "TALORDATA_API_TOKEN 이 설정되지 않았습니다.");
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
    SELECT COUNT(*) AS count FROM position_tracking_campaigns WHERE project_id = ? AND domain = ?
  `).get(project.id, domain) as { count: number };
  const audits = sqlite.prepare(`
    SELECT site_health, last_run_at FROM site_audit_campaigns WHERE project_id = ? AND domain = ? ORDER BY updated_at DESC LIMIT 1
  `).get(project.id, domain) as { site_health: number | null; last_run_at: string | null } | undefined;
  return {
    domain,
    locked,
    positionCampaigns: campaigns.count,
    siteHealth: audits?.site_health ?? null,
    lastSiteAuditAt: audits?.last_run_at ?? null,
    gscConnected: Boolean(sqlite.prepare("SELECT id FROM gsc_connections WHERE project_id = ? AND status = 'connected' LIMIT 1").get(project.id)),
  };
}

export function listGscConnections() {
  const project = requireActiveProject();
  const { sqlite } = getDatabase();
  return sqlite.prepare("SELECT id, site_url AS siteUrl, status, updated_at AS updatedAt FROM gsc_connections WHERE project_id = ?").all(project.id);
}

export function listGbpConnections() {
  const project = requireActiveProject();
  const { sqlite } = getDatabase();
  return sqlite.prepare("SELECT id, location_name AS locationName, status, updated_at AS updatedAt FROM gbp_connections WHERE project_id = ?").all(project.id);
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

export function getLocalBusinessOverview() {
  requireActiveProject();
  const locked = (() => { try { requireSemforgeSubscription(); return false; } catch { return true; } })();
  const connections = listGbpConnections();
  return { locked, connections, mapRankAvailable: Boolean(process.env.TALORDATA_API_TOKEN?.trim()) };
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
