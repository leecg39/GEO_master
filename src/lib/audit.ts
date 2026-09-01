import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import { z } from "zod";
import {
  assertDeleteAllowed,
  assertExpectedUpdatedAt,
  collectionQuerySchema,
  cursorPage,
  decodeCursor,
  expectFound,
  idempotencyKeySchema,
  resourceIdSchema,
  transactionalMutation,
} from "./crud";
import { getDatabase } from "./db";
import { AppError } from "./errors";
import { requireActiveProject } from "./projects";
import { fetchPublicText } from "./url-security";

export const AUDIT_CATEGORIES = ["기반 SEO", "GEO 콘텐츠 구조", "신뢰도·E-E-A-T", "기술적 GEO", "브랜드 노출"] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

export interface AuditItemResult {
  code: string;
  category: AuditCategory;
  label: string;
  passed: boolean;
  manual: boolean;
  detail: string;
  recommendation: string;
}

export const auditCreateSchema = z.object({
  url: z.string().trim().url().max(2048),
  title: z.string().trim().max(120).optional().default(""),
  notes: z.string().trim().max(5_000).optional().default(""),
  manualOverrides: z.record(z.string().min(1).max(120), z.boolean()).refine((value) => Object.keys(value).length <= 32, {
    message: "수동 확인 항목은 32개를 초과할 수 없습니다.",
  }).optional().default({}),
  clientRequestId: idempotencyKeySchema.optional(),
}).strict();

export const auditUpdateSchema = z.object({
  title: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(5_000).optional(),
  expectedUpdatedAt: z.string().min(1).max(64),
}).strict().refine((value) => value.title !== undefined || value.notes !== undefined, {
  message: "수정할 진단 메타데이터를 하나 이상 입력해 주세요.",
});

export const auditDeleteSchema = z.object({
  expectedUpdatedAt: z.string().min(1).max(64),
  cascadeConfirmed: z.boolean().default(false),
}).strict();

interface AuditRow {
  id: number;
  project_id: number | null;
  title: string;
  notes: string;
  client_request_id: string | null;
  url: string;
  score: number;
  grade: string;
  items: string;
  metadata: string;
  created_at: string;
  updated_at: string;
}

export interface AuditResource {
  id: number;
  projectId: number;
  title: string;
  notes: string;
  clientRequestId: string | null;
  url: string;
  score: number;
  total: number;
  grade: string;
  items: AuditItemResult[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface Snapshot {
  title: string;
  description: string;
  h1Count: number;
  headings: string[];
  hasHeadingHierarchy: boolean;
  canonical: string;
  ogCount: number;
  internalLinks: number;
  images: number;
  imagesWithAlt: number;
  noindex: boolean;
  questionHeadings: number;
  lists: number;
  tables: number;
  faqSignals: number;
  firstParagraph: string;
  jsonLdTypes: string[];
  hasAuthor: boolean;
  externalCitations: number;
  numericEvidence: number;
  publishedDate: boolean;
  modifiedDate: boolean;
  hasContact: boolean;
  entityIdentifiers: number;
}

interface SupportingFiles {
  robots: string | null;
  llms: string | null;
  sitemap: string | null;
}

interface Rule {
  code: string;
  category: AuditCategory;
  label: string;
  recommendation: string;
  manual?: boolean;
  check?: (snapshot: Snapshot, files: SupportingFiles) => { passed: boolean; detail: string };
}

const result = (passed: boolean, detail: string) => ({ passed, detail });
const schemaIncludes = (snapshot: Snapshot, names: string[]) => names.some((name) => snapshot.jsonLdTypes.includes(name));

export const AUDIT_RULES: Rule[] = [
  { code: "seo-title-meta", category: "기반 SEO", label: "title과 meta description", recommendation: "고유한 제목과 120~160자 설명을 작성하세요.", check: (s) => result(Boolean(s.title && s.description), s.title && s.description ? "제목과 설명이 있습니다." : "제목 또는 설명이 없습니다.") },
  { code: "seo-headings", category: "기반 SEO", label: "H1~H3 계층 구조", recommendation: "H1은 하나만 사용하고 H2·H3를 순서대로 구성하세요.", check: (s) => result(s.h1Count === 1 && s.hasHeadingHierarchy, `H1 ${s.h1Count}개, 계층 ${s.hasHeadingHierarchy ? "양호" : "점검 필요"}`) },
  { code: "seo-canonical", category: "기반 SEO", label: "Canonical URL", recommendation: "대표 URL을 가리키는 canonical 링크를 추가하세요.", check: (s) => result(Boolean(s.canonical), s.canonical || "canonical 없음") },
  { code: "seo-og", category: "기반 SEO", label: "Open Graph 태그", recommendation: "og:title, og:description, og:image를 구성하세요.", check: (s) => result(s.ogCount >= 3, `핵심 OG 태그 ${s.ogCount}/3`) },
  { code: "seo-internal-links", category: "기반 SEO", label: "내부 링크", recommendation: "관련 콘텐츠로 이어지는 설명형 내부 링크를 추가하세요.", check: (s) => result(s.internalLinks >= 2, `내부 링크 ${s.internalLinks}개`) },
  { code: "seo-image-alt", category: "기반 SEO", label: "이미지 대체 텍스트", recommendation: "모든 정보성 이미지 alt에 의미와 수치를 담으세요.", check: (s) => result(s.images === 0 || s.imagesWithAlt === s.images, `alt ${s.imagesWithAlt}/${s.images}`) },
  { code: "seo-indexable", category: "기반 SEO", label: "검색 색인 허용", recommendation: "공개 콘텐츠의 noindex 설정을 제거하세요.", check: (s) => result(!s.noindex, s.noindex ? "noindex 감지" : "색인 가능") },

  { code: "geo-question-headings", category: "GEO 콘텐츠 구조", label: "질문형 소제목", recommendation: "고객의 실제 질문을 H2/H3 제목으로 사용하세요.", check: (s) => result(s.questionHeadings >= 1, `질문형 제목 ${s.questionHeadings}개`) },
  { code: "geo-lists", category: "GEO 콘텐츠 구조", label: "목록 구조", recommendation: "핵심 절차와 조건을 순서·불릿 목록으로 구조화하세요.", check: (s) => result(s.lists >= 1, `목록 ${s.lists}개`) },
  { code: "geo-tables", category: "GEO 콘텐츠 구조", label: "비교 표", recommendation: "비교·평가 정보를 표로 제공하세요.", check: (s) => result(s.tables >= 1, `표 ${s.tables}개`) },
  { code: "geo-faq", category: "GEO 콘텐츠 구조", label: "FAQ 섹션", recommendation: "실제 고객 언어의 FAQ를 3개 이상 추가하세요.", check: (s) => result(s.faqSignals >= 3, `FAQ 신호 ${s.faqSignals}개`) },
  { code: "geo-answer-first", category: "GEO 콘텐츠 구조", label: "결론 선행 도입부", recommendation: "문제→핵심 답변→글의 가치 순서로 도입부를 다시 쓰세요.", check: (s) => result(s.firstParagraph.length >= 40 && s.firstParagraph.length <= 400, `첫 문단 ${s.firstParagraph.length}자`) },
  { code: "geo-search-intent", category: "GEO 콘텐츠 구조", label: "검색 의도 명시", recommendation: "정보·비교·구매·문제 해결 중 목표 의도를 문서에 명확히 반영하세요.", manual: true },
  { code: "geo-journey", category: "GEO 콘텐츠 구조", label: "구매 여정별 구성", recommendation: "탐색→비교→구매 결정에 필요한 내용을 순서대로 배치하세요.", manual: true },

  { code: "trust-author", category: "신뢰도·E-E-A-T", label: "작성자·검수자", recommendation: "작성자 이름, 전문성, 검수 정보를 표시하세요.", check: (s) => result(s.hasAuthor, s.hasAuthor ? "작성자 신호 있음" : "작성자 신호 없음") },
  { code: "trust-citations", category: "신뢰도·E-E-A-T", label: "출처와 외부 인용", recommendation: "주요 주장마다 원문 출처 링크와 기준일을 표시하세요.", check: (s) => result(s.externalCitations >= 1, `외부 출처 링크 ${s.externalCitations}개`) },
  { code: "trust-numbers", category: "신뢰도·E-E-A-T", label: "수치·조건 근거", recommendation: "형용사를 표본·기간·조건이 있는 수치로 바꾸세요.", check: (s) => result(s.numericEvidence >= 2, `수치 표현 ${s.numericEvidence}개`) },
  { code: "trust-published", category: "신뢰도·E-E-A-T", label: "발행일", recommendation: "독자가 확인할 수 있는 발행일을 표시하세요.", check: (s) => result(s.publishedDate, s.publishedDate ? "발행일 감지" : "발행일 없음") },
  { code: "trust-updated", category: "신뢰도·E-E-A-T", label: "수정일·최신성", recommendation: "최종 수정일을 표시하고 6~12개월마다 검토하세요.", check: (s) => result(s.modifiedDate, s.modifiedDate ? "수정일 감지" : "수정일 없음") },
  { code: "trust-transparency", category: "신뢰도·E-E-A-T", label: "회사·연락처 투명성", recommendation: "회사 소개, 연락처, 편집 정책을 쉽게 찾게 하세요.", check: (s) => result(s.hasContact, s.hasContact ? "소개/연락처 신호 있음" : "소개/연락처 신호 없음") },

  { code: "tech-jsonld", category: "기술적 GEO", label: "JSON-LD", recommendation: "페이지 성격에 맞는 JSON-LD를 추가하세요.", check: (s) => result(s.jsonLdTypes.length > 0, `스키마: ${s.jsonLdTypes.join(", ") || "없음"}`) },
  { code: "tech-faq-schema", category: "기술적 GEO", label: "FAQPage 스키마", recommendation: "FAQ 내용과 일치하는 FAQPage JSON-LD를 추가하세요.", check: (s) => result(schemaIncludes(s, ["FAQPage"]), schemaIncludes(s, ["FAQPage"]) ? "FAQPage 있음" : "FAQPage 없음") },
  { code: "tech-entity-schema", category: "기술적 GEO", label: "Organization/Article 스키마", recommendation: "Organization과 Article 엔티티를 명시하세요.", check: (s) => result(schemaIncludes(s, ["Organization", "Article", "NewsArticle"]), `엔티티 스키마 ${s.jsonLdTypes.join(", ") || "없음"}`) },
  { code: "tech-ai-robots", category: "기술적 GEO", label: "AI 크롤러 접근", recommendation: "GPTBot·ClaudeBot·PerplexityBot·Google-Extended 차단 여부를 검토하세요.", check: (_s, f) => {
    const blocked = blockedAiBots(f.robots ?? "");
    return result(blocked.length === 0, blocked.length ? `차단: ${blocked.join(", ")}` : "주요 AI 크롤러 접근 가능");
  } },
  { code: "tech-llms", category: "기술적 GEO", label: "llms.txt", recommendation: "핵심 엔티티와 대표 문서를 설명하는 /llms.txt를 제공하세요.", check: (_s, f) => result(Boolean(f.llms?.trim()), f.llms ? "llms.txt 확인" : "llms.txt 없음") },
  { code: "tech-sitemap", category: "기술적 GEO", label: "XML Sitemap", recommendation: "최신 URL과 수정일을 담은 sitemap.xml을 제공하세요.", check: (_s, f) => result(Boolean(f.sitemap?.includes("<url")), f.sitemap ? "sitemap 응답 확인" : "sitemap 없음") },

  { code: "brand-definition", category: "브랜드 노출", label: "일관된 브랜드 정의", recommendation: "모든 채널에서 한 문장 엔티티 정의를 통일하세요.", manual: true },
  { code: "brand-entity-ids", category: "브랜드 노출", label: "엔티티 식별자", recommendation: "sameAs, 공식 URL, 로고 등 식별자를 연결하세요.", check: (s) => result(s.entityIdentifiers >= 2, `엔티티 식별 신호 ${s.entityIdentifiers}개`) },
  { code: "brand-authority", category: "브랜드 노출", label: "권위 엔티티 연결", recommendation: "표준·인증·전문기관과의 검증 가능한 관계를 설명하세요.", manual: true },
  { code: "brand-multilingual", category: "브랜드 노출", label: "다국어 맥락", recommendation: "영문 브랜드 정의와 핵심 자료를 공개하세요.", manual: true },
  { code: "brand-triggers", category: "브랜드 노출", label: "추천 조건·트리거", recommendation: "1위·표준 같은 표현은 근거와 조건을 함께 명시하세요.", manual: true },
  { code: "brand-source-diversity", category: "브랜드 노출", label: "소스 4중창", recommendation: "공식·언론·학술·커뮤니티 출처를 균형 있게 확보하세요.", manual: true },
];

function extractJsonLdTypes($: cheerio.CheerioAPI) {
  const types = new Set<string>();
  const collect = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) return value.forEach(collect);
    const object = value as Record<string, unknown>;
    const type = object["@type"];
    if (typeof type === "string") types.add(type);
    if (Array.isArray(type)) type.filter((entry): entry is string => typeof entry === "string").forEach((entry) => types.add(entry));
    Object.values(object).forEach(collect);
  };
  $("script[type='application/ld+json']").each((_, node) => {
    try { collect(JSON.parse($(node).text())); } catch { /* 잘못된 JSON-LD는 점수에 반영하지 않는다. */ }
  });
  return [...types];
}

export function parseAuditHtml(html: string, pageUrl: string): Snapshot {
  const $ = cheerio.load(html);
  const origin = new URL(pageUrl).origin;
  const headings = $("h1,h2,h3").map((_, node) => $(node).text().trim()).get();
  const headingLevels = $("h1,h2,h3").map((_, node) => Number(node.tagName.slice(1))).get();
  const hasHeadingHierarchy = headingLevels.every((level, index) => index === 0 || level <= headingLevels[index - 1] + 1);
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const internalLinks = $("a[href]").filter((_, node) => {
    try { return new URL($(node).attr("href")!, pageUrl).origin === origin; } catch { return false; }
  }).length;
  const datePublished = $("meta[property='article:published_time'],meta[name='date'],time[datetime]").length > 0;
  const dateModified = $("meta[property='article:modified_time'],meta[name='last-modified'],[itemprop='dateModified']").length > 0;
  const jsonLdTypes = extractJsonLdTypes($);
  return {
    title: $("title").first().text().trim(),
    description: $("meta[name='description']").attr("content")?.trim() ?? "",
    h1Count: $("h1").length,
    headings,
    hasHeadingHierarchy,
    canonical: $("link[rel='canonical']").attr("href") ?? "",
    ogCount: ["og:title", "og:description", "og:image"].filter((name) => $(`meta[property='${name}']`).attr("content")).length,
    internalLinks,
    images: $("img").length,
    imagesWithAlt: $("img[alt]").filter((_, node) => Boolean($(node).attr("alt")?.trim())).length,
    noindex: /noindex/i.test($("meta[name='robots']").attr("content") ?? ""),
    questionHeadings: headings.filter((heading) => /[?？]$|^(어떻게|왜|무엇|누가|언제|어디|어떤|얼마|할 수)/.test(heading)).length,
    lists: $("ul,ol").length,
    tables: $("table").length,
    faqSignals: $("[itemtype*='FAQPage'] [itemprop='name'], details summary, .faq h2, .faq h3, [class*='faq'] [class*='question']").length,
    firstParagraph: $("main p, article p, body p").first().text().replace(/\s+/g, " ").trim(),
    jsonLdTypes,
    hasAuthor: $("[rel='author'],[itemprop='author'],meta[name='author'],.author").length > 0,
    externalCitations: $("a[href^='http']").filter((_, node) => {
      try { return new URL($(node).attr("href")!).origin !== origin; } catch { return false; }
    }).length,
    numericEvidence: bodyText.match(/\d+(?:[.,]\d+)?\s*(?:%|명|개|건|원|개월|년|배|회|곳|사)(?![가-힣A-Za-z0-9])/g)?.length ?? 0,
    publishedDate: datePublished,
    modifiedDate: dateModified,
    hasContact: $("a[href^='mailto:'],a[href^='tel:'],a[href*='contact'],a[href*='about']").length > 0,
    entityIdentifiers: $("script[type='application/ld+json']").text().match(/"(?:sameAs|url|logo)"\s*:/g)?.length ?? 0,
  };
}

export function blockedAiBots(robotsText: string) {
  if (!robotsText.trim()) return [];
  const bots = ["GPTBot", "ClaudeBot", "PerplexityBot", "Google-Extended"];
  const lines = robotsText.split(/\r?\n/).map((line) => line.replace(/#.*$/, "").trim());
  const groups: { agents: string[]; disallow: string[] }[] = [];
  let group = { agents: [] as string[], disallow: [] as string[] };
  for (const line of lines) {
    const [rawKey, ...rest] = line.split(":");
    const key = rawKey?.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "user-agent") {
      if (group.disallow.length) { groups.push(group); group = { agents: [], disallow: [] }; }
      group.agents.push(value.toLowerCase());
    } else if (key === "disallow" && group.agents.length) {
      group.disallow.push(value);
    }
  }
  if (group.agents.length) groups.push(group);
  return bots.filter((bot) => groups.some((entry) =>
    (entry.agents.includes("*") || entry.agents.includes(bot.toLowerCase())) && entry.disallow.includes("/"),
  ));
}

export function auditGrade(score: number) {
  return score >= 25 ? "우수" : score < 20 ? "개선 필요" : "보통";
}

export function scoreAudit(snapshot: Snapshot, files: SupportingFiles, manualOverrides: Record<string, boolean> = {}) {
  const items: AuditItemResult[] = AUDIT_RULES.map((rule) => {
    const manual = Boolean(rule.manual);
    const checked = manual
      ? result(manualOverrides[rule.code] === true, rule.code in manualOverrides ? (manualOverrides[rule.code] ? "수동 확인 완료" : "수동 미충족") : "수동 확인 필요")
      : rule.check!(snapshot, files);
    return { ...rule, manual, ...checked };
  });
  const score = items.filter((item) => item.passed).length;
  const grade = auditGrade(score);
  return { score, total: items.length, grade, items };
}

async function optionalFile(url: string) {
  try {
    const fetched = await fetchPublicText(url, 7_000);
    return fetched.status >= 200 && fetched.status < 300 ? fetched.text : null;
  } catch {
    return null;
  }
}

function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function findAuditRow(id: number) {
  return getDatabase().sqlite.prepare("SELECT * FROM audits WHERE id = ?").get(id) as AuditRow | undefined;
}

function publicAudit(row: AuditRow): AuditResource {
  const metadata = parseJson<Record<string, unknown>>(row.metadata, {});
  delete metadata._requestHash;
  const items = parseJson<AuditItemResult[]>(row.items, []);
  return {
    id: row.id,
    projectId: row.project_id!,
    title: row.title,
    notes: row.notes,
    clientRequestId: row.client_request_id,
    url: row.url,
    score: row.score,
    total: items.length,
    grade: row.grade,
    items,
    metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function ownedAuditRow(id: number) {
  const row = expectFound(findAuditRow(id), "진단 이력을 찾을 수 없습니다.", "AUDIT_NOT_FOUND");
  const active = requireActiveProject();
  if (row.project_id !== active.id) {
    throw new AppError("활성 프로젝트의 진단 이력이 아닙니다.", 409, "PROJECT_SCOPE_MISMATCH");
  }
  return row;
}

function requestHash(input: z.infer<typeof auditCreateSchema>) {
  const manualOverrides = Object.fromEntries(Object.entries(input.manualOverrides).sort(([left], [right]) => left.localeCompare(right)));
  return createHash("sha256").update(JSON.stringify({
    url: input.url,
    title: input.title,
    notes: input.notes,
    manualOverrides,
  })).digest("hex");
}

function idempotentAudit(clientRequestId: string, projectId: number, expectedHash: string) {
  const row = getDatabase().sqlite.prepare("SELECT * FROM audits WHERE client_request_id = ?").get(clientRequestId) as AuditRow | undefined;
  if (!row) return null;
  const storedHash = parseJson<Record<string, unknown>>(row.metadata, {})._requestHash;
  if (row.project_id !== projectId || storedHash !== expectedHash) {
    throw new AppError("동일한 요청 ID가 다른 진단 입력에 이미 사용되었습니다.", 409, "IDEMPOTENCY_KEY_REUSED");
  }
  return publicAudit(row);
}

export async function createAudit(input: unknown) {
  const parsed = auditCreateSchema.parse(input);
  const active = requireActiveProject();
  const allowedOverrides = new Set(AUDIT_RULES.filter((rule) => rule.manual).map((rule) => rule.code));
  const unknownOverrides = Object.keys(parsed.manualOverrides).filter((code) => !allowedOverrides.has(code));
  if (unknownOverrides.length) {
    throw new AppError("알 수 없는 수동 진단 항목이 포함되어 있습니다.", 422, "UNKNOWN_AUDIT_OVERRIDE", { codes: unknownOverrides });
  }
  const fingerprint = requestHash(parsed);
  if (parsed.clientRequestId) {
    const existing = idempotentAudit(parsed.clientRequestId, active.id, fingerprint);
    if (existing) return existing;
  }

  const page = await fetchPublicText(parsed.url);
  if (page.status < 200 || page.status >= 400 || !/html|xhtml/i.test(page.contentType)) {
    throw new AppError("대상 URL에서 HTML 문서를 찾지 못했습니다.", 422, "NOT_HTML");
  }
  const finalUrl = new URL(page.url);
  const [robots, llms, sitemap] = await Promise.all([
    optionalFile(new URL("/robots.txt", finalUrl).toString()),
    optionalFile(new URL("/llms.txt", finalUrl).toString()),
    optionalFile(new URL("/sitemap.xml", finalUrl).toString()),
  ]);
  const snapshot = parseAuditHtml(page.text, page.url);
  const scored = scoreAudit(snapshot, { robots, llms, sitemap }, parsed.manualOverrides);
  if (scored.total !== 32) throw new Error(`Audit rule invariant failed: ${scored.total}`);
  const now = new Date().toISOString();
  const title = parsed.title || snapshot.title || finalUrl.hostname;
  const metadata = {
    finalUrl: page.url,
    title: snapshot.title,
    schemas: snapshot.jsonLdTypes,
    recommendations: scored.items.filter((item) => !item.passed).slice(0, 8).map((item) => item.recommendation),
    _requestHash: fingerprint,
  };
  const { sqlite } = getDatabase();
  return transactionalMutation(sqlite, () => {
    if (parsed.clientRequestId) {
      const existing = idempotentAudit(parsed.clientRequestId, active.id, fingerprint);
      if (existing) return existing;
    }
    const inserted = sqlite.prepare(`
      INSERT INTO audits (project_id, title, notes, client_request_id, url, score, grade, items, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      active.id,
      title,
      parsed.notes,
      parsed.clientRequestId ?? null,
      parsed.url,
      scored.score,
      scored.grade,
      JSON.stringify(scored.items),
      JSON.stringify(metadata),
      now,
      now,
    );
    const auditId = Number(inserted.lastInsertRowid);
    const insertItem = sqlite.prepare(`
      INSERT INTO audit_items (audit_id, code, category, passed, manual, detail) VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const item of scored.items) {
      insertItem.run(auditId, item.code, item.category, item.passed ? 1 : 0, item.manual ? 1 : 0, item.detail);
    }
    return publicAudit(expectFound(findAuditRow(auditId), "진단 이력을 저장하지 못했습니다.", "AUDIT_CREATE_FAILED"));
  });
}

/** Backward-compatible engine entry point used by existing callers. */
export function runAudit(target: string, manualOverrides: Record<string, boolean> = {}) {
  return createAudit({ url: target, manualOverrides });
}

export function listAudits(input: unknown) {
  const query = collectionQuerySchema.parse(input);
  const active = requireActiveProject();
  const where = ["project_id = ?"];
  const parameters: Array<string | number> = [active.id];
  if (query.q) {
    const escaped = query.q.replace(/[\\%_]/g, "\\$&");
    const pattern = `%${escaped}%`;
    where.push("(title LIKE ? ESCAPE '\\' OR notes LIKE ? ESCAPE '\\' OR url LIKE ? ESCAPE '\\')");
    parameters.push(pattern, pattern, pattern);
  }
  if (query.cursor) {
    const cursor = decodeCursor(query.cursor);
    where.push("(created_at < ? OR (created_at = ? AND id < ?))");
    parameters.push(cursor.timestamp, cursor.timestamp, cursor.id);
  }
  const rows = getDatabase().sqlite.prepare(`
    SELECT * FROM audits WHERE ${where.join(" AND ")}
    ORDER BY created_at DESC, id DESC LIMIT ?
  `).all(...parameters, query.limit + 1) as AuditRow[];
  return cursorPage(rows.map(publicAudit), query.limit, (audit) => ({ timestamp: audit.createdAt, id: audit.id }));
}

export function getAuditResource(idInput: unknown) {
  const id = resourceIdSchema.parse(idInput);
  return publicAudit(ownedAuditRow(id));
}

export function updateAudit(idInput: unknown, input: unknown) {
  const id = resourceIdSchema.parse(idInput);
  const parsed = auditUpdateSchema.parse(input);
  const { sqlite } = getDatabase();
  return transactionalMutation(sqlite, () => {
    const row = ownedAuditRow(id);
    assertExpectedUpdatedAt(row.updated_at, parsed.expectedUpdatedAt);
    const previous = Date.parse(row.updated_at);
    const updatedAt = new Date(Number.isFinite(previous) && previous >= Date.now() ? previous + 1 : Date.now()).toISOString();
    sqlite.prepare("UPDATE audits SET title = ?, notes = ?, updated_at = ? WHERE id = ?")
      .run(parsed.title ?? row.title, parsed.notes ?? row.notes, updatedAt, id);
    return publicAudit(expectFound(findAuditRow(id), "진단 이력을 찾을 수 없습니다.", "AUDIT_NOT_FOUND"));
  });
}

export function deleteAudit(idInput: unknown, input: unknown) {
  const id = resourceIdSchema.parse(idInput);
  const parsed = auditDeleteSchema.parse(input);
  const { sqlite } = getDatabase();
  return transactionalMutation(sqlite, () => {
    const row = ownedAuditRow(id);
    assertExpectedUpdatedAt(row.updated_at, parsed.expectedUpdatedAt);
    const reportPresets = (sqlite.prepare("SELECT COUNT(*) AS count FROM report_presets WHERE audit_id = ?").get(id) as { count: number }).count;
    assertDeleteAllowed({ reportPresets }, parsed.cascadeConfirmed, "AUDIT_HAS_DEPENDENCIES");
    sqlite.prepare("DELETE FROM audits WHERE id = ?").run(id);
  });
}

export function getAuditHistory(limit = 20) {
  return listAudits({ limit }).items;
}

export function getAudit(id: number) {
  const row = findAuditRow(id);
  if (!row) return null;
  return publicAudit(ownedAuditRow(id));
}
