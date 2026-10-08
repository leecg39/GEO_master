import type Database from "better-sqlite3";
import { AppError } from "@/lib/errors";
import { z } from "zod";
import { transactionalMutation } from "@/lib/crud";
import { getDatabase } from "@/lib/db";
import { getFirecrawlApiKey, resolveFirecrawlApiKey } from "@/lib/settings";
import { semforgeError } from "@/lib/semforge/errors";
import { normalizeDomain } from "@/lib/semforge/utils/domain";
import { requireSemforgeSubscription } from "@/lib/semforge-subscription";
import { requireActiveProject } from "@/lib/projects";
import { providerUnavailable, providerLive } from "@/lib/semforge/providers/types";
import { probeLlmsTxt, urlPathDepth, type LlmsTxtState, type SiteAuditDataState } from "./discovery";

export { probeLlmsTxt, urlPathDepth } from "./discovery";

function firecrawlApiKey(): string | null {
  return resolveFirecrawlApiKey().value;
}

function mockFirecrawlEnabled(): boolean {
  return process.env.SEMFORGE_MOCK_FIRECRAWL?.trim() === "1";
}

export function firecrawlMode(): "live" | "mock" | "unavailable" {
  if (firecrawlApiKey()) return "live";
  if (mockFirecrawlEnabled()) return "mock";
  return "unavailable";
}

export function firecrawlConfigured(): boolean {
  return firecrawlMode() !== "unavailable";
}

function mockCrawlLinks(domain: string): string[] {
  const base = `https://${domain}`;
  return [
    base,
    `${base}/about`,
    `${base}/products`,
    `${base}/blog`,
    `${base}/contact`,
    `${base}/llms.txt`,
  ];
}

async function fetchCrawlLinks(domain: string): Promise<{ links: string[]; source: string }> {
  const mode = firecrawlMode();
  if (mode === "mock") {
    return { links: mockCrawlLinks(domain), source: "mock-dev" };
  }
  if (mode === "unavailable") {
    throw semforgeError(
      "INTERNAL",
      "Firecrawl API 키가 설정되지 않았습니다. 설정 화면에서 저장하거나 .env.local 에 FIRECRAWL_API_KEY 를 추가하세요. 로컬 데모는 SEMFORGE_MOCK_FIRECRAWL=1 을 사용할 수 있습니다.",
    );
  }

  const apiKey = getFirecrawlApiKey();
  if (!apiKey) {
    throw semforgeError("INTERNAL", "Firecrawl API 키를 사용할 수 없습니다. 설정에서 다시 저장해 주세요.");
  }

  let response: Response;
  try {
    response = await fetch("https://api.firecrawl.dev/v1/map", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: `https://${domain}`, limit: 25 }),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    const timedOut = error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name);
    throw new AppError(timedOut ? "Firecrawl 응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요." : "Firecrawl에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.", 502, timedOut ? "FIRECRAWL_TIMEOUT" : "FIRECRAWL_CONNECTION_FAILED");
  }
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const err = await response.json() as { error?: string; message?: string };
      detail = err.error ?? err.message ?? detail;
    } catch {
      // ignore parse errors
    }
    if (response.status === 402 || /insufficient credits/i.test(detail)) {
      throw new AppError("Firecrawl 크레딧이 부족하여 사이트 진단을 실행할 수 없습니다. 연결된 Firecrawl 계정에서 크레딧을 충전한 뒤 다시 진단해 주세요.", 503, "FIRECRAWL_CREDITS_EXHAUSTED");
    }
    if ([401, 403].includes(response.status)) throw new AppError("Firecrawl API 키가 유효하지 않거나 접근 권한이 없습니다. 설정에서 API 키를 확인해 주세요.", 502, "FIRECRAWL_AUTH_FAILED");
    if (response.status === 429) throw new AppError("Firecrawl 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.", 429, "FIRECRAWL_RATE_LIMITED");
    throw new AppError(`Firecrawl 요청이 실패했습니다 (HTTP ${response.status}). 잠시 후 다시 시도해 주세요.`, 502, "FIRECRAWL_ERROR");
  }
  const payload = await response.json() as { success?: boolean; status?: string; links?: string[] };
  const links = Array.isArray(payload.links) ? payload.links.slice(0, 25) : [];
  if (payload.success === false || links.length === 0) {
    throw semforgeError("INTERNAL", links.length === 0 ? "Firecrawl이 빈 크롤 결과를 반환했습니다." : "Firecrawl이 URL 목록을 반환하지 않았습니다.");
  }
  return { links, source: "firecrawl" };
}

function insertIssue(sqlite: Database.Database, campaignId: number, issue: { url: string; severity: string; category: string; title: string; detail: string }, now: string) {
  sqlite.prepare(`
    INSERT INTO site_audit_issues (campaign_id, url, severity, category, title, detail, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(campaignId, issue.url, issue.severity, issue.category, issue.title, issue.detail, now);
}

/**
 * Map 결과 저장 — 페이지를 요청하지 않았으므로 상태 코드·제목·용량·건강 점수를 만들지 않는다 (Qshop P01).
 * llms.txt는 실제 요청 결과(llms)로만 판정한다.
 */
function persistCrawlResults(
  sqlite: Database.Database,
  campaignId: number,
  domain: string,
  links: string[],
  source: string,
  llms: { state: LlmsTxtState; detail: string },
) {
  const now = new Date().toISOString();
  sqlite.prepare("DELETE FROM site_audit_pages WHERE campaign_id = ?").run(campaignId);
  sqlite.prepare("DELETE FROM site_audit_issues WHERE campaign_id = ?").run(campaignId);

  for (const url of links) {
    sqlite.prepare(`
      INSERT INTO site_audit_pages (campaign_id, url, status_code, title, depth, response_ms, bytes, fetch_state, captured_at)
      VALUES (?, ?, 0, NULL, ?, NULL, 0, 'discovered', ?)
    `).run(campaignId, url, urlPathDepth(url), now);
  }
  let issueCount = 0;
  const llmsUrl = `https://${domain}/llms.txt`;
  if (llms.state === "missing") {
    insertIssue(sqlite, campaignId, { url: llmsUrl, severity: "warning", category: "aiSearch", title: "/llms.txt 없음", detail: `실제 요청 결과: ${llms.detail}` }, now);
    issueCount += 1;
  } else if (llms.state === "unknown") {
    insertIssue(sqlite, campaignId, { url: llmsUrl, severity: "notice", category: "aiSearch", title: "/llms.txt 확인 불가", detail: `${llms.detail} — 없다고 판정하지 않았습니다. 나중에 다시 확인하세요.` }, now);
    issueCount += 1;
  }
  if (links.length < 3) {
    insertIssue(sqlite, campaignId, { url: links[0] ?? "", severity: "notice", category: "coverage", title: "발견 URL 적음", detail: `Map으로 발견한 URL이 ${links.length}개입니다. 내부 링크·사이트맵을 점검하세요.` }, now);
    issueCount += 1;
  }

  sqlite.prepare(`
    UPDATE site_audit_campaigns SET status = 'completed', site_health = NULL, data_state = 'discovered', llms_txt_state = ?,
      last_run_at = ?, updated_at = ? WHERE id = ?
  `).run(llms.state, now, now, campaignId);

  return {
    campaignId,
    status: "completed" as const,
    discoveredUrls: links.length,
    /** 이전 응답과의 호환용 — 실제로는 "발견한 URL 수"이며 수집한 페이지 수가 아니다 */
    crawledPages: links.length,
    issueCount,
    siteHealth: null,
    dataState: "discovered" as const,
    llmsTxtState: llms.state,
    source,
    provider: providerLive(source, { pages: links.length, issues: issueCount }),
    capturedAt: now,
  };
}

export function listSiteAuditCampaigns() {
  const project = requireActiveProject();
  const { sqlite } = getDatabase();
  return sqlite.prepare(`
    SELECT id, name, domain, status, site_health AS siteHealth, last_run_at AS lastRunAt, created_at AS createdAt
    FROM site_audit_campaigns WHERE project_id = ? ORDER BY updated_at DESC, id DESC
  `).all(project.id) as Array<{ id: number; name: string; domain: string; status: string; siteHealth: number | null; lastRunAt: string | null; createdAt: string }>;
}

export function getSiteAuditWorkspace() {
  const resolved = resolveFirecrawlApiKey();
  if (resolved.storageError) {
    return {
      campaigns: listSiteAuditCampaigns(),
      firecrawl: {
        status: "error" as const,
        source: "database",
        configured: mockFirecrawlEnabled(),
        reason: "저장된 Firecrawl API 키를 복호화할 수 없습니다. 설정에서 다시 저장하세요.",
      },
    };
  }
  const mode = firecrawlMode();
  const firecrawl = mode === "live"
    ? { status: "live" as const, source: "firecrawl", configured: true }
    : mode === "mock"
      ? { status: "mock" as const, source: "mock-dev", configured: true, reason: "SEMFORGE_MOCK_FIRECRAWL=1 데모 크롤" }
      : {
        status: "unavailable" as const,
        source: "firecrawl",
        configured: false,
        reason: "Firecrawl API 키가 설정되지 않았습니다. 설정 화면에서 저장하거나 .env.local 에 FIRECRAWL_API_KEY 를 추가하세요. 로컬 데모는 SEMFORGE_MOCK_FIRECRAWL=1 을 사용할 수 있습니다.",
      };
  return { campaigns: listSiteAuditCampaigns(), firecrawl };
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

  const startedAt = new Date().toISOString();
  sqlite.prepare(`
    UPDATE site_audit_campaigns SET status = 'running', updated_at = ? WHERE id = ?
  `).run(startedAt, id);

  try {
    const { links, source } = await fetchCrawlLinks(campaign.domain);
    const llms = source === "mock-dev"
      ? { state: "unknown" as const, detail: "데모 모드에서는 실제 요청하지 않습니다" }
      : await probeLlmsTxt(campaign.domain);
    return transactionalMutation(sqlite, () => persistCrawlResults(sqlite, id, campaign.domain, links, source, llms));
  } catch (error) {
    sqlite.prepare(`
      UPDATE site_audit_campaigns SET status = 'failed', updated_at = ? WHERE id = ?
    `).run(new Date().toISOString(), id);
    throw error;
  }
}

export function deleteSiteAuditCampaign(idInput: unknown) {
  requireSemforgeSubscription();
  const project = requireActiveProject();
  const id = z.coerce.number().int().positive().parse(idInput);
  const { sqlite } = getDatabase();
  const campaign = sqlite.prepare(`
    SELECT id, name, status FROM site_audit_campaigns WHERE id = ? AND project_id = ?
  `).get(id, project.id) as { id: number; name: string; status: string } | undefined;
  if (!campaign) throw semforgeError("NOT_FOUND", "사이트 진단 캠페인을 찾을 수 없습니다.");
  if (campaign.status !== "completed") {
    throw semforgeError("VALIDATION_ERROR", "크롤이 완료된 캠페인만 삭제할 수 있습니다.");
  }
  sqlite.prepare("DELETE FROM site_audit_campaigns WHERE id = ?").run(id);
  return { id, deleted: true, name: campaign.name };
}

export function getSiteAuditOverview(campaignIdInput: unknown) {
  const project = requireActiveProject();
  const campaignId = z.coerce.number().int().positive().parse(campaignIdInput);
  const { sqlite } = getDatabase();
  const campaign = sqlite.prepare(`
    SELECT id, name, domain, status, site_health, data_state, llms_txt_state, last_run_at FROM site_audit_campaigns WHERE id = ? AND project_id = ?
  `).get(campaignId, project.id) as {
    id: number; name: string; domain: string; status: string; site_health: number | null;
    data_state: SiteAuditDataState; llms_txt_state: LlmsTxtState | null; last_run_at: string | null;
  } | undefined;
  if (!campaign) throw semforgeError("NOT_FOUND", "캠페인을 찾을 수 없습니다.");
  const locked = (() => { try { requireSemforgeSubscription(); return false; } catch { return true; } })();
  const mode = firecrawlMode();
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
    briefing: buildSiteAuditBriefing(campaignId, campaign),
    firecrawl: mode === "live"
      ? providerLive("firecrawl", { configured: true })
      : mode === "mock"
        ? providerLive("mock-dev", { configured: true, mode: "mock" })
        : providerUnavailable("firecrawl", "API 키 미설정"),
  };
}

interface BriefingIssue {
  id: number;
  url: string;
  severity: string;
  category: string;
  title: string;
  detail: string;
}

interface BriefingPage {
  url: string;
  statusCode: number;
  depth: number;
  fetchState: string;
}

function healthGrade(score: number | null) {
  if (score === null) return { label: "미측정", tone: "default" as const };
  if (score >= 90) return { label: "우수", tone: "good" as const };
  if (score >= 75) return { label: "양호", tone: "cyan" as const };
  if (score >= 60) return { label: "보통", tone: "warn" as const };
  return { label: "개선 필요", tone: "bad" as const };
}

/**
 * 브리핑 — 실제로 관측한 값만 점수·레이더에 쓴다 (Qshop P01).
 * - discovered: Map으로 URL만 발견. 건강 점수는 미측정
 * - legacy_estimate: 이전 버전이 가정값으로 계산한 결과. 표시하되 추정치로 명시하고 재크롤을 권한다
 */
function buildSiteAuditBriefing(
  campaignId: number,
  campaign: { site_health: number | null; data_state: SiteAuditDataState; llms_txt_state: LlmsTxtState | null },
) {
  const { sqlite } = getDatabase();
  const pages = sqlite.prepare(`
    SELECT url, status_code AS statusCode, depth, fetch_state AS fetchState FROM site_audit_pages
    WHERE campaign_id = ? ORDER BY depth ASC, url ASC LIMIT 50
  `).all(campaignId) as BriefingPage[];
  const issues = sqlite.prepare(`
    SELECT id, url, severity, category, title, detail FROM site_audit_issues
    WHERE campaign_id = ? ORDER BY
      CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, id ASC
  `).all(campaignId) as BriefingIssue[];

  const legacy = campaign.data_state === "legacy_estimate";
  const pageCount = pages.length;
  const issueCount = issues.length;
  const llmsTxtState: LlmsTxtState | null = campaign.llms_txt_state ?? (legacy && pageCount > 0 ? (pages.some((page) => page.url.includes("/llms.txt")) ? "present" : "unknown") : null);
  const hasLlmsTxt = llmsTxtState === "present";
  const score = legacy ? campaign.site_health : null;
  const grade = legacy && score !== null ? { label: "이전 방식 추정치", tone: "warn" as const } : healthGrade(null);
  const shallowPages = pages.filter((page) => page.depth <= 1).length;
  const shallowRatio = pageCount === 0 ? 0 : Math.round((shallowPages / pageCount) * 100);

  const severityCounts = issues.reduce<Record<string, number>>((acc, issue) => {
    acc[issue.severity] = (acc[issue.severity] ?? 0) + 1;
    return acc;
  }, {});

  const llmsHint = llmsTxtState === "present" ? "실제 요청에서 /llms.txt가 응답했습니다."
    : llmsTxtState === "missing" ? "실제 요청에서 /llms.txt가 없었습니다."
      : "아직 /llms.txt를 확인하지 못했습니다 (점수 아님).";
  const radar = [
    { axis: "llms.txt", score: hasLlmsTxt ? 100 : 0, hint: llmsHint },
    { axis: "URL 발견 범위", score: Math.min(100, pageCount * 10), hint: `Map으로 ${pageCount}개 URL을 발견했습니다.` },
    { axis: "얕은 URL 비율", score: shallowRatio, hint: `경로 깊이 0~1 URL 비율 ${shallowRatio}% (주소 구조 기준)` },
  ];

  const narratives: string[] = [];
  if (pageCount === 0) {
    narratives.push("아직 크롤이 실행되지 않았습니다. 캠페인에서 '크롤 실행'을 눌러 분석을 시작하세요.");
  } else if (legacy) {
    narratives.push("이 결과는 이전 버전이 페이지를 실제로 요청하지 않고 계산한 추정치입니다. 정확한 결과를 보려면 다시 크롤하세요.");
  } else {
    narratives.push(`Firecrawl Map으로 URL ${pageCount}개를 발견했습니다. 페이지 본문은 아직 요청하지 않아 HTTP 상태·제목·건강 점수는 미측정입니다.`);
  }
  if (pageCount > 0) narratives.push(`llms.txt: ${llmsHint}`);
  for (const issue of issues.slice(0, 3)) narratives.push(`[${issue.severity}] ${issue.title}: ${issue.detail}`);

  const recommendations = [
    legacy && pageCount > 0 ? "다시 크롤해 이전 방식 추정치를 실제 관측값으로 바꾸세요." : null,
    llmsTxtState === "missing" ? "llms.txt를 사이트 루트에 배포하세요 (llms.txt 메뉴에서 초안 생성·배포 확인)." : null,
    pageCount > 0 ? "핵심 URL의 실제 응답·제목·스키마는 GEO 진단(/audit)에서 URL별로 측정하세요." : null,
    issues.some((issue) => issue.category === "coverage") ? "발견 URL이 적습니다. 내부 링크 허브와 사이트맵을 점검하세요." : null,
  ].filter((item): item is string => Boolean(item));

  return {
    ready: pageCount > 0,
    score,
    grade,
    dataState: campaign.data_state,
    llmsTxtState,
    pageCount,
    issueCount,
    hasLlmsTxt,
    // 실측 기반 점수가 없으므로 점수 산출 근거도 없다
    scoreFactors: [] as Array<{ key: string; label: string; points: number; kind: "base" | "penalty" | "total" }>,
    severityCounts,
    radar,
    narratives,
    recommendations,
    issues,
    pages: pages.slice(0, 12),
    depthBuckets: [
      { depth: "루트(0)", count: pages.filter((page) => page.depth === 0).length },
      { depth: "1단계", count: pages.filter((page) => page.depth === 1).length },
      { depth: "2단계+", count: pages.filter((page) => page.depth >= 2).length },
    ],
  };
}
