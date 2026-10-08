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

/**
 * Qshop 계획 P04 — llms.txt v2 기준 (https://llmstxt.org/).
 * - spec: 규격 위반. 필수는 H1 하나뿐이고, 요약 blockquote·세부 설명·H2 파일 목록은 선택이다
 * - quality: 이 앱의 품질 권고 (요약 권장, 링크 설명, 용량 등). 규격 적합 여부(valid)에 영향을 주지 않는다
 * - 파일은 사이트 루트뿐 아니라 하위 경로(/docs/llms.txt)에도 둘 수 있고 그 경로 아래를 다룬다
 */
export interface LlmsValidationIssue {
  severity: "error" | "warning" | "info";
  category: "spec" | "quality";
  code: string;
  message: string;
  line?: number;
}

export const DEFAULT_LLMS_PATH = "/llms.txt";

/** 같은 사이트 안의 llms.txt 경로만 허용한다 (예: /llms.txt, /docs/llms.txt) */
export function normalizeLlmsPath(input: string | undefined | null) {
  const value = (input ?? "").trim() || DEFAULT_LLMS_PATH;
  if (!value.startsWith("/") || value.startsWith("//") || /[?#\\]/.test(value) || !/(^|\/)llms\.txt$/.test(value) || value.split("/").includes("..")) {
    throw new AppError("llms.txt 경로는 /llms.txt 또는 /docs/llms.txt처럼 사이트 안의 경로여야 합니다.", 422, "INVALID_LLMS_PATH");
  }
  return value.replace(/\/{2,}/g, "/");
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

export function validateLlmsTxt(input: string, website?: string, options: { path?: string } = {}) {
  const issues: LlmsValidationIssue[] = [];
  const spec = (code: string, message: string, line?: number) => issues.push({ severity: "error", category: "spec", code, message, line });
  const quality = (severity: LlmsValidationIssue["severity"], code: string, message: string, line?: number) => issues.push({ severity, category: "quality", code, message, line });
  const document = input.replace(/^\uFEFF/, "");
  const bytes = Buffer.byteLength(document, "utf8");
  if (!document.trim()) spec("EMPTY", "llms.txt 내용이 비어 있습니다.");
  if (bytes > 100 * 1024) quality("warning", "TOO_LARGE", "에이전트 컨텍스트에 들어가도록 llms.txt는 100KB 이하로 유지하세요.");
  if (/<\/?(?:script|iframe|object|embed|img|form|style|link|meta)\b[^>]*>/i.test(document)) quality("warning", "HTML_FOUND", "HTML 대신 읽기 쉬운 Markdown만 사용하세요.");

  const lines = document.replaceAll("\r\n", "\n").split("\n");
  const h1Lines = lines.filter((line) => /^#\s+\S/.test(line));
  if (h1Lines.length !== 1) spec("H1_COUNT", "사이트 이름을 담은 H1은 정확히 하나여야 합니다(유일한 필수 항목).");
  const firstContent = lines.findIndex((line) => line.trim());
  if (firstContent >= 0 && !/^#\s+\S/.test(lines[firstContent])) spec("H1_FIRST", "첫 번째 콘텐츠 줄은 사이트 이름 H1이어야 합니다.", firstContent + 1);

  const firstH2 = lines.findIndex((line) => /^##\s+\S/.test(line));
  const intro = firstH2 < 0 ? lines : lines.slice(0, firstH2);
  const summaryIndex = intro.findIndex((line) => /^>\s*\S/.test(line));
  if (summaryIndex < 0) quality("warning", "SUMMARY_MISSING", "규격상 선택이지만, H1 다음에 사이트 요약 blockquote(>)를 두면 에이전트가 범위를 빨리 이해합니다.");
  else if (singleLine(lines[summaryIndex].replace(/^>+\s*/, "")).length < 20) quality("warning", "SUMMARY_SHORT", "사이트 요약을 20자 이상 구체적으로 작성하세요.", summaryIndex + 1);
  intro.forEach((line, index) => {
    if (/^#{3,6}\s+\S/.test(line)) quality("warning", "HEADING_IN_DETAILS", "첫 H2 전 세부 설명에는 제목을 쓰지 않습니다. 문서 목록은 H2 섹션으로 나누세요.", index + 1);
  });

  const h2Count = lines.filter((line) => /^##\s+\S/.test(line)).length;
  if (!h2Count) quality("info", "SECTION_MISSING", "대표 문서가 있다면 H2 섹션의 링크 목록으로 안내하세요.");

  // 링크 형식은 H2 파일 목록 안에서만 검사한다. 세부 설명의 일반 목록은 규격상 허용된다
  const linkPattern = /^\s*[-*+]\s+\[((?:\\.|[^\]])+)]\(([^)\s]+)\)(?::\s*(.*))?$/;
  const links: { title: string; url: string; description: string; line: number; optional: boolean }[] = [];
  let section: string | null = null;
  lines.forEach((line, index) => {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) { section = heading[1]!; return; }
    if (section === null || !/^\s*[-*+]\s/.test(line)) return;
    const match = line.match(linkPattern);
    if (!match) {
      spec("LINK_FORMAT", "파일 목록 항목은 '- [제목](URL): 설명' 형식의 링크로 시작해야 합니다.", index + 1);
      return;
    }
    const [, title, rawUrl, description = ""] = match;
    let url: URL | null = null;
    try { url = new URL(rawUrl!); } catch { url = null; }
    if (!url) {
      quality("warning", "LINK_URL", "상대 경로 대신 절대 http/https URL을 쓰면 어느 위치에서 읽어도 같은 문서를 가리킵니다.", index + 1);
    } else if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
      spec("LINK_URL", "링크는 자격증명이 없는 http/https URL이어야 합니다.", index + 1);
    } else {
      links.push({ title: title!, url: url.toString(), description, line: index + 1, optional: section.toLowerCase() === "optional" });
    }
  });
  if (!links.length) quality("warning", "LINKS_MISSING", "AI가 읽을 대표 문서 링크를 하나 이상 추가하세요.");

  const seen = new Map<string, number>();
  for (const link of links) {
    if (seen.has(link.url)) quality("warning", "DUPLICATE_LINK", `중복 URL을 제거하세요: ${link.url}`, link.line);
    else seen.set(link.url, link.line);
    if (!link.description.trim()) quality("info", "LINK_DESCRIPTION", `링크 설명을 추가하면 선택 기준이 선명해집니다: ${link.title}`, link.line);
  }

  if (website) {
    try {
      const parsedWebsite = new URL(website);
      if (!["http:", "https:"].includes(parsedWebsite.protocol)) throw new Error("unsupported protocol");
      const expectedOrigin = parsedWebsite.origin;
      const external = links.filter((link) => new URL(link.url).origin !== expectedOrigin).length;
      if (external) quality("info", "EXTERNAL_LINKS", `외부 도메인 링크 ${external}개가 포함되어 있습니다. 의도한 권위 출처인지 확인하세요.`);
      const path = normalizeLlmsPath(options.path);
      const scope = path.slice(0, path.length - "llms.txt".length);
      if (scope !== "/") {
        const outside = links.filter((link) => { const url = new URL(link.url); return url.origin === expectedOrigin && !url.pathname.startsWith(scope); }).length;
        if (outside) quality("info", "OUTSIDE_SCOPE", `${path}은 ${scope} 아래를 다룹니다. 같은 사이트의 범위 밖 링크 ${outside}개가 있습니다.`);
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      spec("WEBSITE_URL", "기준 웹사이트 URL이 올바르지 않습니다.");
    }
  }

  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.filter((issue) => issue.severity === "warning").length;
  const specErrors = issues.filter((issue) => issue.category === "spec").length;
  return {
    valid: specErrors === 0,
    score: Math.max(0, 100 - errors * 20 - warnings * 5),
    issues,
    stats: { bytes, lines: lines.length, sections: h2Count, links: links.length, optionalLinks: links.filter((link) => link.optional).length, errors, warnings, specErrors },
  };
}

function looksLikeHtml(text: string, contentType: string) {
  return /html/i.test(contentType) || /^\s*<(?:!doctype|html|head|body)\b/i.test(text.replace(/^\uFEFF/, ""));
}

export async function verifyRemoteLlmsTxt(website: string, pathInput?: string) {
  const site = normalizePublicUrl(website);
  const path = normalizeLlmsPath(pathInput);
  const target = new URL(path, site.origin).toString();
  const fetched = await fetchPublicText(target, 10_000);
  if (fetched.status < 200 || fetched.status >= 300) {
    const details = { requestedUrl: target, url: fetched.url, upstreamStatus: fetched.status };
    if (fetched.status === 401) {
      throw new AppError(`${target}에 인증이 필요합니다(HTTP 401). 대상 사이트의 로그인·미리보기 비밀번호 설정에서 ${path}를 로그인 없이 읽을 수 있도록 공개한 뒤 다시 확인하세요.`, 422, "LLMS_AUTH_REQUIRED", details);
    }
    if (fetched.status === 403) {
      throw new AppError(`${target}에 대한 접근이 차단되었습니다(HTTP 403). 대상 사이트의 접근 권한·방화벽·봇 차단 설정에서 ${path}의 공개 읽기를 허용한 뒤 다시 확인하세요.`, 422, "LLMS_ACCESS_DENIED", details);
    }
    if (fetched.status === 404 || fetched.status === 410) {
      throw new AppError(`${target}에서 배포된 llms.txt를 찾지 못했습니다(HTTP ${fetched.status}). 파일을 해당 경로에 업로드한 뒤 다시 확인하세요.`, 422, "LLMS_NOT_FOUND", details);
    }
    if (fetched.status === 429) {
      throw new AppError(`대상 사이트의 요청 한도를 초과했습니다(HTTP 429). 잠시 후 ${target} 확인을 다시 시도하세요.`, 422, "LLMS_RATE_LIMITED", details);
    }
    throw new AppError(`대상 사이트가 ${target} 요청에 HTTP ${fetched.status} 오류를 반환했습니다. 사이트 응답 상태를 확인한 뒤 다시 시도하세요.`, 422, "LLMS_HTTP_ERROR", details);
  }
  // 없는 경로에 200으로 HTML을 돌려주는 사이트가 많다. 게시 성공으로 보지 않는다 (§8)
  if (looksLikeHtml(fetched.text, fetched.contentType)) {
    throw new AppError(`${path} 요청에 HTML 페이지가 응답했습니다. 파일이 없을 때 보여 주는 페이지일 수 있어 게시로 인정하지 않았습니다.`, 422, "LLMS_HTML_RESPONSE");
  }
  const validation = validateLlmsTxt(fetched.text, site.toString(), { path });
  if (!validation.valid) {
    throw new AppError(`${target}에 응답한 내용이 llms.txt 규격에 맞지 않습니다. 사이트 이름 H1과 문서 구조를 확인한 뒤 다시 배포하세요. 편집 중인 문서는 유지됩니다.`, 422, "LLMS_INVALID_DOCUMENT", {
      requestedUrl: target, url: fetched.url, upstreamStatus: fetched.status, validation,
    });
  }
  const quality = (code: string, message: string) => {
    validation.issues.push({ severity: "warning", category: "quality", code, message });
    validation.stats.warnings += 1;
    validation.score = Math.max(0, validation.score - 5);
  };
  if (fetched.contentType && !/(?:text\/plain|text\/markdown|text\/x-markdown)/i.test(fetched.contentType)) {
    quality("CONTENT_TYPE", `text/plain 또는 Markdown MIME 유형을 권장합니다. 현재: ${fetched.contentType}`);
  }
  if (new URL(fetched.url).pathname !== path) quality("REDIRECTED", `${path} 요청이 ${fetched.url}(으)로 리다이렉트되었습니다. 에이전트는 원래 경로를 기대합니다.`);
  return {
    url: fetched.url,
    path,
    status: fetched.status,
    contentType: fetched.contentType,
    document: fetched.text,
    validation,
  };
}
