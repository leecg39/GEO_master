import * as cheerio from "cheerio";
import { parseAuditHtml } from "@/lib/audit";
import { getDatabase } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { fetchPublicText } from "@/lib/url-security";
import type { PageMetadata, PageRule, PageSnapshot, PageType } from "./types";

import { runSeoAnalysis } from "@/lib/seo/run-analysis";
import { hashText, normalizeText, schemaEntities, stableJson } from "@/lib/seo/normalize";
export { hashText, normalizeText, schemaEntities, stableJson } from "@/lib/seo/normalize";

export const PARSER_VERSION = "site-ops/2";

export function analyzePage(html: string, url: string, robotsHeader = "") {
  const audit = parseAuditHtml(html, url);
  const $ = cheerio.load(html);
  const schemas: unknown[] = [];
  let jsonLdErrors = 0;
  $("script[type='application/ld+json']").each((_, node) => {
    try {
      schemas.push(JSON.parse($(node).text()));
    } catch {
      jsonLdErrors++;
    }
  });
  const jsonLd = schemaEntities(schemas);
  const ogImage = $("meta[property='og:image']").attr("content") ?? "";
  const robots = $("meta[name='robots']").attr("content") ?? "";
  $("script,style,noscript,template").remove();
  const bodyText = normalizeText($("body").text());
  const types = jsonLd.flatMap((item) =>
    Array.isArray(item["@type"]) ? item["@type"] : [item["@type"]],
  );
  const pageType: PageType = types.includes("Product")
    ? "Product"
    : types.some((type) =>
          ["Article", "BlogPosting", "NewsArticle"].includes(String(type)),
        )
      ? "BlogPosting"
      : new URL(url).pathname === "/"
        ? "WebSite"
        : "WebPage";
  const resolve = (value: string) => {
    try {
      return value ? new URL(value, url).toString() : "";
    } catch {
      return value;
    }
  };
  const metadata: PageMetadata = {
    title: audit.title,
    description: audit.description,
    canonical: resolve(audit.canonical),
    ogImage: resolve(ogImage),
    robots,
    robotsHeader,
    jsonLd,
    jsonLdErrors,
    pageType,
    heading: $("h1").first().text().trim(),
    bodyText: bodyText.slice(0, 30_000),
    bodyHash: hashText(bodyText),
  };
  const rule = (
    code: string,
    category: PageRule["category"],
    passed: boolean,
    detail: string,
  ): PageRule => ({ code, category, passed, detail, version: PARSER_VERSION });
  const rules = [
    rule(
      "title",
      "technical",
      Boolean(audit.title),
      audit.title ? "HTML 제목 확인" : "HTML title이 없습니다.",
    ),
    rule(
      "jsonld-syntax",
      "technical",
      jsonLdErrors === 0,
      jsonLdErrors
        ? `JSON-LD 파싱 오류 ${jsonLdErrors}건`
        : "JSON-LD 문법 오류 없음",
    ),
    rule(
      "description",
      "recommendation",
      Boolean(audit.description),
      audit.description
        ? "검색 설명 확인"
        : "페이지 내용을 설명하는 meta description을 검토하세요.",
    ),
    rule(
      "canonical",
      "recommendation",
      Boolean(audit.canonical),
      audit.canonical || "대표 URL을 확인하세요.",
    ),
    rule(
      "index-policy",
      "recommendation",
      !/\b(noindex|none)\b/i.test(`${robots} ${robotsHeader}`),
      `색인 정책: ${robots || "메타 미지정"} / HTTP: ${robotsHeader || "미지정"}. 공개 의도에 맞게 검토하세요.`,
    ),
    rule(
      "schema-type",
      "recommendation",
      jsonLd.length > 0,
      jsonLd.length
        ? `구조화 데이터 ${jsonLd.length}개`
        : `${pageType} 페이지에 맞는 스키마를 검토하세요.`,
    ),
    rule(
      "answer-first",
      "experimental",
      audit.firstParagraph.length >= 40,
      "핵심 답변을 도입부에 배치하는 GEO 가설이며 검색 순위 요건이 아닙니다.",
    ),
  ];
  const markdown = $("h1,h2,h3,p,li")
    .map((_, node) => {
      const text = normalizeText($(node).text());
      return /^h[1-3]$/.test(node.tagName)
        ? `${"#".repeat(Number(node.tagName[1]))} ${text}`
        : node.tagName === "li"
          ? `- ${text}`
          : text;
    })
    .get()
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 100_000);
  return {
    metadata,
    rules,
    markdown,
    revisionHash: hashText(stableJson(metadata)),
  };
}

type SnapshotCapture = Omit<PageSnapshot, "id" | "analysis"> & {
  rawHtml: string | null;
  markdown: string | null;
};
export async function capturePage(
  projectId: number,
  campaignId: number,
  url: string,
  origin: string,
  signal?: AbortSignal,
): Promise<SnapshotCapture> {
  const started = Date.now();
  const base = {
    projectId,
    campaignId,
    url,
    parserVersion: PARSER_VERSION,
    renderMode: "native_fetch" as const,
  };
  try {
    const page = await fetchPublicText(url, 12_000, { origin, signal });
    const html = /(?:text\/html|application\/xhtml\+xml)/i.test(
      page.contentType,
    );
    const successful = page.status >= 200 && page.status < 300 && html;
    const parsed = successful
      ? analyzePage(page.text, page.url, page.robotsHeader)
      : null;
    return {
      ...base,
      finalUrl: page.url,
      statusCode: page.status,
      contentType: page.contentType,
      fetchState: successful ? "fetched" : "failed",
      dataState: "live",
      capturedAt: new Date().toISOString(),
      contentHash: hashText(page.text),
      revisionHash: parsed?.revisionHash ?? null,
      responseMs: Date.now() - started,
      bytes: Buffer.byteLength(page.text),
      metadata: parsed?.metadata ?? null,
      rules: parsed?.rules ?? [],
      errorCode: successful ? null : !html ? "NOT_HTML" : `HTTP_${page.status}`,
      rawHtml: html ? page.text : null,
      responseHeaders: Object.fromEntries(Object.entries(page.seoHeaders ?? {}).filter(([key]) => ["content-type", "content-language", "x-robots-tag", "last-modified"].includes(key))),
      markdown: parsed?.markdown ?? null,
    };
  } catch (error) {
    return {
      ...base,
      finalUrl: null,
      statusCode: null,
      contentType: null,
      fetchState: "failed",
      dataState: "error",
      capturedAt: null,
      contentHash: null,
      revisionHash: null,
      responseMs: Date.now() - started,
      bytes: null,
      metadata: null,
      rules: [],
      rawHtml: null,
      responseHeaders: {},
      markdown: null,
      errorCode: signal?.aborted
        ? "CANCELED"
        : error instanceof AppError
          ? error.code
          : "FETCH_FAILED",
    };
  }
}

export function persistSnapshot(snapshot: SnapshotCapture): PageSnapshot {
  const { sqlite } = getDatabase();
  const inserted = sqlite
    .prepare(
      `INSERT INTO page_snapshots
    (project_id,campaign_id,url,final_url,status_code,content_type,fetch_state,data_state,render_mode,captured_at,
      content_hash,revision_hash,response_ms,bytes,raw_html,markdown,metadata,rules,parser_version,error_code,response_headers)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      snapshot.projectId,
      snapshot.campaignId,
      snapshot.url,
      snapshot.finalUrl,
      snapshot.statusCode,
      snapshot.contentType,
      snapshot.fetchState,
      snapshot.dataState,
      snapshot.renderMode,
      snapshot.capturedAt,
      snapshot.contentHash,
      snapshot.revisionHash,
      snapshot.responseMs,
      snapshot.bytes,
      snapshot.rawHtml,
      snapshot.markdown,
      JSON.stringify(snapshot.metadata),
      JSON.stringify(snapshot.rules),
      snapshot.parserVersion,
      snapshot.errorCode,
      JSON.stringify(snapshot.responseHeaders),
    );
  // Keep metadata and hashes, retain raw bodies for at most five versions per URL / 30 days.
  sqlite
    .prepare(
      `UPDATE page_snapshots SET raw_html=NULL,markdown=NULL WHERE project_id=? AND
    (captured_at < datetime('now','-30 days') OR (campaign_id=? AND url=? AND id NOT IN
      (SELECT id FROM page_snapshots WHERE campaign_id=? AND url=? ORDER BY id DESC LIMIT 5)))`,
    )
    .run(
      snapshot.projectId,
      snapshot.campaignId,
      snapshot.url,
      snapshot.campaignId,
      snapshot.url,
    );
  const saved = getSnapshot(Number(inserted.lastInsertRowid), snapshot.projectId);
  const analysis = runSeoAnalysis(saved);
  sqlite.prepare("UPDATE page_snapshots SET analysis=? WHERE id=? AND project_id=?")
    .run(JSON.stringify(analysis), saved.id, saved.projectId);
  return { ...saved, analysis };
}

const snapshotSelect = `SELECT id,project_id AS projectId,campaign_id AS campaignId,url,final_url AS finalUrl,
  status_code AS statusCode,content_type AS contentType,fetch_state AS fetchState,data_state AS dataState,
  render_mode AS renderMode,captured_at AS capturedAt,content_hash AS contentHash,revision_hash AS revisionHash,
  response_ms AS responseMs,bytes,metadata,rules,parser_version AS parserVersion,error_code AS errorCode,response_headers AS responseHeaders,analysis FROM page_snapshots`;
type SnapshotRow = Omit<PageSnapshot, "metadata" | "rules" | "responseHeaders" | "analysis"> & {
  metadata: string;
  rules: string;
  responseHeaders: string;
  analysis: string | null;
};
function decodeSnapshot(row: SnapshotRow): PageSnapshot {
  return {
    ...row,
    metadata: JSON.parse(row.metadata),
    rules: JSON.parse(row.rules),
    responseHeaders: JSON.parse(row.responseHeaders),
    analysis: row.analysis ? JSON.parse(row.analysis) : null,
  };
}
export function getSnapshot(id: number, projectId: number) {
  const row = getDatabase()
    .sqlite.prepare(`${snapshotSelect} WHERE id=? AND project_id=?`)
    .get(id, projectId) as SnapshotRow | undefined;
  if (!row)
    throw new AppError(
      "활성 프로젝트의 페이지 근거를 찾을 수 없습니다.",
      404,
      "SNAPSHOT_NOT_FOUND",
    );
  return decodeSnapshot(row);
}
export function latestSnapshots(campaignId: number, projectId: number) {
  return (
    getDatabase()
      .sqlite.prepare(
        `${snapshotSelect} WHERE project_id=? AND campaign_id=? AND id IN
    (SELECT MAX(id) FROM page_snapshots WHERE project_id=? AND campaign_id=? GROUP BY url) ORDER BY url LIMIT 50`,
      )
      .all(projectId, campaignId, projectId, campaignId) as SnapshotRow[]
  ).map(decodeSnapshot);
}
