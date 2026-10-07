/**
 * Qshop 계획 P03 — 공통 PageSnapshot.
 * 실제로 받은 페이지 응답을 버전으로 저장하고, 같은 입력이면 같은 결과가 나오는 결정적 규칙으로 진단한다.
 * - 규칙은 기술 오류(technical) / 페이지 권고(recommendation) / 실험적 GEO 가설(hypothesis)로 나누고 버전을 남긴다 (§5.2)
 * - 기존 GEO 진단기(audit.ts)의 HTML 파서와 규칙을 재사용하되, 사이트 단위 파일 규칙은 페이지마다 평가하지 않는다
 * - 원본 HTML이 없으면(Markdown만 있는 렌더링 결과 등) 메타데이터 누락을 판정하지 않는다 (§5.1-4)
 * - FAQ·표·질문형 제목 같은 GEO 가설은 실패여도 알림 수준이며 필수 실패로 만들지 않는다 (§8)
 */
import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import * as cheerio from "cheerio";
import { z } from "zod";
import { AUDIT_RULES, extractJsonLdTypes, parseAuditHtml } from "@/lib/audit";
import { getDatabase } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { requireActiveProject } from "@/lib/projects";

export const PAGE_PARSER_VERSION = "page-facts/1";
export const PAGE_RULES_VERSION = "page-rules/1";
const MAX_STORED_HTML_BYTES = 256 * 1024;
const MAX_VERSIONS_PER_URL = 3;

export type SnapshotRenderMode = "native" | "rendered" | "cache";
export type BodyKind = "html" | "markdown" | "text";

export interface PageObservation {
  url: string;
  finalUrl: string | null;
  statusCode: number;
  contentType: string | null;
  renderMode: SnapshotRenderMode;
  body: string;
  bodyKind: BodyKind;
}

export interface PageFacts {
  title: string | null;
  description: string | null;
  canonical: string | null;
  robotsMeta: string | null;
  lang: string | null;
  h1: string[];
  og: { title: string | null; description: string | null; image: string | null };
  jsonLdTypes: string[];
  jsonLdBlocks: number;
  jsonLdInvalid: number;
  wordCount: number;
}

export type FindingTier = "technical" | "recommendation" | "hypothesis";
export type FindingSeverity = "error" | "warning" | "notice";

export interface PageFinding {
  code: string;
  tier: FindingTier;
  severity: FindingSeverity;
  passed: boolean;
  label: string;
  detail: string;
  /** 판정에 쓴 실제 관측값 (제목 원문, canonical 주소 등) */
  evidence: string | null;
}

export interface PageAnalysis {
  facts: PageFacts | null;
  findings: PageFinding[];
  /** HTML 규칙을 적용하지 않은 이유 */
  skipped: string | null;
  contentHash: string;
  parserVersion: string;
  rulesVersion: string;
}

const clean = (value: string | undefined | null) => value?.replace(/\s+/g, " ").trim() || null;

export function extractPageFacts(html: string, pageUrl: string): PageFacts {
  const $ = cheerio.load(html);
  const canonicalHref = clean($("link[rel='canonical']").first().attr("href"));
  let canonical = canonicalHref;
  if (canonicalHref) {
    try { canonical = new URL(canonicalHref, pageUrl).toString(); } catch { canonical = canonicalHref; }
  }
  const blocks = $("script[type='application/ld+json']");
  let jsonLdInvalid = 0;
  blocks.each((_, node) => {
    try { JSON.parse($(node).text()); } catch { jsonLdInvalid += 1; }
  });
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  return {
    title: clean($("title").first().text()),
    description: clean($("meta[name='description']").attr("content")),
    canonical,
    robotsMeta: clean($("meta[name='robots']").attr("content")),
    lang: clean($("html").attr("lang")),
    h1: $("h1").map((_, node) => clean($(node).text())).get().filter((text): text is string => Boolean(text)).slice(0, 5),
    og: {
      title: clean($("meta[property='og:title']").attr("content")),
      description: clean($("meta[property='og:description']").attr("content")),
      image: clean($("meta[property='og:image']").attr("content")),
    },
    jsonLdTypes: extractJsonLdTypes($),
    jsonLdBlocks: blocks.length,
    jsonLdInvalid,
    wordCount: bodyText ? bodyText.split(" ").length : 0,
  };
}

function inSite(url: string, domain: string) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    const base = domain.toLowerCase().replace(/^www\./, "");
    return host === base || host.endsWith(`.${base}`);
  } catch {
    return false;
  }
}

/** 기존 진단기 규칙의 성격 — 사이트 단위 파일 규칙과 우리 규칙과 겹치는 항목은 페이지마다 평가하지 않는다 */
const AUDIT_RULE_TIERS: Record<string, FindingTier | "skip"> = {
  "seo-title-meta": "skip", "seo-indexable": "skip", "tech-ai-robots": "skip", "tech-llms": "skip", "tech-sitemap": "skip",
  "seo-headings": "recommendation", "seo-canonical": "recommendation", "seo-og": "recommendation",
  "seo-internal-links": "recommendation", "seo-image-alt": "recommendation", "tech-jsonld": "recommendation",
};

const finding = (code: string, tier: FindingTier, severity: FindingSeverity, label: string, passed: boolean, detail: string, evidence: string | null): PageFinding =>
  ({ code, tier, severity: passed ? "notice" : severity, passed, label, detail, evidence });

function htmlFindings(facts: PageFacts, html: string, pageUrl: string, domain: string): PageFinding[] {
  const findings: PageFinding[] = [
    finding("title-present", "technical", "warning", "<title> 존재", Boolean(facts.title), facts.title ? "제목이 있습니다." : "원본 HTML에 <title>이 없거나 비어 있습니다.", facts.title),
    finding("jsonld-parse", "technical", "error", "JSON-LD 구문", facts.jsonLdInvalid === 0,
      facts.jsonLdInvalid ? "구문 오류가 있는 JSON-LD 블록은 검색엔진이 읽지 못합니다." : facts.jsonLdBlocks ? "모든 JSON-LD 블록을 읽을 수 있습니다." : "JSON-LD 블록이 없습니다.",
      facts.jsonLdBlocks ? `${facts.jsonLdBlocks}개 중 ${facts.jsonLdInvalid}개 구문 오류` : null),
    finding("canonical-host", "technical", "warning", "canonical 대상 사이트", !facts.canonical || inSite(facts.canonical, domain),
      facts.canonical && !inSite(facts.canonical, domain) ? "canonical이 다른 사이트를 가리켜 이 페이지 대신 그 주소가 대표로 쓰일 수 있습니다." : "canonical이 없거나 같은 사이트를 가리킵니다.",
      facts.canonical),
    finding("robots-noindex", "technical", "warning", "검색 색인 허용(meta robots)", !/noindex/i.test(facts.robotsMeta ?? ""),
      /noindex/i.test(facts.robotsMeta ?? "") ? "meta robots에 noindex가 있어 검색 색인에서 빠집니다. 의도한 설정인지 확인하세요." : "meta robots에 noindex가 없습니다.",
      facts.robotsMeta),
    finding("description-present", "recommendation", "notice", "meta description", Boolean(facts.description), facts.description ? "설명이 있습니다." : "meta description이 없습니다.", facts.description),
    finding("lang-present", "recommendation", "notice", "문서 언어(lang)", Boolean(facts.lang), facts.lang ? `lang="${facts.lang}"` : "<html lang>이 없습니다.", facts.lang),
  ];
  const snapshot = parseAuditHtml(html, pageUrl);
  const noFiles = { robots: null, llms: null, sitemap: null };
  for (const rule of AUDIT_RULES) {
    const tier = AUDIT_RULE_TIERS[rule.code] ?? "hypothesis";
    if (tier === "skip" || rule.manual || !rule.check) continue;
    const checked = rule.check(snapshot, noFiles);
    findings.push(finding(rule.code, tier, "notice", rule.label, checked.passed, tier === "hypothesis" ? `${checked.detail} (GEO 가설 — 페이지 유형에 따라 필요 없을 수 있음)` : checked.detail, checked.detail));
  }
  return findings;
}

export function analyzeObservation(observation: PageObservation, domain: string): PageAnalysis {
  const base = {
    contentHash: createHash("sha256").update(observation.body).digest("hex"),
    parserVersion: PAGE_PARSER_VERSION,
    rulesVersion: PAGE_RULES_VERSION,
  };
  const ok = observation.statusCode >= 200 && observation.statusCode < 300;
  const http = finding("http-status", "technical", "error", "HTTP 응답", ok, ok ? "정상 응답입니다." : "오류 응답이라 검색엔진과 AI가 이 내용을 쓰지 못합니다.", `HTTP ${observation.statusCode}`);
  const skippedOnly = (skipped: string): PageAnalysis => ({ ...base, facts: null, findings: [http], skipped });
  if (!ok) return skippedOnly(`HTTP ${observation.statusCode} 응답이라 HTML 규칙을 적용하지 않았습니다.`);
  if (observation.bodyKind === "markdown") return skippedOnly("원본 HTML이 없어(Markdown만 수집) 메타데이터 규칙을 적용하지 않았습니다.");
  if (observation.bodyKind !== "html") return skippedOnly(`HTML 문서가 아니어서(${observation.contentType ?? "형식 미상"}) HTML 규칙을 적용하지 않았습니다.`);
  const pageUrl = observation.finalUrl ?? observation.url;
  const facts = extractPageFacts(observation.body, pageUrl);
  return { ...base, facts, findings: [http, ...htmlFindings(facts, observation.body, pageUrl, domain)], skipped: null };
}

function cappedHtml(observation: PageObservation) {
  if (observation.bodyKind !== "html") return { html: null, truncated: false };
  const bytes = Buffer.from(observation.body);
  if (bytes.byteLength <= MAX_STORED_HTML_BYTES) return { html: observation.body, truncated: false };
  // 잘린 멀티바이트 문자가 대체 문자로 바뀌어 한도를 넘지 않게 끝을 다듬는다
  return { html: bytes.subarray(0, MAX_STORED_HTML_BYTES).toString("utf8").replace(/\uFFFD+$/, ""), truncated: true };
}

/**
 * 스냅샷 저장. 직전 버전과 내용·상태·수집 방식·규칙 버전이 같으면 새로 만들지 않고 마지막 확인 시각만 갱신한다.
 * URL마다 최근 버전만 남긴다.
 */
export function recordPageSnapshot(sqlite: Database.Database, input: {
  projectId: number;
  campaignId: number | null;
  observation: PageObservation;
  analysis: PageAnalysis;
  now: string;
}): number {
  const { projectId, campaignId, observation, analysis, now } = input;
  const latest = sqlite.prepare(`
    SELECT id, content_hash, status_code, render_mode, parser_version, rules_version FROM page_snapshots
    WHERE project_id = ? AND url = ? ORDER BY captured_at DESC, id DESC LIMIT 1
  `).get(projectId, observation.url) as { id: number; content_hash: string; status_code: number; render_mode: string; parser_version: string; rules_version: string } | undefined;
  if (latest && latest.content_hash === analysis.contentHash && latest.status_code === observation.statusCode && latest.render_mode === observation.renderMode
    && latest.parser_version === analysis.parserVersion && latest.rules_version === analysis.rulesVersion) {
    sqlite.prepare("UPDATE page_snapshots SET last_seen_at = ?, campaign_id = COALESCE(?, campaign_id) WHERE id = ?").run(now, campaignId, latest.id);
    return latest.id;
  }
  const { html, truncated } = cappedHtml(observation);
  const inserted = sqlite.prepare(`
    INSERT INTO page_snapshots (project_id, campaign_id, url, final_url, status_code, content_type, render_mode, content_hash, bytes,
      html, html_truncated, facts, findings, skipped_reason, parser_version, rules_version, captured_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    projectId, campaignId, observation.url, observation.finalUrl, observation.statusCode, observation.contentType, observation.renderMode,
    analysis.contentHash, Buffer.byteLength(observation.body), html, truncated ? 1 : 0,
    analysis.facts ? JSON.stringify(analysis.facts) : null, JSON.stringify(analysis.findings), analysis.skipped,
    analysis.parserVersion, analysis.rulesVersion, now, now,
  );
  sqlite.prepare(`
    DELETE FROM page_snapshots WHERE project_id = ? AND url = ? AND id NOT IN (
      SELECT id FROM page_snapshots WHERE project_id = ? AND url = ? ORDER BY captured_at DESC, id DESC LIMIT ?
    )
  `).run(projectId, observation.url, projectId, observation.url, MAX_VERSIONS_PER_URL);
  return Number(inserted.lastInsertRowid);
}

interface SnapshotRow {
  id: number; url: string; final_url: string | null; status_code: number; content_type: string | null; render_mode: SnapshotRenderMode;
  content_hash: string; bytes: number; html_stored: number; html_truncated: number; facts: string | null; findings: string;
  skipped_reason: string | null; parser_version: string; rules_version: string; captured_at: string; last_seen_at: string;
}

/** 실패한 기술 규칙 수 — 목록 화면용 */
export function countTechnicalIssues(findingsJson: string | null) {
  if (!findingsJson) return 0;
  try {
    return (JSON.parse(findingsJson) as PageFinding[]).filter((item) => item.tier === "technical" && !item.passed).length;
  } catch {
    return 0;
  }
}

export function getPageSnapshot(idInput: unknown) {
  const project = requireActiveProject();
  const id = z.coerce.number().int().positive().parse(idInput);
  const { sqlite } = getDatabase();
  const row = sqlite.prepare(`
    SELECT id, url, final_url, status_code, content_type, render_mode, content_hash, bytes, html IS NOT NULL AS html_stored, html_truncated,
      facts, findings, skipped_reason, parser_version, rules_version, captured_at, last_seen_at
    FROM page_snapshots WHERE id = ? AND project_id = ?
  `).get(id, project.id) as SnapshotRow | undefined;
  if (!row) throw new AppError("페이지 스냅샷을 찾을 수 없습니다. 오래된 버전은 최근 3개만 남깁니다.", 404, "NOT_FOUND");
  const versions = sqlite.prepare(`
    SELECT id, captured_at AS capturedAt, last_seen_at AS lastSeenAt, content_hash AS contentHash, status_code AS statusCode, render_mode AS renderMode
    FROM page_snapshots WHERE project_id = ? AND url = ? ORDER BY captured_at DESC, id DESC
  `).all(project.id, row.url) as Array<{ id: number; capturedAt: string; lastSeenAt: string; contentHash: string; statusCode: number; renderMode: SnapshotRenderMode }>;
  return {
    id: row.id,
    url: row.url,
    finalUrl: row.final_url,
    statusCode: row.status_code,
    contentType: row.content_type,
    renderMode: row.render_mode,
    contentHash: row.content_hash,
    bytes: row.bytes,
    htmlStored: row.html_stored === 1,
    htmlTruncated: row.html_truncated === 1,
    facts: row.facts ? JSON.parse(row.facts) as PageFacts : null,
    findings: JSON.parse(row.findings) as PageFinding[],
    skipped: row.skipped_reason,
    parserVersion: row.parser_version,
    rulesVersion: row.rules_version,
    capturedAt: row.captured_at,
    lastSeenAt: row.last_seen_at,
    versions,
  };
}
