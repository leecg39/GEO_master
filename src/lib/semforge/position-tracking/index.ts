import { z } from "zod";
import { getDatabase } from "@/lib/db";
import { semforgeError, providerFailure, blocksProviderBatch, type ProviderFailure } from "@/lib/semforge/errors";
import { collectionCounts } from "@/lib/semforge/collection-report";
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
  const keyword = parsed.keyword.replace(/\s+/g, " ");
  const existing = sqlite.prepare("SELECT keyword FROM tracked_keywords WHERE campaign_id = ? AND deleted_at IS NULL")
    .all(parsed.campaignId) as Array<{ keyword: string }>;
  if (existing.some((item) => item.keyword.trim().replace(/\s+/g, " ").toLowerCase() === keyword.toLowerCase())) {
    throw semforgeError("DUPLICATE", "이미 추적 중인 키워드입니다.");
  }
  const now = new Date().toISOString();
  const result = sqlite.prepare(`
    INSERT INTO tracked_keywords (campaign_id, keyword, created_at, updated_at) VALUES (?, ?, ?, ?)
  `).run(parsed.campaignId, keyword, now, now);
  return { id: Number(result.lastInsertRowid), keyword };
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
  if (keywords.length === 0) throw semforgeError("VALIDATION_ERROR", "수집할 추적 키워드가 없습니다.");
  const outcomes = [];
  let blockingError: ProviderFailure | undefined;
  for (const kw of keywords) {
    if (blockingError) {
      outcomes.push({ keyword: kw.keyword, position: kw.position, error: blockingError.message, errorCode: blockingError.code, skipped: true });
      continue;
    }
    try {
      const serp = await fetchSerp({ q: kw.keyword, device: campaign.device as "desktop" | "mobile", engine: campaign.search_engine as "google" | "bing" });
      const hit = serp.organic.find((item) => item.domain === campaign.domain || item.domain.endsWith(`.${campaign.domain}`));
      const now = new Date().toISOString();
      sqlite.prepare(`
        UPDATE tracked_keywords SET previous_position = position, position = ?, updated_at = ? WHERE id = ?
      `).run(hit?.position ?? null, now, kw.id);
      outcomes.push({ keyword: kw.keyword, position: hit?.position ?? null, error: undefined });
    } catch (error) {
      const failure = providerFailure(error);
      if (blocksProviderBatch(failure)) blockingError = failure;
      outcomes.push({ keyword: kw.keyword, position: kw.position, error: failure.message, errorCode: failure.code });
    }
  }
  const counts = collectionCounts(outcomes);
  const ranked = outcomes.filter((o) => !o.error && o.position !== null && o.position !== undefined).length;
  const visibility = counts.collected === keywords.length ? Math.round((ranked / keywords.length) * 100) : null;
  // Failed/partial runs cannot establish a new campaign-wide visibility value.
  if (visibility !== null) sqlite.prepare("UPDATE position_tracking_campaigns SET visibility = ?, updated_at = ? WHERE id = ?").run(visibility, new Date().toISOString(), campaignId);
  return { campaignId, visibility, ...counts, outcomes, blockingError };
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

export function connectGscPlaceholder(siteUrl: string) {
  requireSemforgeSubscription();
  z.string().url().parse(siteUrl);
  throw semforgeError("INTERNAL", "GSC OAuth 연결은 아직 구현되지 않았습니다.");
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
