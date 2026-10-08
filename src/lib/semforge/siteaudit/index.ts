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
import { mapSite } from "@/lib/integrations/firecrawl";
import {
  collectDiscoveredPages, probeLlmsTxt, RENDER_PAGE_LIMIT, urlPathDepth,
  type CollectHalt, type CollectMode, type CollectResult, type LlmsTxtState, type PageFetchResult, type SiteAuditDataState,
} from "./discovery";

export { probeLlmsTxt, RENDER_PAGE_LIMIT, urlPathDepth } from "./discovery";

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

const MAP_LIMIT = 25;

interface CrawlLinks { links: string[]; source: string; apiKey: string | null; invalid: number; duplicates: number }

async function fetchCrawlLinks(domain: string, signal: AbortSignal): Promise<CrawlLinks> {
  const mode = firecrawlMode();
  if (mode === "mock") {
    return { links: mockCrawlLinks(domain), source: "mock-dev", apiKey: null, invalid: 0, duplicates: 0 };
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
  const map = await mapSite(domain, { apiKey, limit: MAP_LIMIT, signal });
  if (map.links.length === 0) throw semforgeError("INTERNAL", "Firecrawl이 빈 크롤 결과를 반환했습니다.");
  return { ...map, source: "firecrawl", apiKey };
}

/** 실행 중 상태가 이보다 오래되면 서버가 중간에 멈춘 것으로 보고 다시 실행을 허용한다 */
const STALE_RUN_MS = 15 * 60 * 1000;

/** 같은 프로세스 안의 실행 중인 크롤 — 취소 요청 시 진행 중인 요청을 바로 끊는다 */
const activeRuns: Map<number, AbortController> = ((globalThis as { __geoSiteAuditRuns?: Map<number, AbortController> }).__geoSiteAuditRuns ??= new Map());

function isActivelyRunning(campaign: { status: string; updated_at: string }) {
  return campaign.status === "running" && Date.parse(campaign.updated_at) > Date.now() - STALE_RUN_MS;
}

export const siteAuditRunSchema = z.object({
  action: z.literal("run").optional(),
  renderMode: z.enum(["native", "rendered"]).default("native"),
}).strict();

function insertIssue(sqlite: Database.Database, campaignId: number, issue: { url: string; severity: string; category: string; title: string; detail: string }, now: string) {
  sqlite.prepare(`
    INSERT INTO site_audit_issues (campaign_id, url, severity, category, title, detail, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(campaignId, issue.url, issue.severity, issue.category, issue.title, issue.detail, now);
}

const MAX_PAGE_ISSUES = 10;

const HALT_ISSUES: Record<CollectHalt, { severity: string; title: string; detail: string }> = {
  cancelled: { severity: "notice", title: "사용자가 크롤을 취소함", detail: "취소 전에 요청한 페이지만 저장했고, 나머지는 미요청으로 남겼습니다." },
  rate_limited: { severity: "warning", title: "요청 한도로 수집 중단", detail: "HTTP 429를 받아 한 번 다시 시도한 뒤 남은 페이지 요청을 멈췄습니다. 잠시 후 다시 크롤하세요." },
  credits_exhausted: { severity: "warning", title: "Firecrawl 크레딧 부족으로 수집 중단", detail: "남은 페이지는 요청하지 않았습니다. 크레딧을 충전하거나 일반 수집으로 다시 크롤하세요." },
  auth_failed: { severity: "warning", title: "Firecrawl 인증 오류로 수집 중단", detail: "설정에서 Firecrawl API 키를 확인한 뒤 다시 크롤하세요." },
};

interface CrawlOutcome {
  links: string[];
  source: string;
  renderMode: CollectMode;
  llms: { state: LlmsTxtState; detail: string };
  collected: CollectResult | null;
  invalid: number;
  duplicates: number;
}

/**
 * 크롤 결과 저장 — 관측한 것만 기록한다 (Qshop P01·P02).
 * - 요청한 페이지: 실제 상태·최종 URL·제목·용량·해시 (fetched), 요청 실패 (failed)
 * - 범위 밖 URL은 요청하지 않는다. 범위 밖으로 리다이렉트된 페이지도 이 사이트의 측정값에서 뺀다 (out_of_scope)
 * - 데모 모드, 취소, 요청 한도, 렌더링 한도로 요청하지 않은 URL은 discovered로 남긴다
 * 실측 기반 종합 점수는 만들지 않고, 관측 수치는 브리핑에서 분모와 함께 보여 준다.
 */
function persistCrawlResults(sqlite: Database.Database, campaignId: number, domain: string, outcome: CrawlOutcome) {
  const { links, source, llms, collected } = outcome;
  const pages = collected?.pages ?? null;
  const halted = collected?.halted ?? null;
  const now = new Date().toISOString();
  sqlite.prepare("DELETE FROM site_audit_pages WHERE campaign_id = ?").run(campaignId);
  sqlite.prepare("DELETE FROM site_audit_issues WHERE campaign_id = ?").run(campaignId);

  const insertPage = sqlite.prepare(`
    INSERT INTO site_audit_pages (campaign_id, url, status_code, title, depth, response_ms, bytes, fetch_state, final_url, content_hash, fetch_error, render_mode, captured_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const results: PageFetchResult[] = pages ?? links.map((url) => ({ url, state: "discovered", statusCode: 0, finalUrl: null, title: null, bytes: 0, responseMs: null, contentHash: null, error: null, renderMode: null }));
  for (const page of results) {
    insertPage.run(
      campaignId, page.url, page.statusCode, page.title, urlPathDepth(page.url), page.responseMs, page.bytes, page.state,
      page.finalUrl, page.contentHash, page.error, page.renderMode, now,
    );
  }

  let issueCount = 0;
  const addIssue = (issue: { url: string; severity: string; category: string; title: string; detail: string }) => {
    insertIssue(sqlite, campaignId, issue, now);
    issueCount += 1;
  };
  const llmsUrl = `https://${domain}/llms.txt`;
  if (llms.state === "missing") {
    addIssue({ url: llmsUrl, severity: "warning", category: "aiSearch", title: "/llms.txt 없음", detail: `실제 요청 결과: ${llms.detail}` });
  } else if (llms.state === "unknown") {
    addIssue({ url: llmsUrl, severity: "notice", category: "aiSearch", title: "/llms.txt 확인 불가", detail: `${llms.detail} — 없다고 판정하지 않았습니다. 나중에 다시 확인하세요.` });
  }
  if (links.length < 3) {
    addIssue({ url: links[0] ?? "", severity: "notice", category: "coverage", title: "발견 URL 적음", detail: `Map으로 발견한 URL이 ${links.length}개입니다. 내부 링크·사이트맵을 점검하세요.` });
  }
  const fetched = results.filter((page) => page.state === "fetched");
  const failed = results.filter((page) => page.state === "failed");
  for (const page of fetched.filter((item) => item.statusCode >= 400).slice(0, MAX_PAGE_ISSUES)) {
    addIssue({ url: page.url, severity: page.statusCode >= 500 ? "critical" : "warning", category: "http", title: `HTTP ${page.statusCode} 응답`, detail: `실제 요청에서 HTTP ${page.statusCode}가 응답했습니다.` });
  }
  for (const page of fetched.filter((item) => item.statusCode >= 200 && item.statusCode < 300 && !item.title).slice(0, MAX_PAGE_ISSUES)) {
    addIssue({ url: page.url, severity: "notice", category: "seo", title: "제목(title) 없음", detail: "실제 HTML에 <title>이 없거나 비어 있습니다." });
  }
  for (const page of failed.slice(0, MAX_PAGE_ISSUES)) {
    addIssue({ url: page.url, severity: "notice", category: "http", title: "페이지 요청 실패", detail: `${page.error ?? "요청 실패"} — 응답 비율의 분모에서 제외했습니다.` });
  }
  const redirectedOut = results.filter((page) => page.state === "out_of_scope" && page.finalUrl);
  for (const page of redirectedOut.slice(0, MAX_PAGE_ISSUES)) {
    addIssue({ url: page.url, severity: "notice", category: "http", title: "사이트 범위 밖으로 리다이렉트", detail: `${page.finalUrl}(으)로 이동해 이 사이트의 측정값에서 뺐습니다.` });
  }
  if (halted) addIssue({ url: `https://${domain}`, category: "crawl", ...HALT_ISSUES[halted] });
  if (collected && collected.overLimit > 0) {
    addIssue({ url: `https://${domain}`, severity: "notice", category: "crawl", title: "렌더링 수집 한도", detail: `크레딧 보호를 위해 ${RENDER_PAGE_LIMIT}페이지만 렌더링했고 ${collected.overLimit}개는 요청하지 않았습니다.` });
  }

  const requestedAny = results.some((page) => page.renderMode !== null);
  const dataState = requestedAny ? "measured" as const : "discovered" as const;
  const status = halted === "cancelled" ? "cancelled" as const : failed.length > 0 || halted ? "partial" as const : "completed" as const;
  sqlite.prepare(`
    UPDATE site_audit_campaigns SET status = ?, site_health = NULL, data_state = ?, llms_txt_state = ?, cancel_requested = 0,
      last_run_at = ?, updated_at = ? WHERE id = ?
  `).run(status, dataState, llms.state, now, now, campaignId);

  return {
    campaignId,
    status,
    discoveredUrls: links.length,
    /** 이전 응답과의 호환용 — 발견한 URL 수 */
    crawledPages: links.length,
    fetchedPages: fetched.length,
    failedPages: failed.length,
    outOfScope: results.filter((page) => page.state === "out_of_scope").length,
    notRequested: pages ? results.filter((page) => page.state === "discovered").length : 0,
    halted,
    /** 데모처럼 페이지를 요청하지 않았으면 null */
    renderMode: pages ? outcome.renderMode : null,
    invalidLinks: outcome.invalid,
    duplicateLinks: outcome.duplicates,
    issueCount,
    siteHealth: null,
    dataState,
    llmsTxtState: llms.state,
    source,
    provider: providerLive(source, { pages: links.length, issues: issueCount }),
    capturedAt: now,
  };
}

/** 오래된 running은 서버가 중간에 멈춘 실행이다 — 화면에는 "중단됨"으로 보여 준다 */
const DISPLAY_STATUS = "CASE WHEN status = 'running' AND updated_at < ? THEN 'interrupted' ELSE status END";
const staleBefore = () => new Date(Date.now() - STALE_RUN_MS).toISOString();

export function listSiteAuditCampaigns() {
  const project = requireActiveProject();
  const { sqlite } = getDatabase();
  return sqlite.prepare(`
    SELECT id, name, domain, ${DISPLAY_STATUS} AS status, site_health AS siteHealth, last_run_at AS lastRunAt, created_at AS createdAt
    FROM site_audit_campaigns WHERE project_id = ? ORDER BY updated_at DESC, id DESC
  `).all(staleBefore(), project.id) as Array<{ id: number; name: string; domain: string; status: string; siteHealth: number | null; lastRunAt: string | null; createdAt: string }>;
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

function cancelRequested(sqlite: Database.Database, id: number) {
  return (sqlite.prepare("SELECT cancel_requested FROM site_audit_campaigns WHERE id = ?").get(id) as { cancel_requested: number } | undefined)?.cancel_requested === 1;
}

export async function runSiteAuditCampaign(idInput: unknown, optionsInput: unknown = {}) {
  requireSemforgeSubscription();
  const project = requireActiveProject();
  const id = z.coerce.number().int().positive().parse(idInput);
  const options = siteAuditRunSchema.parse(optionsInput ?? {});
  const { sqlite } = getDatabase();
  const campaign = sqlite.prepare(`
    SELECT * FROM site_audit_campaigns WHERE id = ? AND project_id = ?
  `).get(id, project.id) as { id: number; domain: string; name: string } | undefined;
  if (!campaign) throw semforgeError("NOT_FOUND", "사이트 진단 캠페인을 찾을 수 없습니다.");

  // 같은 캠페인을 동시에 두 번 돌리면 크레딧이 이중으로 들고 결과가 서로 덮어쓴다
  const startedAt = new Date().toISOString();
  const claimed = sqlite.prepare(`
    UPDATE site_audit_campaigns SET status = 'running', cancel_requested = 0, updated_at = ?
    WHERE id = ? AND (status != 'running' OR updated_at < ?)
  `).run(startedAt, id, staleBefore());
  if (claimed.changes === 0) throw new AppError("이미 크롤 중인 캠페인입니다. 끝나거나 취소한 뒤 다시 실행하세요.", 409, "SITE_AUDIT_RUNNING");

  const controller = new AbortController();
  activeRuns.set(id, controller);
  try {
    const map = await fetchCrawlLinks(campaign.domain, controller.signal);
    const demo = map.source === "mock-dev";
    const llms = demo
      ? { state: "unknown" as const, detail: "데모 모드에서는 실제 요청하지 않습니다" }
      : await probeLlmsTxt(campaign.domain);
    const collected = demo ? null : await collectDiscoveredPages(map.links, campaign.domain, {
      mode: options.renderMode,
      apiKey: map.apiKey,
      signal: controller.signal,
      shouldStop: () => cancelRequested(sqlite, id),
    });
    return transactionalMutation(sqlite, () => persistCrawlResults(sqlite, id, campaign.domain, {
      links: map.links, source: map.source, renderMode: options.renderMode, llms, collected, invalid: map.invalid, duplicates: map.duplicates,
    }));
  } catch (error) {
    const cancelled = error instanceof AppError && error.code === "FIRECRAWL_CANCELLED";
    sqlite.prepare(`
      UPDATE site_audit_campaigns SET status = ?, cancel_requested = 0, updated_at = ? WHERE id = ?
    `).run(cancelled ? "cancelled" : "failed", new Date().toISOString(), id);
    if (cancelled) throw new AppError("URL 발견 단계에서 크롤을 취소했습니다. 이전 결과는 그대로 두었습니다.", 409, "SITE_AUDIT_CANCELLED");
    throw error;
  } finally {
    if (activeRuns.get(id) === controller) activeRuns.delete(id);
  }
}

/** 실행 중인 크롤을 멈춘다. 이미 요청한 페이지 결과는 저장하고 나머지는 미요청으로 남긴다 */
export function cancelSiteAuditCampaign(idInput: unknown) {
  requireSemforgeSubscription();
  const project = requireActiveProject();
  const id = z.coerce.number().int().positive().parse(idInput);
  const { sqlite } = getDatabase();
  const campaign = sqlite.prepare(`
    SELECT id, status, updated_at FROM site_audit_campaigns WHERE id = ? AND project_id = ?
  `).get(id, project.id) as { id: number; status: string; updated_at: string } | undefined;
  if (!campaign) throw semforgeError("NOT_FOUND", "사이트 진단 캠페인을 찾을 수 없습니다.");
  if (!isActivelyRunning(campaign)) throw new AppError("실행 중인 크롤이 없습니다.", 409, "SITE_AUDIT_NOT_RUNNING");
  const controller = activeRuns.get(id);
  // 이 프로세스에 실행 기록이 없으면(서버 재시작 등) 기다릴 대상이 없으므로 바로 풀어 준다.
  // 플래그는 남겨 두어 다른 프로세스에서 돌고 있다면 다음 페이지 전에 멈추게 한다.
  sqlite.prepare("UPDATE site_audit_campaigns SET cancel_requested = 1, status = CASE WHEN ? THEN status ELSE 'cancelled' END WHERE id = ?")
    .run(controller ? 1 : 0, id);
  controller?.abort();
  return { id, cancelRequested: true, released: !controller };
}

export function deleteSiteAuditCampaign(idInput: unknown) {
  requireSemforgeSubscription();
  const project = requireActiveProject();
  const id = z.coerce.number().int().positive().parse(idInput);
  const { sqlite } = getDatabase();
  const campaign = sqlite.prepare(`
    SELECT id, name, status, updated_at FROM site_audit_campaigns WHERE id = ? AND project_id = ?
  `).get(id, project.id) as { id: number; name: string; status: string; updated_at: string } | undefined;
  if (!campaign) throw semforgeError("NOT_FOUND", "사이트 진단 캠페인을 찾을 수 없습니다.");
  if (isActivelyRunning(campaign)) {
    throw semforgeError("VALIDATION_ERROR", "크롤 중인 캠페인은 삭제할 수 없습니다. 취소하거나 끝난 뒤 삭제하세요.");
  }
  sqlite.prepare("DELETE FROM site_audit_campaigns WHERE id = ?").run(id);
  return { id, deleted: true, name: campaign.name };
}

export function getSiteAuditOverview(campaignIdInput: unknown) {
  const project = requireActiveProject();
  const campaignId = z.coerce.number().int().positive().parse(campaignIdInput);
  const { sqlite } = getDatabase();
  const campaign = sqlite.prepare(`
    SELECT id, name, domain, ${DISPLAY_STATUS} AS status, site_health, data_state, llms_txt_state, last_run_at FROM site_audit_campaigns WHERE id = ? AND project_id = ?
  `).get(staleBefore(), campaignId, project.id) as {
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
  renderMode: string | null;
  fetchError: string | null;
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
    SELECT url, status_code AS statusCode, depth, fetch_state AS fetchState, render_mode AS renderMode, fetch_error AS fetchError FROM site_audit_pages
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
  const measuredRows = sqlite.prepare(`
    SELECT
      SUM(fetch_state = 'fetched') AS fetched,
      SUM(fetch_state = 'failed') AS failed,
      SUM(fetch_state = 'fetched' AND status_code BETWEEN 200 AND 299) AS ok,
      SUM(fetch_state = 'fetched' AND status_code BETWEEN 200 AND 299 AND (title IS NULL OR title = '')) AS missingTitle,
      SUM(fetch_state = 'out_of_scope') AS outOfScope,
      SUM(fetch_state = 'discovered') AS notRequested,
      SUM(render_mode IN ('rendered', 'cache')) AS rendered
    FROM site_audit_pages WHERE campaign_id = ?
  `).get(campaignId) as Record<"fetched" | "failed" | "ok" | "missingTitle" | "outOfScope" | "notRequested" | "rendered", number | null>;
  const measured = campaign.data_state === "measured"
    ? {
      fetched: measuredRows.fetched ?? 0, failed: measuredRows.failed ?? 0, ok: measuredRows.ok ?? 0, missingTitle: measuredRows.missingTitle ?? 0,
      outOfScope: measuredRows.outOfScope ?? 0, notRequested: measuredRows.notRequested ?? 0, rendered: measuredRows.rendered ?? 0,
    }
    : null;
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
    ...(measured && measured.fetched > 0
      ? [{ axis: "정상 응답 비율", score: Math.round((measured.ok / measured.fetched) * 100), hint: `응답한 ${measured.fetched}개 중 2xx ${measured.ok}개 (요청 실패 ${measured.failed}개는 분모 제외)` }]
      : []),
  ];

  const narratives: string[] = [];
  if (pageCount === 0) {
    narratives.push("아직 크롤이 실행되지 않았습니다. 캠페인에서 '크롤 실행'을 눌러 분석을 시작하세요.");
  } else if (legacy) {
    narratives.push("이 결과는 이전 버전이 페이지를 실제로 요청하지 않고 계산한 추정치입니다. 정확한 결과를 보려면 다시 크롤하세요.");
  } else if (measured) {
    const how = measured.rendered > 0 ? "Firecrawl로 렌더링해" : "직접";
    const skipped = measured.notRequested > 0 ? `, 미요청 ${measured.notRequested}개` : "";
    narratives.push(`URL ${pageCount}개를 발견해 범위 안 페이지를 ${how} 요청했습니다. 응답 ${measured.fetched}개 중 정상(2xx) ${measured.ok}개, 요청 실패 ${measured.failed}개, 범위 밖 ${measured.outOfScope}개${skipped}입니다. 종합 건강 점수는 만들지 않습니다.`);
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
    issues.some((issue) => issue.category === "crawl" && issue.title !== "렌더링 수집 한도")
      ? "수집이 중간에 멈췄습니다(이슈 목록 참고). 원인을 해결한 뒤 다시 크롤해 미요청 페이지를 채우세요." : null,
  ].filter((item): item is string => Boolean(item));

  return {
    ready: pageCount > 0,
    score,
    grade,
    dataState: campaign.data_state,
    llmsTxtState,
    measured,
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
