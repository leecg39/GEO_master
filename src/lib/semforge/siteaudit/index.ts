import type { SeoFinding } from "@/lib/seo/contracts";
import { scoreFindings } from "@/lib/seo/scoring";
import { SEO_ANALYSIS_VERSION } from "@/lib/seo/registry";
import { SEO_CONFIG_HASH } from "@/lib/seo/run-analysis";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDatabase } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { resolveFirecrawlApiKey } from "@/lib/settings";
import { normalizeDomain } from "@/lib/semforge/utils/domain";
import { requireSemforgeSubscription } from "@/lib/semforge-subscription";
import { requireActiveProject } from "@/lib/projects";
import { mapPublicSite } from "@/lib/integrations/firecrawl";
import {
  capturePage,
  persistSnapshot,
  latestSnapshots,
} from "@/lib/site-ops/snapshots";
import { fetchPublicText } from "@/lib/url-security";
import { validateLlmsTxt } from "@/lib/llms-txt";

export function firecrawlMode(): "live" | "mock" | "unavailable" {
  if (resolveFirecrawlApiKey().value) return "live";
  return process.env.SEMFORGE_MOCK_FIRECRAWL?.trim() === "1"
    ? "mock"
    : "unavailable";
}
export function firecrawlConfigured() {
  return firecrawlMode() !== "unavailable";
}

export function listSiteAuditCampaigns() {
  const project = requireActiveProject();
  return getDatabase()
    .sqlite.prepare(
      `SELECT id,name,domain,status,
    CASE WHEN data_state='live' AND analysis_version IS NOT NULL THEN site_health END AS siteHealth,
    data_state AS dataState,llms_state AS llmsState,last_run_at AS lastRunAt,created_at AS createdAt
    FROM site_audit_campaigns WHERE project_id=? ORDER BY updated_at DESC,id DESC`,
    )
    .all(project.id);
}

export function getSiteAuditWorkspace() {
  const resolved = resolveFirecrawlApiKey();
  const mode = firecrawlMode();
  return {
    campaigns: listSiteAuditCampaigns(),
    firecrawl: {
      status: resolved.storageError ? "error" : mode,
      source: mode === "mock" ? "mock-dev" : "firecrawl",
      configured: mode !== "unavailable",
      reason: resolved.storageError
        ? "저장된 Firecrawl 키를 읽을 수 없습니다. 설정에서 다시 저장하세요."
        : mode === "unavailable"
          ? "여러 URL 탐색은 Firecrawl 연결이 필요합니다. 아래 작업대에서는 URL 하나를 직접 수집할 수 있습니다."
          : mode === "mock"
            ? "샘플 URL 탐색입니다. 실제 HTTP 응답이나 점수를 제공하지 않습니다."
            : undefined,
    },
  };
}

export const siteAuditCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    domain: z.string().trim().min(3).max(253),
  })
  .strict();
export function createSiteAuditCampaign(input: unknown) {
  requireSemforgeSubscription();
  const project = requireActiveProject();
  const parsed = siteAuditCreateSchema.parse(input);
  const domain = normalizeDomain(parsed.domain);
  const now = new Date().toISOString();
  const result = getDatabase()
    .sqlite.prepare(
      `INSERT INTO site_audit_campaigns
    (project_id,name,domain,status,data_state,created_at,updated_at) VALUES (?,?,?,'idle','unavailable',?,?)`,
    )
    .run(project.id, parsed.name, domain, now, now);
  return {
    id: Number(result.lastInsertRowid),
    name: parsed.name,
    domain,
    status: "idle",
  };
}

export function ownedCampaign(idInput: unknown) {
  const id = z.coerce.number().int().positive().parse(idInput);
  const project = requireActiveProject();
  const row = getDatabase()
    .sqlite.prepare(
      `SELECT id,project_id AS projectId,name,domain,status,
    data_state AS dataState,llms_state AS llmsState,site_health AS siteHealth,analysis_version AS analysisVersion,analysis_config_hash AS analysisConfigHash,score_coverage AS scoreCoverage,last_run_at AS lastRunAt,updated_at AS updatedAt
    FROM site_audit_campaigns WHERE id=? AND project_id=?`,
    )
    .get(id, project.id) as
    | {
        id: number;
        projectId: number;
        name: string;
        domain: string;
        status: string;
        dataState: string;
        llmsState: string;
        siteHealth: number | null;
        analysisVersion: string | null;
        analysisConfigHash: string | null;
        scoreCoverage: number | null;
        lastRunAt: string | null;
        updatedAt: string;
      }
    | undefined;
  if (!row)
    throw new AppError(
      "활성 프로젝트의 캠페인을 찾을 수 없습니다.",
      404,
      "CAMPAIGN_NOT_FOUND",
    );
  return row;
}

async function checkLlms(origin: string, signal?: AbortSignal) {
  try {
    const file = await fetchPublicText(`${origin}/llms.txt`, 7_000, {
      origin,
      signal,
    });
    if (file.status === 404 || file.status === 410) return "missing";
    if (file.status !== 200) return "unknown";
    return /text\/(plain|markdown|x-markdown)/i.test(file.contentType) &&
      validateLlmsTxt(file.text).valid
      ? "present"
      : "invalid";
  } catch {
    return "unknown";
  }
}

interface SiteAuditRunResult {
  campaignId: number;
  status: string;
  crawledPages: number;
  discoveredPages: number;
  failedPages: number;
  issueCount: number;
  siteHealth: number | null;
  source: string;
  provider: {
    status: string;
    source: string;
    data: { pages: number; issues: number };
    fetchedAt: string;
  };
  capturedAt: string;
}

export async function runSiteAuditCampaign(
  idInput: unknown,
  signal?: AbortSignal,
  requestId?: string,
): Promise<SiteAuditRunResult> {
  requireSemforgeSubscription();
  const campaign = ownedCampaign(idInput);
  const { sqlite } = getDatabase();
  const requestKey = z
    .string()
    .min(1)
    .max(120)
    .parse(requestId ?? randomUUID());
  const existing = sqlite
    .prepare(
      "SELECT project_id,campaign_id,status,result FROM integration_jobs WHERE request_key=?",
    )
    .get(requestKey) as
    | {
        project_id: number;
        campaign_id: number;
        status: string;
        result: string | null;
      }
    | undefined;
  if (existing) {
    if (
      existing.project_id !== campaign.projectId ||
      existing.campaign_id !== campaign.id
    )
      throw new AppError(
        "다른 캠페인에서 사용한 요청 ID입니다.",
        409,
        "IDEMPOTENCY_KEY_REUSED",
      );
    if (existing.result)
      return JSON.parse(existing.result) as SiteAuditRunResult;
    throw new AppError(
      existing.status === "running"
        ? "같은 요청이 진행 중입니다."
        : "이 요청은 실패했습니다. 새 실행으로 재시도하세요.",
      409,
      "JOB_ALREADY_ATTEMPTED",
    );
  }
  const mode = firecrawlMode();
  if (mode === "unavailable")
    throw new AppError(
      "Firecrawl 키를 설정하거나 작업대에서 URL을 직접 수집하세요.",
      422,
      "MAP_UNAVAILABLE",
    );
  if (
    campaign.status === "running" &&
    Date.now() - Date.parse(campaign.updatedAt) < 10 * 60_000
  )
    throw new AppError("이미 수집 중인 캠페인입니다.", 409, "CAMPAIGN_RUNNING");
  const token = randomUUID();
  const budgetPeriod = new Date().toISOString().slice(0, 7);
  const configuredLimit = Number(
    process.env.GEO_FIRECRAWL_MONTHLY_MAP_LIMIT ?? 100,
  );
  if (!Number.isSafeInteger(configuredLimit) || configuredLimit < 0)
    throw new AppError(
      "Firecrawl 월간 탐색 한도 설정이 잘못되었습니다.",
      422,
      "MAP_BUDGET_CONFIG",
    );
  sqlite.transaction(() => {
    const used = (
      sqlite
        .prepare(
          "SELECT COALESCE(SUM(reserved_calls),0) AS n FROM integration_jobs WHERE kind='firecrawl_map' AND budget_period=?",
        )
        .get(budgetPeriod) as { n: number }
    ).n;
    if (mode === "live" && used >= configuredLimit)
      throw new AppError(
        "Firecrawl 월간 URL 탐색 한도를 소진했습니다. 직접 URL 수집은 계속 사용할 수 있습니다.",
        429,
        "MAP_BUDGET_EXCEEDED",
      );
    sqlite
      .prepare(
        "INSERT INTO integration_jobs(project_id,campaign_id,request_key,kind,status,budget_period,reserved_calls,created_at) VALUES (?,?,?,'firecrawl_map','running',?,?,?)",
      )
      .run(
        campaign.projectId,
        campaign.id,
        requestKey,
        budgetPeriod,
        mode === "live" ? 1 : 0,
        new Date().toISOString(),
      );
    sqlite
      .prepare(
        "UPDATE site_audit_campaigns SET status='running',run_token=?,updated_at=? WHERE id=?",
      )
      .run(token, new Date().toISOString(), campaign.id);
  })();
  const origin = `https://${campaign.domain}`;
  try {
    const links =
      mode === "mock"
        ? [origin + "/", origin + "/about"]
        : [
            ...new Set([
              origin + "/",
              ...(await mapPublicSite(
                origin,
                resolveFirecrawlApiKey().value!,
                signal,
              )),
            ]),
          ].slice(0, 25);
    sqlite.transaction(() => {
      sqlite
        .prepare(
          "DELETE FROM site_audit_pages WHERE campaign_id=? AND data_state!='legacy_estimate'",
        )
        .run(campaign.id);
      sqlite
        .prepare(
          "DELETE FROM site_audit_issues WHERE campaign_id=? AND data_state!='legacy_estimate'",
        )
        .run(campaign.id);
      for (const url of links)
        sqlite
          .prepare(
            `INSERT INTO site_audit_pages (campaign_id,url,data_state,fetch_state)
        VALUES (?,?,?,'discovered')`,
          )
          .run(campaign.id, url, mode);
    })();
    let fetched = 0;
    let failed = 0;
    let issueCount = 0;
    const findings: SeoFinding[] = [];
    if (mode === "live") {
      let index = 0;
      await Promise.all(
        Array.from({ length: Math.min(3, links.length) }, async () => {
          while (index < links.length) {
            if (signal?.aborted) break;
            const url = links[index++];
            const capture = await capturePage(
              campaign.projectId,
              campaign.id,
              url,
              origin,
              signal,
            );
            const current = sqlite
              .prepare("SELECT run_token FROM site_audit_campaigns WHERE id=?")
              .get(campaign.id) as { run_token: string } | undefined;
            if (current?.run_token !== token)
              throw new AppError(
                "새 수집 작업이 시작되어 이전 결과 저장을 중단했습니다.",
                409,
                "STALE_RUN",
              );
            sqlite.transaction(() => {
              const snapshot = persistSnapshot(capture);
              sqlite
                .prepare(
                  `UPDATE site_audit_pages SET status_code=?,title=?,response_ms=?,bytes=?,captured_at=?,
              fetch_state=?,data_state=?,snapshot_id=? WHERE campaign_id=? AND url=? AND data_state!='legacy_estimate'`,
                )
                .run(
                  snapshot.statusCode,
                  snapshot.metadata?.title ?? null,
                  snapshot.responseMs,
                  snapshot.bytes,
                  snapshot.capturedAt,
                  snapshot.fetchState,
                  snapshot.dataState,
                  snapshot.id,
                  campaign.id,
                  url,
                );
              if (snapshot.fetchState === "fetched") fetched++;
              else failed++;
              findings.push(...snapshot.analysis!.findings);
              for (const finding of snapshot.analysis!.findings) {
                if (finding.status !== "fail") continue;
                sqlite.prepare(`INSERT INTO site_audit_issues
                  (campaign_id,url,severity,category,title,detail,created_at,data_state,
                    finding_id,snapshot_id,rule_version,finding_status,evidence_refs)
                  VALUES (?,?,?,?,?,?,?,'live',?,?,?,?,?)`).run(
                    campaign.id, url, "warning", finding.category, finding.ruleId, finding.explanation,
                    new Date().toISOString(), finding.id, snapshot.id, finding.ruleVersion, finding.status,
                    JSON.stringify(finding.evidenceRefs));
                issueCount++;
              }
            })();
          }
        }),
      );
    }
    const llmsState =
      mode === "live" ? await checkLlms(origin, signal) : "unknown";
    const status =
      mode === "mock"
        ? "completed"
        : fetched === 0
          ? "failed"
          : failed || signal?.aborted
            ? "partial"
            : "completed";
    const scoring = scoreFindings(findings);
    const health = mode === "live" ? scoring.value : null;
    const now = new Date().toISOString();
    sqlite
      .prepare(
        `UPDATE site_audit_campaigns SET status=?,site_health=?,data_state=?,llms_state=?,last_run_at=?,updated_at=?,run_token=NULL,analysis_version=?,analysis_config_hash=?,score_coverage=?
      WHERE id=? AND run_token=?`,
      )
      .run(status, health, mode, llmsState, now, now, SEO_ANALYSIS_VERSION, SEO_CONFIG_HASH, scoring.coverage, campaign.id, token);
    const result: SiteAuditRunResult = {
      campaignId: campaign.id,
      status,
      crawledPages: fetched,
      discoveredPages: links.length,
      failedPages: failed,
      issueCount,
      siteHealth: health,
      source: mode === "mock" ? "mock-dev" : "firecrawl-map/native-fetch",
      provider: {
        status: mode,
        source: "native_fetch",
        data: { pages: fetched, issues: issueCount },
        fetchedAt: now,
      },
      capturedAt: now,
    };
    sqlite
      .prepare(
        "UPDATE integration_jobs SET status=?,result=?,completed_at=? WHERE request_key=?",
      )
      .run(status, JSON.stringify(result), now, requestKey);
    return result;
  } catch (error) {
    sqlite
      .prepare(
        "UPDATE integration_jobs SET status='failed',completed_at=? WHERE request_key=?",
      )
      .run(new Date().toISOString(), requestKey);
    sqlite
      .prepare(
        "UPDATE site_audit_campaigns SET status='failed',site_health=NULL,data_state='error',run_token=NULL,updated_at=? WHERE id=? AND run_token=?",
      )
      .run(new Date().toISOString(), campaign.id, token);
    throw error;
  }
}

export function deleteSiteAuditCampaign(idInput: unknown) {
  requireSemforgeSubscription();
  const campaign = ownedCampaign(idInput);
  if (campaign.status === "running")
    throw new AppError(
      "진행 중인 수집이 끝난 뒤 삭제하세요.",
      409,
      "CAMPAIGN_RUNNING",
    );
  getDatabase().sqlite.transaction(() => {
    getDatabase()
      .sqlite.prepare("DELETE FROM change_sets WHERE campaign_id=?")
      .run(campaign.id);
    getDatabase()
      .sqlite.prepare("DELETE FROM site_audit_campaigns WHERE id=?")
      .run(campaign.id);
  })();
  return { id: campaign.id, deleted: true, name: campaign.name };
}

export function getSiteAuditOverview(idInput: unknown) {
  const campaign = ownedCampaign(idInput);
  const { sqlite } = getDatabase();
  const pages = sqlite
    .prepare(
      `SELECT url,CASE WHEN data_state='live' THEN status_code END AS statusCode,
    data_state AS dataState,fetch_state AS fetchState FROM site_audit_pages
    WHERE campaign_id=? AND data_state!='legacy_estimate' ORDER BY url LIMIT 50`,
    )
    .all(campaign.id) as {
    url: string;
    statusCode: number | null;
    dataState: string;
    fetchState: string;
  }[];
  const issues = sqlite
    .prepare(
      `SELECT id,url,severity,category,title,detail,finding_id AS findingId,snapshot_id AS snapshotId,rule_version AS ruleVersion,finding_status AS findingStatus,evidence_refs AS evidenceRefs FROM site_audit_issues WHERE campaign_id=? AND data_state!='legacy_estimate' ORDER BY id`,
    )
    .all(campaign.id) as {
    id: number;
    url: string;
    severity: string;
    category: string;
    title: string;
    detail: string;
  }[];
  const legacy = (
    sqlite
      .prepare(
        "SELECT COUNT(*) AS n FROM site_audit_pages WHERE campaign_id=? AND data_state='legacy_estimate'",
      )
      .get(campaign.id) as { n: number }
  ).n;
  const score = campaign.dataState === "live" && campaign.analysisVersion ? campaign.siteHealth : null;
  const measured = pages.filter(
    (p) => p.dataState === "live" && p.fetchState === "fetched",
  ).length;
  return {
    locked: false,
    campaign: { ...campaign, siteHealth: score },
    snapshots: latestSnapshots(campaign.id, campaign.projectId),
    firecrawl: getSiteAuditWorkspace().firecrawl,
    briefing: {
      ready: pages.length > 0 || legacy > 0,
      score,
      scoreCoverage: campaign.scoreCoverage,
      analysisVersion: campaign.analysisVersion,
      analysisConfigHash: campaign.analysisConfigHash,
      pageCount: pages.length,
      measuredPages: measured,
      issueCount: issues.length,
      llmsState: campaign.llmsState,
      legacyPages: legacy,
      narratives: [
        `발견 ${pages.length}개 · HTML 수집 성공 ${measured}개. 점수는 실제 판정한 기술 검사 통과율이며 미확인·해당 없음은 분모에서 제외합니다. 검색엔진 공식 점수가 아닙니다.`,
        `검사 범위 ${campaign.scoreCoverage === null ? "미측정" : `${campaign.scoreCoverage}%`} · 규칙 ${campaign.analysisVersion ?? "구버전 · 재수집 필요"}. 같은 규칙·설정·URL 범위에서만 전후 점수를 비교하세요.`,
        "URL 개수·추정 깊이·llms.txt 유무는 점수에 반영하지 않습니다.",
        ...(legacy
          ? [
              `기존 가정 기반 URL ${legacy}개를 legacy_estimate로 보존했습니다. 실제 상태는 재수집해야 알 수 있습니다.`,
            ]
          : []),
        ...(campaign.dataState === "mock"
          ? ["샘플 URL 목록입니다. HTTP 응답과 진단 점수는 미측정입니다."]
          : []),
      ],
      recommendations: issues.length
        ? [
            "수집 실패와 기술 오류를 먼저 확인한 뒤, 아래 페이지 작업대에서 수정안을 준비하세요.",
          ]
        : [],
      issues,
      pages,
    },
  };
}
