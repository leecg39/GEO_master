import { z } from "zod";
import { getDatabase } from "@/lib/db";
import { semforgeError } from "@/lib/semforge/errors";
import { fetchSerp, talordataConfigured, talordataMode } from "@/lib/semforge/talordata/client";
import { requireSemforgeSubscription } from "@/lib/semforge-subscription";
import { requireActiveProject } from "@/lib/projects";

function businessMatches(title: string, businessName: string): boolean {
  const normalizedTitle = title.trim().toLowerCase();
  const normalizedBusiness = businessName.trim().toLowerCase();
  if (!normalizedTitle || !normalizedBusiness) return false;
  return normalizedTitle.includes(normalizedBusiness) || normalizedBusiness.includes(normalizedTitle);
}

export function listGbpConnections() {
  const project = requireActiveProject();
  const { sqlite } = getDatabase();
  return sqlite.prepare(`
    SELECT id, location_name AS locationName, address, status, updated_at AS updatedAt
    FROM gbp_connections WHERE project_id = ? ORDER BY updated_at DESC, id DESC
  `).all(project.id) as Array<{ id: number; locationName: string; address: string; status: string; updatedAt: string }>;
}

export const gbpConnectSchema = z.object({
  locationName: z.string().trim().min(1).max(200),
  address: z.string().trim().max(500).optional().default(""),
}).strict();

export function connectGbpLocation(input: unknown) {
  requireSemforgeSubscription();
  const project = requireActiveProject();
  const parsed = gbpConnectSchema.parse(input);
  const googleConfigured = Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());
  const now = new Date().toISOString();
  const { sqlite } = getDatabase();
  const result = sqlite.prepare(`
    INSERT INTO gbp_connections (project_id, location_name, address, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    project.id,
    parsed.locationName,
    parsed.address,
    googleConfigured ? "pending_oauth" : "connected",
    now,
    now,
  );
  return {
    id: Number(result.lastInsertRowid),
    locationName: parsed.locationName,
    address: parsed.address,
    status: googleConfigured ? "pending_oauth" as const : "connected" as const,
    oauthUrl: googleConfigured ? `/api/semforge/gbp/oauth?location=${encodeURIComponent(parsed.locationName)}` : null,
  };
}

export function removeGbpConnection(idInput: unknown) {
  requireSemforgeSubscription();
  const project = requireActiveProject();
  const id = z.coerce.number().int().positive().parse(idInput);
  const { sqlite } = getDatabase();
  const row = sqlite.prepare("SELECT id FROM gbp_connections WHERE id = ? AND project_id = ?").get(id, project.id);
  if (!row) throw semforgeError("NOT_FOUND", "GBP 연결을 찾을 수 없습니다.");
  sqlite.prepare("DELETE FROM gbp_connections WHERE id = ?").run(id);
  return { id, deleted: true };
}

export function listMapRankCampaigns() {
  const project = requireActiveProject();
  const { sqlite } = getDatabase();
  return sqlite.prepare(`
    SELECT id, gbp_connection_id AS gbpConnectionId, name, business_name AS businessName,
           location_label AS locationLabel, visibility, updated_at AS updatedAt
    FROM map_rank_campaigns WHERE project_id = ? ORDER BY updated_at DESC, id DESC
  `).all(project.id);
}

export const mapRankCampaignCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  businessName: z.string().trim().min(1).max(200),
  locationLabel: z.string().trim().min(1).max(200),
  gbpConnectionId: z.coerce.number().int().positive().optional(),
}).strict();

export function createMapRankCampaign(input: unknown) {
  requireSemforgeSubscription();
  const project = requireActiveProject();
  const parsed = mapRankCampaignCreateSchema.parse(input);
  const { sqlite } = getDatabase();
  if (parsed.gbpConnectionId) {
    const gbp = sqlite.prepare("SELECT id FROM gbp_connections WHERE id = ? AND project_id = ?").get(parsed.gbpConnectionId, project.id);
    if (!gbp) throw semforgeError("NOT_FOUND", "GBP 연결을 찾을 수 없습니다.");
  }
  const now = new Date().toISOString();
  const result = sqlite.prepare(`
    INSERT INTO map_rank_campaigns (project_id, gbp_connection_id, name, business_name, location_label, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    project.id,
    parsed.gbpConnectionId ?? null,
    parsed.name,
    parsed.businessName,
    parsed.locationLabel,
    now,
    now,
  );
  return { id: Number(result.lastInsertRowid), ...parsed };
}

export const mapRankKeywordCreateSchema = z.object({
  campaignId: z.coerce.number().int().positive(),
  keyword: z.string().trim().min(1).max(200),
}).strict();

export function addMapRankKeyword(input: unknown) {
  requireSemforgeSubscription();
  const project = requireActiveProject();
  const parsed = mapRankKeywordCreateSchema.parse(input);
  const { sqlite } = getDatabase();
  const campaign = sqlite.prepare("SELECT id FROM map_rank_campaigns WHERE id = ? AND project_id = ?").get(parsed.campaignId, project.id);
  if (!campaign) throw semforgeError("NOT_FOUND", "Map Rank 캠페인을 찾을 수 없습니다.");
  const now = new Date().toISOString();
  const result = sqlite.prepare(`
    INSERT INTO map_rank_keywords (campaign_id, keyword, created_at, updated_at) VALUES (?, ?, ?, ?)
  `).run(parsed.campaignId, parsed.keyword, now, now);
  return { id: Number(result.lastInsertRowid), keyword: parsed.keyword };
}

export function listMapRankKeywords(campaignIdInput: unknown) {
  const project = requireActiveProject();
  const campaignId = z.coerce.number().int().positive().parse(campaignIdInput);
  const { sqlite } = getDatabase();
  const campaign = sqlite.prepare("SELECT id FROM map_rank_campaigns WHERE id = ? AND project_id = ?").get(campaignId, project.id);
  if (!campaign) throw semforgeError("NOT_FOUND", "Map Rank 캠페인을 찾을 수 없습니다.");
  return (sqlite.prepare(`
    SELECT id, keyword, map_position AS mapPosition, previous_map_position AS previousMapPosition,
           in_local_pack AS inLocalPack, updated_at AS updatedAt
    FROM map_rank_keywords WHERE campaign_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC
  `).all(campaignId) as Array<{
    id: number;
    keyword: string;
    mapPosition: number | null;
    previousMapPosition: number | null;
    inLocalPack: number;
    updatedAt: string;
  }>).map((row) => ({ ...row, inLocalPack: Boolean(row.inLocalPack) }));
}

export async function collectMapRank(campaignIdInput: unknown) {
  requireSemforgeSubscription();
  if (!talordataConfigured()) {
    throw semforgeError("INTERNAL", "TalorData API 토큰이 설정되지 않았습니다. 설정 화면에서 저장하거나 .env.local 에 TALORDATA_API_TOKEN 을 추가하세요.");
  }
  const project = requireActiveProject();
  const campaignId = z.coerce.number().int().positive().parse(campaignIdInput);
  const { sqlite } = getDatabase();
  const campaign = sqlite.prepare(`
    SELECT id, business_name AS businessName, location_label AS locationLabel
    FROM map_rank_campaigns WHERE id = ? AND project_id = ?
  `).get(campaignId, project.id) as { id: number; businessName: string; locationLabel: string } | undefined;
  if (!campaign) throw semforgeError("NOT_FOUND", "Map Rank 캠페인을 찾을 수 없습니다.");

  const keywords = sqlite.prepare(`
    SELECT id, keyword, map_position AS mapPosition FROM map_rank_keywords
    WHERE campaign_id = ? AND deleted_at IS NULL LIMIT 20
  `).all(campaignId) as Array<{ id: number; keyword: string; mapPosition: number | null }>;

  const outcomes = [];
  for (const item of keywords) {
    try {
      const serp = await fetchSerp({
        q: `${item.keyword} ${campaign.locationLabel}`,
        device: "mobile",
        gl: "kr",
        hl: "ko",
      });
      const hit = serp.localPack.find((entry) => businessMatches(entry.title, campaign.businessName));
      const now = new Date().toISOString();
      sqlite.prepare(`
        UPDATE map_rank_keywords
        SET previous_map_position = map_position, map_position = ?, in_local_pack = ?, updated_at = ?
        WHERE id = ?
      `).run(hit?.position ?? null, hit ? 1 : 0, now, item.id);
      outcomes.push({ keyword: item.keyword, mapPosition: hit?.position ?? null, inLocalPack: Boolean(hit) });
    } catch (error) {
      outcomes.push({
        keyword: item.keyword,
        mapPosition: item.mapPosition,
        inLocalPack: false,
        error: error instanceof Error ? error.message : "실패",
      });
    }
  }

  const ranked = outcomes.filter((item) => item.mapPosition !== null && item.mapPosition !== undefined).length;
  const visibility = keywords.length ? Math.round((ranked / keywords.length) * 100) : 0;
  sqlite.prepare("UPDATE map_rank_campaigns SET visibility = ?, updated_at = ? WHERE id = ?").run(visibility, new Date().toISOString(), campaignId);
  return { campaignId, visibility, collected: outcomes.filter((item) => !("error" in item && item.error)).length, outcomes };
}

export function getLocalBusinessOverview() {
  requireActiveProject();
  const locked = (() => { try { requireSemforgeSubscription(); return false; } catch { return true; } })();
  const mode = talordataMode();
  return {
    locked,
    connections: listGbpConnections(),
    campaigns: listMapRankCampaigns(),
    mapRankAvailable: mode !== "unavailable",
    talordata: mode === "live"
      ? { status: "live" as const, source: "talordata", configured: true }
      : mode === "mock"
        ? { status: "mock" as const, source: "mock-dev", configured: true, reason: "SEMFORGE_MOCK_TALORDATA=1 데모 SERP" }
        : { status: "unavailable" as const, source: "talordata", configured: false, reason: "TalorData API 토큰이 설정되지 않았습니다." },
    googleOAuthConfigured: Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim()),
  };
}
