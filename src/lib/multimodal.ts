import * as cheerio from "cheerio";
import { z } from "zod";
import { contentRequestHash, findContentByRequest, storeGeneratedContent } from "./contents";
import { idempotencyKeySchema } from "./crud";
import { AppError } from "./errors";
import { fetchPublicText } from "./url-security";

export const multimodalRequestSchema = z.object({
  urls: z.array(z.string().trim().url().max(2048)).min(1).max(10).transform((urls) => [...new Set(urls)]),
  title: z.string().trim().max(120).optional().default(""),
  notes: z.string().trim().max(5_000).optional().default(""),
  clientRequestId: idempotencyKeySchema.optional(),
}).strict();

export interface ImageIssue { code: string; severity: "error" | "warning" | "info"; message: string }
export interface ImageAuditResult {
  index: number; src: string; filename: string; alt: string; decorative: boolean; chartLike: boolean;
  caption: string; companionText: string; score: number; issues: ImageIssue[];
}
export interface VideoAuditResult {
  index: number; kind: "native" | "embed"; src: string; title: string; captionLanguages: string[];
  hasChapters: boolean; hasTranscript: boolean; score: number; issues: ImageIssue[];
}

const MAX_IMAGES_PER_PAGE = 200;
const MAX_VIDEOS_PER_PAGE = 100;
function firstSrcset(value: string | undefined) { return value?.split(",", 1)[0]?.trim().split(/\s+/, 1)[0] ?? ""; }
function isVideoEmbed(source: string) {
  try {
    const host = new URL(source, "https://invalid.local").hostname.toLowerCase();
    return host === "youtu.be" || host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtube-nocookie.com" || host.endsWith(".youtube-nocookie.com") || host === "vimeo.com" || host.endsWith(".vimeo.com");
  } catch { return false; }
}

function text(value: string | undefined | null) { return (value ?? "").replace(/\s+/g, " ").trim(); }
function imageFilename(src: string, pageUrl: string) {
  try { const pathname = new URL(src, pageUrl).pathname; return decodeURIComponent(pathname.split("/").filter(Boolean).at(-1) ?? ""); }
  catch { return src.slice(0, 120); }
}
function descriptiveFilename(filename: string) {
  const stem = filename.replace(/\.[a-z0-9]{2,5}$/i, "").toLowerCase();
  if (!stem || /^(?:img|image|photo|picture|screenshot|screen-shot|untitled|download|file|asset)[-_]?\d*$/.test(stem)) return false;
  if (/^[a-f0-9]{16,}$/.test(stem) || /^\d{8,}$/.test(stem)) return false;
  return /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(stem) && /[a-z]{3}/.test(stem);
}
function genericAlt(alt: string) { return /^(?:이미지|사진|그림|차트|그래프|도표|image|photo|picture|chart|graph|icon|logo)(?:\s*\d+)?$/i.test(alt); }
function hasNumericInsight(value: string) { return /\d+(?:[.,]\d+)?\s*(?:%|퍼센트|명|개|건|배|원|년|월|회)?/.test(value); }
function describedText($: cheerio.CheerioAPI, ids: string | undefined) {
  return (ids ?? "").split(/\s+/).filter((id) => /^[\w-]+$/.test(id)).map((id) => text($(`#${id}`).text())).filter(Boolean).join(" ");
}

function auditVideos($: cheerio.CheerioAPI) {
  const videos: VideoAuditResult[] = [];
  const media = $("video, iframe[src]").filter((_, node) => node.tagName.toLowerCase() === "video" || isVideoEmbed($(node).attr("src") || ""));
  const discovered = media.length;
  media.slice(0, MAX_VIDEOS_PER_PAGE).each((index, node) => {
    const element = $(node); const tag = node.tagName.toLowerCase();
    const source = tag === "video" ? text(element.attr("src")) || text(element.find("source[src]").first().attr("src")) : text(element.attr("src"));
    const kind: "native" | "embed" = tag === "video" ? "native" : "embed";
    const title = text(element.attr("title") || element.attr("aria-label"));
    const captionTracks = tag === "video" ? element.find("track[src]").filter((_, track) => ["captions", "subtitles"].includes(($(track).attr("kind") ?? "").toLowerCase()) && Boolean(text($(track).attr("src")))) : $([]);
    const captionLanguages = captionTracks.map((_, track) => $(track).attr("srclang") || $(track).attr("label") || "미지정").get();
    const hasChapters = tag === "video" && element.find("track[src]").filter((_, track) => ($(track).attr("kind") ?? "").toLowerCase() === "chapters" && Boolean(text($(track).attr("src")))).length > 0;
    const context = element.closest("figure").length ? element.closest("figure") : element.parent();
    const hasTranscript = Boolean(describedText($, element.attr("aria-describedby")) || context.find(".transcript,[data-transcript],a[href*='transcript'],a[href*='caption']").length || /(대본|스크립트|transcript)\s*(?:보기|다운로드|제공)?/i.test(text(context.text())));
    const issues: ImageIssue[] = [];
    if (!title) issues.push({ code: "VIDEO_TITLE", severity: "error", message: "영상의 주제와 목적을 설명하는 title 또는 aria-label을 제공하세요." });
    if (kind === "native") {
      if (!captionLanguages.length) issues.push({ code: "VIDEO_CAPTIONS", severity: "error", message: "영상에 captions/subtitles WebVTT 트랙을 제공하세요." });
      if (!hasChapters) issues.push({ code: "VIDEO_CHAPTERS", severity: "warning", message: "긴 영상을 탐색할 수 있도록 chapters WebVTT 트랙을 제공하세요." });
    } else {
      issues.push({ code: "EMBED_CAPTIONS", severity: "info", message: "외부 플레이어에서 자막과 챕터가 실제 활성화됐는지 수동 확인하세요." });
    }
    if (!hasTranscript) issues.push({ code: "VIDEO_TRANSCRIPT", severity: "warning", message: "영상 주변에 검색 가능한 대본 또는 대본 링크를 제공하세요." });
    const penalty = issues.reduce((sum, issue) => sum + (issue.severity === "error" ? 30 : issue.severity === "warning" ? 12 : 3), 0);
    videos.push({ index: index + 1, kind, src: source, title, captionLanguages, hasChapters, hasTranscript, score: Math.max(0, 100 - penalty), issues });
  });
  return { videos, discovered };
}

export function auditImagesFromHtml(html: string, pageUrl: string) {
  const $ = cheerio.load(html);
  const images: ImageAuditResult[] = [];
  const imageElements = $("img");
  const discoveredImages = imageElements.length;
  imageElements.slice(0, MAX_IMAGES_PER_PAGE).each((index, node) => {
    const element = $(node);
    const src = text(element.attr("src")) || text(element.attr("data-src")) || text(element.attr("data-lazy-src")) || firstSrcset(element.attr("srcset")) || firstSrcset(element.closest("picture").find("source[srcset]").first().attr("srcset"));
    const filename = imageFilename(src, pageUrl);
    const hasAltAttribute = element.attr("alt") !== undefined;
    const alt = text(element.attr("alt"));
    const decorative = element.attr("role") === "presentation" || element.attr("aria-hidden") === "true" || (hasAltAttribute && alt === "");
    const figure = element.closest("figure");
    const caption = text(figure.find("figcaption").first().text());
    const described = describedText($, element.attr("aria-describedby"));
    const parentTextVersion = text(element.parent().find(".text-version,[data-text-alternative],table").text());
    const companionText = described || caption || parentTextVersion;
    const chartSignals = `${filename} ${alt} ${element.attr("class") ?? ""} ${figure.attr("class") ?? ""}`;
    const chartLike = /(chart|graph|diagram|infographic|plot|차트|그래프|도표|인포그래픽)/i.test(chartSignals);
    const issues: ImageIssue[] = [];
    const parentLink = element.closest("a");
    const linkedWithoutName = parentLink.length > 0 && !text(parentLink.attr("aria-label") || parentLink.attr("title") || parentLink.text()) && !describedText($, parentLink.attr("aria-labelledby"));

    if (decorative) {
      if (alt) issues.push({ code: "DECORATIVE_ALT", severity: "warning", message: "장식 이미지는 빈 alt(alt=\"\")로 보조기기에서 제외하세요." });
      if (linkedWithoutName) issues.push({ code: "LINK_ALT_MISSING", severity: "error", message: "링크의 유일한 이미지에는 링크 목적을 설명하는 alt 또는 접근 가능한 이름이 필요합니다." });
    } else if (!hasAltAttribute || !alt) {
      issues.push({ code: "ALT_MISSING", severity: "error", message: "정보성 이미지에 alt가 없습니다." });
    } else {
      if (genericAlt(alt) || alt.length < 8) issues.push({ code: "ALT_GENERIC", severity: "warning", message: "alt에 이미지의 핵심 정보와 맥락을 구체적으로 적으세요." });
      if (alt.length > 300) issues.push({ code: "ALT_TOO_LONG", severity: "warning", message: "alt는 핵심 정보 중심으로 300자 이하로 줄이세요." });
      const normalizedStem = filename.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ").toLowerCase();
      if (normalizedStem && alt.toLowerCase() === normalizedStem) issues.push({ code: "ALT_FILENAME", severity: "warning", message: "파일명을 반복하지 말고 이미지가 전달하는 정보를 설명하세요." });
    }
    if (src && !src.startsWith("data:") && !descriptiveFilename(filename)) issues.push({ code: "FILENAME", severity: "warning", message: "파일명을 영문 소문자 서술형 kebab-case로 바꾸세요." });
    if (!src) issues.push({ code: "SOURCE_MISSING", severity: "error", message: "이미지 src 또는 지연 로딩 소스가 없습니다." });
    if (chartLike) {
      if (!hasNumericInsight(`${alt} ${companionText}`)) issues.push({ code: "CHART_DATA", severity: "error", message: "차트 alt 또는 텍스트 대체본에 핵심 수치와 결론을 포함하세요." });
      if (!companionText) issues.push({ code: "CHART_TEXT", severity: "warning", message: "차트와 함께 figcaption·표·텍스트 버전을 제공하세요." });
    }
    const penalty = issues.reduce((sum, issue) => sum + (issue.severity === "error" ? 30 : issue.severity === "warning" ? 12 : 3), 0);
    images.push({ index: index + 1, src, filename, alt, decorative, chartLike, caption, companionText, score: Math.max(0, 100 - penalty), issues });
  });
  const total = images.length;
  const { videos, discovered: discoveredVideos } = auditVideos($);
  const summary = {
    total,
    discoveredImages,
    truncatedImages: Math.max(0, discoveredImages - total),
    withIssues: images.filter((image) => image.issues.length).length,
    missingAlt: images.filter((image) => image.issues.some((issue) => issue.code === "ALT_MISSING")).length,
    filenameIssues: images.filter((image) => image.issues.some((issue) => issue.code === "FILENAME")).length,
    charts: images.filter((image) => image.chartLike).length,
    chartsWithoutData: images.filter((image) => image.issues.some((issue) => issue.code === "CHART_DATA")).length,
    averageScore: total ? Math.round(images.reduce((sum, image) => sum + image.score, 0) / total) : 100,
    videos: videos.length,
    discoveredVideos,
    truncatedVideos: Math.max(0, discoveredVideos - videos.length),
    videosWithoutCaptions: videos.filter((video) => video.kind === "native" && !video.captionLanguages.length).length,
    videosWithoutChapters: videos.filter((video) => video.kind === "native" && !video.hasChapters).length,
  };
  return { pageUrl, summary, images, videos };
}

export async function runMultimodalAudit(input: unknown) {
  const parsed = multimodalRequestSchema.parse(input);
  const requestHash = contentRequestHash({ urls: parsed.urls, title: parsed.title, notes: parsed.notes });
  if (parsed.clientRequestId) {
    const existing = findContentByRequest(parsed.clientRequestId, requestHash);
    if (existing) {
      if (existing.tool !== "multimodal-audit" || !existing.output || typeof existing.output !== "object" || Array.isArray(existing.output)) {
        throw new AppError("저장된 멀티모달 감사 결과를 읽을 수 없습니다.", 409, "INVALID_STORED_MULTIMODAL_AUDIT");
      }
      return { ...(existing.output as Record<string, unknown>), contentId: existing.id };
    }
  }

  const pages: ({ ok: true; url: string; finalUrl: string; result: ReturnType<typeof auditImagesFromHtml> } | { ok: false; url: string; error: string })[] = [];
  for (const url of parsed.urls) {
    try {
      const fetched = await fetchPublicText(url);
      if (fetched.status < 200 || fetched.status >= 300 || !/^(?:text\/html|application\/xhtml\+xml)\b/i.test(fetched.contentType)) throw new AppError("HTML 페이지를 찾지 못했습니다.", 422, "NOT_HTML");
      pages.push({ ok: true, url, finalUrl: fetched.url, result: auditImagesFromHtml(fetched.text, fetched.url) });
    } catch (error) {
      pages.push({ ok: false, url, error: error instanceof AppError ? error.message : "페이지를 분석하지 못했습니다." });
    }
  }
  const successful = pages.filter((page) => page.ok);
  const summary = {
    requested: parsed.urls.length,
    succeeded: successful.length,
    failed: pages.length - successful.length,
    images: successful.reduce((sum, page) => sum + page.result.summary.total, 0),
    videos: successful.reduce((sum, page) => sum + page.result.summary.videos, 0),
    issues: successful.reduce((sum, page) => sum + page.result.summary.withIssues + page.result.videos.filter((video) => video.issues.length).length, 0),
  };
  const output = { generatedAt: new Date().toISOString(), summary, pages };
  const content = storeGeneratedContent({
    tool: "multimodal-audit",
    title: parsed.title || (parsed.urls.length === 1 ? parsed.urls[0] : `${parsed.urls.length}개 URL 멀티모달 감사`),
    notes: parsed.notes,
    clientRequestId: parsed.clientRequestId,
    requestHash,
    input: { urls: parsed.urls },
    output,
    metadata: { summary },
    origin: "generated",
  });
  return { ...output, contentId: content.id };
}
