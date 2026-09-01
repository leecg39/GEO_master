import { z } from "zod";
import { transactionalMutation } from "@/lib/crud";
import { getDatabase } from "@/lib/db";
import { semforgeError } from "@/lib/semforge/errors";
import { normalizeDomain } from "@/lib/semforge/utils/domain";
import { requireSemforgeSubscription } from "@/lib/semforge-subscription";
import { requireActiveProject } from "@/lib/projects";
import { providerUnavailable, providerLive } from "@/lib/semforge/providers/types";

function firecrawlConfigured() {
  return Boolean(process.env.FIRECRAWL_API_KEY?.trim());
}

export function listSiteAuditCampaigns() {
  const project = requireActiveProject();
  const { sqlite } = getDatabase();
  return sqlite.prepare(`
    SELECT id, name, domain, status, site_health AS siteHealth, last_run_at AS lastRunAt, created_at AS createdAt
    FROM site_audit_campaigns WHERE project_id = ? ORDER BY updated_at DESC, id DESC
  `).all(project.id) as Array<{ id: number; name: string; domain: string; status: string; siteHealth: number | null; lastRunAt: string | null; createdAt: string }>;
}

export const siteAuditCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  domain: z.string().trim().min(3).max(253),
}).strict();

export function createSiteAuditCampaign(input: unknown) {
  requireSemforgeSubscription();
  const project = requireActiveProject();
  const parsed = siteAuditCreateSchema.parse(input);
  const domain = normalizeDomain(parsed.domain);
  const now = new Date().toISOString();
  const { sqlite } = getDatabase();
  const result = sqlite.prepare(`
    INSERT INTO site_audit_campaigns (project_id, name, domain, status, created_at, updated_at)
    VALUES (?, ?, ?, 'idle', ?, ?)
  `).run(project.id, parsed.name, domain, now, now);
  return { id: Number(result.lastInsertRowid), name: parsed.name, domain, status: "idle" };
}

export async function runSiteAuditCampaign(idInput: unknown) {
  requireSemforgeSubscription();
  const project = requireActiveProject();
  const id = z.coerce.number().int().positive().parse(idInput);
  const { sqlite } = getDatabase();
  const campaign = sqlite.prepare(`
    SELECT * FROM site_audit_campaigns WHERE id = ? AND project_id = ?
  `).get(id, project.id) as { id: number; domain: string; name: string } | undefined;
  if (!campaign) throw semforgeError("NOT_FOUND", "사이트 진단 캠페인을 찾을 수 없습니다.");

  if (!firecrawlConfigured()) {
    return {
      campaignId: id,
      status: "unavailable" as const,
      reason: "FIRECRAWL_API_KEY 가 서버에 설정되지 않았습니다.",
      provider: providerUnavailable("firecrawl", "Firecrawl API 키 필요"),
    };
  }

  const apiKey = process.env.FIRECRAWL_API_KEY!.trim();
  const target = `https://${campaign.domain}`;
  const response = await fetch("https://api.firecrawl.dev/v1/map", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url: target, limit: 25 }),
    cache: "no-store",
  });
  if (!response.ok) {
    throw semforgeError("INTERNAL", `Firecrawl 요청이 실패했습니다 (HTTP ${response.status}).`);
  }
  const payload = await response.json() as { links?: string[] };
  const links = Array.isArray(payload.links) ? payload.links.slice(0, 25) : [];
  const now = new Date().toISOString();
  return transactionalMutation(sqlite, () => {
    sqlite.prepare("DELETE FROM site_audit_pages WHERE campaign_id = ?").run(id);
    sqlite.prepare("DELETE FROM site_audit_issues WHERE campaign_id = ?").run(id);
    let errors = 0;
    for (const [index, url] of links.entries()) {
      sqlite.prepare(`
        INSERT INTO site_audit_pages (campaign_id, url, status_code, title, depth, response_ms, bytes, captured_at)
        VALUES (?, ?, 200, NULL, ?, NULL, 0, ?)
      `).run(id, url, index === 0 ? 0 : 1, now);
      if (!url.includes("llms.txt") && index < 3) {
        sqlite.prepare(`
          INSERT INTO site_audit_issues (campaign_id, url, severity, category, title, detail, created_at)
          VALUES (?, ?, 'notice', 'aiSearch', '/llms.txt 교차 확인', 'llms.txt 경로를 GEO audit과 함께 확인하세요.', ?)
        `).run(id, url, now);
        errors += 1;
      }
    }
    const health = links.length ? Math.max(40, 100 - errors * 5) : null;
    sqlite.prepare(`
      UPDATE site_audit_campaigns SET status = 'completed', site_health = ?, last_run_at = ?, updated_at = ? WHERE id = ?
    `).run(health, now, now, id);
    return {
      campaignId: id,
      status: "completed" as const,
      crawledPages: links.length,
      siteHealth: health,
      provider: providerLive("firecrawl", { pages: links.length }),
      capturedAt: now,
    };
  });
}

export function getSiteAuditOverview(campaignIdInput: unknown) {
  const project = requireActiveProject();
  const campaignId = z.coerce.number().int().positive().parse(campaignIdInput);
  const { sqlite } = getDatabase();
  const campaign = sqlite.prepare(`
    SELECT id, name, domain, status, site_health, last_run_at FROM site_audit_campaigns WHERE id = ? AND project_id = ?
  `).get(campaignId, project.id) as { id: number; name: string; domain: string; status: string; site_health: number | null; last_run_at: string | null } | undefined;
  if (!campaign) throw semforgeError("NOT_FOUND", "캠페인을 찾을 수 없습니다.");
  const pages = (sqlite.prepare("SELECT COUNT(*) AS count FROM site_audit_pages WHERE campaign_id = ?").get(campaignId) as { count: number }).count;
  const issues = sqlite.prepare(`
    SELECT severity, COUNT(*) AS count FROM site_audit_issues WHERE campaign_id = ? GROUP BY severity
  `).all(campaignId) as Array<{ severity: string; count: number }>;
  const locked = (() => { try { requireSemforgeSubscription(); return false; } catch { return true; } })();
  return {
    locked,
    campaign: {
      id: campaign.id,
      name: campaign.name,
      domain: campaign.domain,
      status: campaign.status,
      siteHealth: campaign.site_health,
      lastRunAt: campaign.last_run_at,
    },
    crawledPages: pages,
    issues,
    firecrawl: firecrawlConfigured() ? providerLive("firecrawl", { configured: true }) : providerUnavailable("firecrawl", "API 키 미설정"),
  };
}
