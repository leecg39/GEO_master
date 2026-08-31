import { z } from "zod";
import { AppError } from "./errors";
import { fetchPublicText, normalizePublicUrl } from "./url-security";

const linkSchema = z.object({
  title: z.string().trim().min(1).max(200),
  url: z.string().url().max(2048).refine((value) => ["http:", "https:"].includes(new URL(value).protocol), "http/https URL만 허용됩니다."),
  description: z.string().trim().max(500).optional().default(""),
});

export const llmsDocumentSchema = z.object({
  brandName: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(20).max(500),
  website: z.string().url().max(2048).refine((value) => ["http:", "https:"].includes(new URL(value).protocol), "http/https URL만 허용됩니다."),
  details: z.string().trim().max(2000).optional().default(""),
  sections: z.array(z.object({
    heading: z.string().trim().min(1).max(120),
    links: z.array(linkSchema).min(1).max(100),
  })).min(1).max(20),
});

export interface LlmsValidationIssue {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  line?: number;
}

function singleLine(value: string) {
  return value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

function escapeLabel(value: string) {
  return singleLine(value).replaceAll("[", "\\[").replaceAll("]", "\\]");
}

function safeDetails(value: string) {
  const prose = singleLine(value);
  for (const match of prose.matchAll(/https?:\/\/[^\s<>()]+/gi)) {
    try {
      const url = new URL(match[0].replace(/[.,;:!?]+$/, ""));
      if (url.username || url.password) throw new AppError("자격증명이 포함된 안내 URL은 사용할 수 없습니다.", 422, "URL_CREDENTIALS_BLOCKED");
    } catch (error) {
      if (error instanceof AppError) throw error;
    }
  }
  return prose.replace(/^([#>\-])/, "\\$1");
}

export function generateLlmsTxt(input: unknown) {
  const parsed = llmsDocumentSchema.parse(input);
  const lines = [`# ${singleLine(parsed.brandName)}`, "", `> ${singleLine(parsed.summary)}`];
  if (parsed.details) lines.push("", safeDetails(parsed.details));
  for (const section of parsed.sections) {
    lines.push("", `## ${singleLine(section.heading)}`, "");
    for (const link of section.links) {
      const url = new URL(link.url);
      if (url.username || url.password) throw new AppError("자격증명이 포함된 문서 URL은 사용할 수 없습니다.", 422, "URL_CREDENTIALS_BLOCKED");
      lines.push(`- [${escapeLabel(link.title)}](${url.toString()})${link.description ? `: ${singleLine(link.description)}` : ""}`);
    }
  }
  const document = `${lines.join("\n").trim()}\n`;
  return { document, validation: validateLlmsTxt(document, parsed.website) };
}

export function validateLlmsTxt(document: string, website?: string) {
  const issues: LlmsValidationIssue[] = [];
  const bytes = Buffer.byteLength(document, "utf8");
  if (!document.trim()) issues.push({ severity: "error", code: "EMPTY", message: "llms.txt 내용이 비어 있습니다." });
  if (bytes > 100 * 1024) issues.push({ severity: "error", code: "TOO_LARGE", message: "llms.txt는 100KB 이하로 유지하세요." });
  if (/<\/?(?:script|iframe|object|embed|img|form|style|link|meta)\b[^>]*>/i.test(document)) issues.push({ severity: "warning", code: "HTML_FOUND", message: "HTML 대신 읽기 쉬운 Markdown만 사용하세요." });

  const lines = document.replaceAll("\r\n", "\n").split("\n");
  const h1Lines = lines.map((line, index) => ({ line, index })).filter(({ line }) => /^#\s+\S/.test(line));
  if (h1Lines.length !== 1) issues.push({ severity: "error", code: "H1_COUNT", message: "사이트 이름을 담은 H1은 정확히 하나여야 합니다." });
  const firstContent = lines.findIndex((line) => line.trim());
  if (firstContent >= 0 && !/^#\s+\S/.test(lines[firstContent])) issues.push({ severity: "error", code: "H1_FIRST", message: "첫 번째 콘텐츠 줄은 사이트 이름 H1이어야 합니다.", line: firstContent + 1 });

  const summaryIndex = lines.findIndex((line) => /^>\s+\S/.test(line));
  if (summaryIndex < 0) issues.push({ severity: "error", code: "SUMMARY_MISSING", message: "H1 다음에 사이트 요약을 blockquote(>)로 추가하세요." });
  else if (singleLine(lines[summaryIndex].replace(/^>+\s*/, "")).length < 20) issues.push({ severity: "warning", code: "SUMMARY_SHORT", message: "사이트 요약을 20자 이상 구체적으로 작성하세요.", line: summaryIndex + 1 });

  const h2Count = lines.filter((line) => /^##\s+\S/.test(line)).length;
  if (!h2Count) issues.push({ severity: "warning", code: "SECTION_MISSING", message: "핵심 문서를 H2 섹션으로 분류하세요." });

  const linkPattern = /^-\s+\[((?:\\.|[^\]])+)]\(([^)\s]+)\)(?::\s*(.*))?$/;
  const links: { title: string; url: string; description: string; line: number }[] = [];
  lines.forEach((line, index) => {
    if (!line.trim().startsWith("-")) return;
    const match = line.match(linkPattern);
    if (!match) {
      issues.push({ severity: "error", code: "LINK_FORMAT", message: "문서 링크는 '- [제목](https://...): 설명' 형식을 사용하세요.", line: index + 1 });
      return;
    }
    const [, title, rawUrl, description = ""] = match;
    try {
      const url = new URL(rawUrl);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("unsafe URL");
      links.push({ title, url: url.toString(), description, line: index + 1 });
    } catch {
      issues.push({ severity: "error", code: "LINK_URL", message: "링크는 자격증명이 없는 절대 http/https URL이어야 합니다.", line: index + 1 });
    }
  });
  if (!links.length) issues.push({ severity: "warning", code: "LINKS_MISSING", message: "AI가 읽을 대표 문서 링크를 하나 이상 추가하세요." });

  const seen = new Map<string, number>();
  for (const link of links) {
    if (seen.has(link.url)) issues.push({ severity: "warning", code: "DUPLICATE_LINK", message: `중복 URL을 제거하세요: ${link.url}`, line: link.line });
    else seen.set(link.url, link.line);
    if (!link.description.trim()) issues.push({ severity: "info", code: "LINK_DESCRIPTION", message: `링크 설명을 추가하면 선택 기준이 선명해집니다: ${link.title}`, line: link.line });
  }

  if (website) {
    try {
      const parsedWebsite = new URL(website);
      if (!["http:", "https:"].includes(parsedWebsite.protocol)) throw new Error("unsupported protocol");
      const expectedOrigin = parsedWebsite.origin;
      const external = links.filter((link) => new URL(link.url).origin !== expectedOrigin).length;
      if (external) issues.push({ severity: "info", code: "EXTERNAL_LINKS", message: `외부 도메인 링크 ${external}개가 포함되어 있습니다. 의도한 권위 출처인지 확인하세요.` });
    } catch {
      issues.push({ severity: "error", code: "WEBSITE_URL", message: "기준 웹사이트 URL이 올바르지 않습니다." });
    }
  }

  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.filter((issue) => issue.severity === "warning").length;
  return {
    valid: errors === 0,
    score: Math.max(0, 100 - errors * 20 - warnings * 5),
    issues,
    stats: { bytes, lines: lines.length, sections: h2Count, links: links.length, errors, warnings },
  };
}

export async function verifyRemoteLlmsTxt(website: string) {
  const site = normalizePublicUrl(website);
  const target = new URL("/llms.txt", site).toString();
  const fetched = await fetchPublicText(target, 10_000);
  if (fetched.status < 200 || fetched.status >= 300) {
    throw new AppError(`배포된 llms.txt를 찾지 못했습니다. HTTP ${fetched.status}`, 422, "LLMS_NOT_FOUND");
  }
  const validation = validateLlmsTxt(fetched.text, site.toString());
  if (fetched.contentType && !/(?:text\/plain|text\/markdown|text\/x-markdown)/i.test(fetched.contentType)) {
    validation.issues.push({ severity: "warning", code: "CONTENT_TYPE", message: `text/plain 또는 Markdown MIME 유형을 권장합니다. 현재: ${fetched.contentType}` });
    validation.stats.warnings += 1;
    validation.score = Math.max(0, validation.score - 5);
  }
  return {
    url: fetched.url,
    status: fetched.status,
    contentType: fetched.contentType,
    document: fetched.text,
    validation,
  };
}
