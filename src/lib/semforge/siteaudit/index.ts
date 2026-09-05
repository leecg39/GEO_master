import type Database from "better-sqlite3";
import { z } from "zod";
import { transactionalMutation } from "@/lib/crud";
import { getDatabase } from "@/lib/db";
import { getFirecrawlApiKey, resolveFirecrawlApiKey } from "@/lib/settings";
import { semforgeError } from "@/lib/semforge/errors";
import { normalizeDomain } from "@/lib/semforge/utils/domain";
import { requireSemforgeSubscription } from "@/lib/semforge-subscription";
import { requireActiveProject } from "@/lib/projects";
import { providerUnavailable, providerLive } from "@/lib/semforge/providers/types";

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

  const response = await fetch("https://api.firecrawl.dev/v1/map", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url: `https://${domain}`, limit: 25 }),
    cache: "no-store",
  });
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const err = await response.json() as { error?: string; message?: string };
      detail = err.error ?? err.message ?? detail;
    } catch {
      // ignore parse errors
    }
    throw semforgeError("INTERNAL", `Firecrawl 요청이 실패했습니다 (${detail}).`);
  }
  const payload = await response.json() as { success?: boolean; status?: string; links?: string[] };
  const links = Array.isArray(payload.links) ? payload.links.slice(0, 25) : [];
  if (payload.success === false || links.length === 0) {
    throw semforgeError("INTERNAL", links.length === 0 ? "Firecrawl이 빈 크롤 결과를 반환했습니다." : "Firecrawl이 URL 목록을 반환하지 않았습니다.");
  }
  return { links, source: "firecrawl" };
}

function persistCrawlResults(
  sqlite: Database.Database,
  campaignId: number,
  domain: string,
  links: string[],
  source: string,
) {
  const now = new Date().toISOString();
  sqlite.prepare("DELETE FROM site_audit_pages WHERE campaign_id = ?").run(campaignId);
  sqlite.prepare("DELETE FROM site_audit_issues WHERE campaign_id = ?").run(campaignId);

  let issueCount = 0;
  const hasLlmsTxt = links.some((url) => url.includes("/llms.txt"));
  for (const [index, url] of links.entries()) {
    sqlite.prepare(`
      INSERT INTO site_audit_pages (campaign_id, url, status_code, title, depth, response_ms, bytes, captured_at)
      VALUES (?, ?, 200, NULL, ?, NULL, 0, ?)
    `).run(campaignId, url, index === 0 ? 0 : 1, now);
  }
  if (!hasLlmsTxt) {
    sqlite.prepare(`
      INSERT INTO site_audit_issues (campaign_id, url, severity, category, title, detail, created_at)
      VALUES (?, ?, 'warning', 'aiSearch', '/llms.txt 누락', 'AI 검색 크롤러용 llms.txt 경로가 사이트맵에 없습니다.', ?)
    `).run(campaignId, links[0] ?? `https://${domain}`, now);
    issueCount += 1;
  }
  if (links.length < 3) {
    sqlite.prepare(`
      INSERT INTO site_audit_issues (campaign_id, url, severity, category, title, detail, created_at)
      VALUES (?, ?, 'notice', 'coverage', '크롤 범위 제한', '발견된 페이지가 적습니다. 내부 링크 구조를 점검하세요.', ?)
    `).run(campaignId, links[0] ?? "", now);
    issueCount += 1;
  }

  const health = Math.max(35, Math.min(100, 92 - issueCount * 8 - Math.max(0, 10 - links.length) * 2));
  sqlite.prepare(`
    UPDATE site_audit_campaigns SET status = 'completed', site_health = ?, last_run_at = ?, updated_at = ? WHERE id = ?
  `).run(health, now, now, campaignId);

  return {
    campaignId,
    status: "completed" as const,
    crawledPages: links.length,
    issueCount,
    siteHealth: health,
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
    return transactionalMutation(sqlite, () => persistCrawlResults(sqlite, id, campaign.domain, links, source));
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
    SELECT id, name, domain, status, site_health, last_run_at FROM site_audit_campaigns WHERE id = ? AND project_id = ?
  `).get(campaignId, project.id) as { id: number; name: string; domain: string; status: string; site_health: number | null; last_run_at: string | null } | undefined;
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
    briefing: buildSiteAuditBriefing(campaignId, campaign.site_health),
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
}

function healthGrade(score: number | null) {
  if (score === null) return { label: "미측정", tone: "default" as const };
  if (score >= 90) return { label: "우수", tone: "good" as const };
  if (score >= 75) return { label: "양호", tone: "cyan" as const };
  if (score >= 60) return { label: "보통", tone: "warn" as const };
  return { label: "개선 필요", tone: "bad" as const };
}

function buildSiteAuditBriefing(campaignId: number, siteHealth: number | null) {
  const { sqlite } = getDatabase();
  const pages = sqlite.prepare(`
    SELECT url, status_code AS statusCode, depth FROM site_audit_pages
    WHERE campaign_id = ? ORDER BY depth ASC, url ASC LIMIT 50
  `).all(campaignId) as BriefingPage[];
  const issues = sqlite.prepare(`
    SELECT id, url, severity, category, title, detail FROM site_audit_issues
    WHERE campaign_id = ? ORDER BY
      CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, id ASC
  `).all(campaignId) as BriefingIssue[];

  const pageCount = pages.length;
  const issueCount = issues.length;
  const baseScore = 92;
  const issuePenalty = issueCount * 8;
  const coveragePenalty = Math.max(0, 10 - pageCount) * 2;
  const computedScore = Math.max(35, Math.min(100, baseScore - issuePenalty - coveragePenalty));
  const score = siteHealth ?? (pageCount > 0 ? computedScore : null);
  const hasLlmsTxt = pages.some((page) => page.url.includes("/llms.txt"));
  const shallowPages = pages.filter((page) => page.depth <= 1).length;
  const depthScore = pageCount === 0 ? 0 : Math.round((shallowPages / pageCount) * 100);
  const coverageScore = Math.min(100, pageCount * 10);
  const aiSearchScore = hasLlmsTxt ? 100 : pageCount > 0 ? 35 : 0;
  const issueDensityScore = Math.max(0, 100 - issueCount * 25);

  const severityCounts = issues.reduce<Record<string, number>>((acc, issue) => {
    acc[issue.severity] = (acc[issue.severity] ?? 0) + 1;
    return acc;
  }, {});

  const scoreFactors = [
    { key: "base", label: "기본 점수", points: baseScore, kind: "base" as const },
    ...(issueCount > 0 ? [{ key: "issues", label: `이슈 ${issueCount}건`, points: -issuePenalty, kind: "penalty" as const }] : []),
    ...(coveragePenalty > 0 ? [{ key: "coverage", label: `크롤 범위 부족 (${pageCount}페이지)`, points: -coveragePenalty, kind: "penalty" as const }] : []),
    { key: "final", label: "최종 건강 점수", points: score ?? 0, kind: "total" as const },
  ];

  const radar = [
    { axis: "AI 검색 준비", score: aiSearchScore, hint: hasLlmsTxt ? "llms.txt 경로가 발견되었습니다." : "llms.txt가 없어 AI 크롤러 신호가 약합니다." },
    { axis: "크롤 범위", score: coverageScore, hint: `${pageCount}개 URL이 수집되었습니다.` },
    { axis: "구조 접근성", score: depthScore, hint: `얕은 깊이(0~1) 페이지 비율 ${depthScore}%` },
    { axis: "이슈 밀도", score: issueDensityScore, hint: issueCount === 0 ? "치명·경고 이슈가 없습니다." : `${issueCount}건의 개선 항목이 있습니다.` },
    { axis: "GEO 실행력", score: score ?? 0, hint: "사이트 진단 종합 점수입니다." },
  ];

  const narratives: string[] = [];
  if (pageCount === 0) {
    narratives.push("아직 크롤이 실행되지 않았습니다. 캠페인에서 '크롤 실행'을 눌러 분석을 시작하세요.");
  } else {
    narratives.push(`총 ${pageCount}개 URL을 수집했으며, 기본 92점에서 이슈·범위 페널티를 반영해 ${score ?? computedScore}점이 산출되었습니다.`);
    if (!hasLlmsTxt) narratives.push("llms.txt가 없어 AI 검색·GEO 신호 점수가 크게 깎였습니다. /llms.txt 경로를 추가하고 사이트맵에 노출하세요.");
    if (coveragePenalty > 0) narratives.push(`발견 페이지가 ${pageCount}개로 적어 크롤 범위 페널티 ${coveragePenalty}점이 적용되었습니다. 내부 링크 허브를 강화하세요.`);
    if (issueCount === 0) narratives.push("경고·알림 이슈가 없어 기술·AI 검색 기본 요건은 양호합니다.");
    for (const issue of issues.slice(0, 3)) {
      narratives.push(`[${issue.severity}] ${issue.title}: ${issue.detail}`);
    }
  }

  const recommendations = [
    !hasLlmsTxt && pageCount > 0 ? "llms.txt를 배포하고 내부 링크·사이트맵에 포함하세요." : null,
    coveragePenalty > 0 ? "핵심 랜딩·카테고리 허브 페이지를 늘려 크롤 범위를 확장하세요." : null,
    issueCount > 0 ? "상단 이슈부터 우선순위로 수정한 뒤 재크롤하세요." : null,
    pageCount > 0 && score !== null && score < 75 ? "GEO Cheerio 진단(/audit)과 병행해 온페이지·스키마 신호를 보강하세요." : null,
  ].filter((item): item is string => Boolean(item));

  return {
    ready: pageCount > 0,
    score,
    grade: healthGrade(score),
    computedScore,
    pageCount,
    issueCount,
    hasLlmsTxt,
    scoreFactors,
    severityCounts,
    radar,
    narratives,
    recommendations,
    issues,
    pages: pages.slice(0, 12),
    depthBuckets: [
      { depth: "홈(0)", count: pages.filter((page) => page.depth === 0).length },
      { depth: "1단계", count: pages.filter((page) => page.depth === 1).length },
      { depth: "2단계+", count: pages.filter((page) => page.depth >= 2).length },
    ],
  };
}
