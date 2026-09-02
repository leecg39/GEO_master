import { z } from "zod";
import { getDatabase } from "@/lib/db";
import { semforgeError } from "@/lib/semforge/errors";
import { fetchSerp, talordataConfigured, talordataMode, talordataSource } from "@/lib/semforge/talordata/client";
import { normalizeDomain } from "@/lib/semforge/utils/domain";
import { requireSemforgeSubscription } from "@/lib/semforge-subscription";
import { requireActiveProject } from "@/lib/projects";
import { providerLive, providerUnavailable, type ProviderResult } from "@/lib/semforge/providers/types";

const MAX_QUERIES_PER_RUN = 20;

function normalizeQuery(query: string) {
  return query.trim().replace(/\s+/g, " ").toLowerCase();
}


function domainMatches(candidate: string, target: string) {
  return candidate === target || candidate.endsWith(`.${target}`);
}

interface QueryRow {
  id: number;
  project_id: number;
  domain: string;
  query: string;
  normalized_query: string;
  country_code: string;
  device: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export const aiQueryCreateSchema = z.object({
  domain: z.string().trim().min(3).max(253),
  query: z.string().trim().min(2).max(500),
  countryCode: z.string().trim().length(2).optional().default("KR"),
  device: z.enum(["desktop", "mobile"]).optional().default("desktop"),
}).strict();

export function listAiVisibilityQueries(domain?: string) {
  const project = requireActiveProject();
  const { sqlite } = getDatabase();
  const params: Array<string | number> = [project.id];
  let where = "project_id = ? AND deleted_at IS NULL";
  if (domain) {
    where += " AND domain = ?";
    params.push(normalizeDomain(domain));
  }
  const rows = sqlite.prepare(`
    SELECT * FROM ai_visibility_queries WHERE ${where} ORDER BY created_at DESC, id DESC
  `).all(...params) as QueryRow[];
  return rows.map((row) => ({
    id: row.id,
    domain: row.domain,
    query: row.query,
    countryCode: row.country_code,
    device: row.device,
    createdAt: row.created_at,
  }));
}

export function addAiVisibilityQuery(input: unknown) {
  requireSemforgeSubscription();
  const project = requireActiveProject();
  const parsed = aiQueryCreateSchema.parse(input);
  const domain = normalizeDomain(parsed.domain);
  if (!domain.includes(".")) throw semforgeError("VALIDATION_ERROR", "유효한 도메인을 입력해 주세요.");
  const query = parsed.query.trim().replace(/\s+/g, " ");
  const normalized = normalizeQuery(query);
  const { sqlite } = getDatabase();
  const duplicate = sqlite.prepare(`
    SELECT id FROM ai_visibility_queries
    WHERE project_id = ? AND domain = ? AND normalized_query = ? AND country_code = ? AND device = ? AND deleted_at IS NULL
  `).get(project.id, domain, normalized, parsed.countryCode.toUpperCase(), parsed.device);
  if (duplicate) throw semforgeError("DUPLICATE", "이미 추적 중인 쿼리입니다.");
  const now = new Date().toISOString();
  const result = sqlite.prepare(`
    INSERT INTO ai_visibility_queries (project_id, domain, query, normalized_query, country_code, device, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(project.id, domain, query, normalized, parsed.countryCode.toUpperCase(), parsed.device, now, now);
  return { id: Number(result.lastInsertRowid), domain, query, countryCode: parsed.countryCode.toUpperCase(), device: parsed.device, createdAt: now };
}

export function removeAiVisibilityQuery(idInput: unknown) {
  requireSemforgeSubscription();
  const project = requireActiveProject();
  const id = z.coerce.number().int().positive().parse(idInput);
  const { sqlite } = getDatabase();
  const row = sqlite.prepare("SELECT id FROM ai_visibility_queries WHERE id = ? AND project_id = ? AND deleted_at IS NULL").get(id, project.id);
  if (!row) throw semforgeError("NOT_FOUND", "추적 쿼리를 찾을 수 없습니다.");
  sqlite.prepare("UPDATE ai_visibility_queries SET deleted_at = ?, updated_at = ? WHERE id = ?").run(new Date().toISOString(), new Date().toISOString(), id);
  return { id, deleted: true };
}

export interface AiVisibilityOverview {
  domain: string;
  subscriptionRequired: boolean;
  talordata: ProviderResult<{ configured: boolean }>;
  stats: {
    queryCount: number;
    collectedCount: number;
    aioCount: number;
    citedCount: number;
    lastCollectedAt: string | null;
  };
  queries: Array<{
    id: number;
    query: string;
    aioPresent: boolean | null;
    cited: boolean | null;
    organicPosition: number | null;
    lastCapturedAt: string | null;
  }>;
}

export function getAiVisibilityOverview(domainInput: string): AiVisibilityOverview {
  const project = requireActiveProject();
  const domain = normalizeDomain(domainInput);
  const subscription = requireSemforgeSubscription();
  void subscription;
  const mode = talordataMode();
  const talordata = mode === "live"
    ? providerLive("talordata", { configured: true, mode: "live" })
    : mode === "mock"
      ? providerLive("mock-dev", { configured: true, mode: "mock", reason: "SEMFORGE_MOCK_TALORDATA=1 데모 SERP" })
      : providerUnavailable("talordata", "TalorData API 토큰이 설정되지 않았습니다. 설정 화면에서 저장하거나 .env.local 에 TALORDATA_API_TOKEN 을 추가하세요. 로컬 데모는 SEMFORGE_MOCK_TALORDATA=1 을 사용할 수 있습니다.");
  const { sqlite } = getDatabase();
  const queries = sqlite.prepare(`
    SELECT * FROM ai_visibility_queries WHERE project_id = ? AND domain = ? AND deleted_at IS NULL ORDER BY created_at DESC
  `).all(project.id, domain) as QueryRow[];

  const statuses = queries.map((query) => {
    const snapshot = sqlite.prepare(`
      SELECT * FROM ai_visibility_snapshots WHERE query_id = ? ORDER BY captured_at DESC, id DESC LIMIT 1
    `).get(query.id) as { aio_present: number; cited: number | null; organic_position: number | null; captured_at: string } | undefined;
    return {
      id: query.id,
      query: query.query,
      aioPresent: snapshot ? Boolean(snapshot.aio_present) : null,
      cited: snapshot?.cited === null || snapshot?.cited === undefined ? null : Boolean(snapshot.cited),
      organicPosition: snapshot?.organic_position ?? null,
      lastCapturedAt: snapshot?.captured_at ?? null,
    };
  });

  const collected = statuses.filter((s) => s.aioPresent !== null);
  const lastCollectedAt = collected.reduce<string | null>((latest, item) => {
    if (!item.lastCapturedAt) return latest;
    return !latest || item.lastCapturedAt > latest ? item.lastCapturedAt : latest;
  }, null);

  return {
    domain,
    subscriptionRequired: false,
    talordata,
    stats: {
      queryCount: queries.length,
      collectedCount: collected.length,
      aioCount: collected.filter((s) => s.aioPresent).length,
      citedCount: collected.filter((s) => s.cited === true).length,
      lastCollectedAt,
    },
    queries: statuses,
  };
}

export function getAiVisibilityOverviewPublic(domainInput: string): Omit<AiVisibilityOverview, "subscriptionRequired"> & { locked: boolean; message?: string } {
  const project = requireActiveProject();
  const domain = normalizeDomain(domainInput);
  try {
    requireSemforgeSubscription();
    return { ...getAiVisibilityOverview(domain), locked: false };
  } catch {
    const { sqlite } = getDatabase();
    const count = (sqlite.prepare(`
      SELECT COUNT(*) AS count FROM ai_visibility_queries WHERE project_id = ? AND domain = ? AND deleted_at IS NULL
    `).get(project.id, domain) as { count: number }).count;
    return {
      domain,
      locked: true,
      message: "SEMForge Pro 구독(월 300,000원) 후 AI SEO 데이터를 수집할 수 있습니다.",
      talordata: providerUnavailable("talordata", "구독 필요"),
      stats: { queryCount: count, collectedCount: 0, aioCount: 0, citedCount: 0, lastCollectedAt: null },
      queries: [],
    };
  }
}

export async function collectAiVisibility(input: { domain: string; forceRefresh?: boolean }) {
  requireSemforgeSubscription();
  if (!talordataConfigured()) {
    throw semforgeError("INTERNAL", "TalorData가 연결되지 않았습니다. 설정 화면에서 TalorData API 토큰을 저장하거나 .env.local 에 TALORDATA_API_TOKEN 을 추가하세요. 로컬 데모는 SEMFORGE_MOCK_TALORDATA=1 을 사용할 수 있습니다.");
  }
  const domain = normalizeDomain(input.domain);
  const queries = listAiVisibilityQueries(domain).slice(0, MAX_QUERIES_PER_RUN);
  if (queries.length === 0) throw semforgeError("VALIDATION_ERROR", "수집할 추적 쿼리가 없습니다.");
  const { sqlite } = getDatabase();
  const outcomes = [];
  let capturedAt = new Date().toISOString();

  for (const tracked of queries) {
    try {
      const serp = await fetchSerp({
        q: tracked.query,
        gl: tracked.countryCode.toLowerCase(),
        hl: tracked.countryCode.toUpperCase() === "KR" ? "ko" : "en",
        device: tracked.device as "desktop" | "mobile",
      });
      capturedAt = serp.capturedAt.toISOString();
      const aioPresent = serp.aiOverview.present || serp.features.includes("ai_overview");
      const citationsAvailable = serp.aiOverview.citationsAvailable;
      const ownCitation = serp.aiOverview.citations.find((c) => domainMatches(c.domain, domain));
      const organicHit = serp.organic.find((item) => domainMatches(item.domain, domain));
      const cited: boolean | null = !aioPresent ? false : citationsAvailable ? Boolean(ownCitation) : null;
      const citedDomains = citationsAvailable ? serp.aiOverview.citations.map((c) => c.domain) : [];
      sqlite.prepare(`
        INSERT INTO ai_visibility_snapshots
          (query_id, aio_present, cited, cited_url, cited_domains, organic_position, features, source, captured_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        tracked.id,
        aioPresent ? 1 : 0,
        cited === null ? null : cited ? 1 : 0,
        ownCitation?.url ?? null,
        JSON.stringify(citedDomains),
        organicHit?.position ?? null,
        JSON.stringify(serp.features),
        talordataSource(),
        capturedAt,
      );
      outcomes.push({ queryId: tracked.id, query: tracked.query, aioPresent, cited, error: undefined });
    } catch (error) {
      outcomes.push({
        queryId: tracked.id,
        query: tracked.query,
        aioPresent: false,
        cited: null,
        error: error instanceof Error ? error.message : "수집 실패",
      });
    }
  }
  return { domain, collected: outcomes.filter((o) => !o.error).length, failed: outcomes.filter((o) => o.error).length, outcomes, capturedAt };
}

export function seedAiVisibilityFromProject(domain: string, seeds: string[]) {
  requireSemforgeSubscription();
  for (const query of seeds) {
    try { addAiVisibilityQuery({ domain, query }); } catch { /* duplicate ok */ }
  }
}
