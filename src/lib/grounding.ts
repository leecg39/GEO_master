/**
 * 검색 기반 답변의 인용 파싱 — 공급자 응답(신뢰할 수 없는 외부 JSON)을 공통 형태로 바꾼다.
 * - cited: 답변 문장에 명시적으로 연결된 출처
 * - searched: 검색은 됐지만 답변에 명시 인용되지 않은 결과
 * 원칙 출처: leecg39/GEO_master2 TRD §4 (명시 인용과 관측 검색 결과를 구분 저장).
 */
import { normalizeUrl } from "./geo-core";

export type CitationKind = "cited" | "searched";

export interface Citation {
  url: string;
  domain: string;
  title: string | null;
  kind: CitationKind;
}

export interface GroundedAnswer {
  text: string;
  returnedModel: string | null;
  searchPerformed: boolean;
  citations: Citation[];
}

type Json = Record<string, unknown>;

const GOOGLE_REDIRECT_HOST = "vertexaisearch.cloud.google.com";
const DOMAIN_LIKE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

function record(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}

function list(value: unknown): Json[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function toCitation(rawUrl: unknown, rawTitle: unknown, kind: CitationKind): Citation | null {
  const url = normalizeUrl(text(rawUrl));
  if (!url.valid) return null;
  const title = text(rawTitle).trim() || null;
  if (url.domain === GOOGLE_REDIRECT_HOST) {
    // Gemini grounding은 리디렉션 URL을 주고 실제 도메인은 title에 담는다. 네트워크로 따라가지 않는다(SSRF 방지).
    const titleDomain = (title ?? "").toLowerCase().replace(/^www\./, "");
    return DOMAIN_LIKE.test(titleDomain) ? { url: url.normalized, domain: titleDomain, title, kind } : null;
  }
  return { url: url.normalized, domain: url.domain, title, kind };
}

/** 같은 URL은 한 번만 — 명시 인용이 검색 결과보다 우선 */
function dedupe(citations: readonly (Citation | null)[]): Citation[] {
  const byUrl = new Map<string, Citation>();
  for (const citation of citations) {
    if (!citation) continue;
    const existing = byUrl.get(citation.url);
    if (!existing || (existing.kind === "searched" && citation.kind === "cited")) {
      byUrl.set(citation.url, existing && citation.kind === "cited" ? { ...citation, title: citation.title ?? existing.title } : citation);
    }
  }
  return [...byUrl.values()].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "cited" ? -1 : 1));
}

function modelName(value: unknown) {
  return text(value) || null;
}

export function parseOpenAiGrounding(response: unknown): GroundedAnswer {
  const root = record(response);
  const output = list(root.output);
  const annotations = output
    .filter((item) => item.type === "message")
    .flatMap((item) => list(item.content))
    .flatMap((content) => list(content.annotations))
    .filter((annotation) => annotation.type === "url_citation");
  return {
    text: text(root.output_text).trim(),
    returnedModel: modelName(root.model),
    searchPerformed: output.some((item) => item.type === "web_search_call"),
    citations: dedupe(annotations.map((annotation) => toCitation(annotation.url, annotation.title, "cited"))),
  };
}

export function parseAnthropicGrounding(message: unknown): GroundedAnswer {
  const root = record(message);
  const blocks = list(root.content);
  const textBlocks = blocks.filter((block) => block.type === "text");
  const cited = textBlocks
    .flatMap((block) => list(block.citations))
    .filter((citation) => citation.type === "web_search_result_location")
    .map((citation) => toCitation(citation.url, citation.title, "cited"));
  const searched = blocks
    .filter((block) => block.type === "web_search_tool_result")
    .flatMap((block) => list(block.content))
    .filter((result) => result.type === "web_search_result")
    .map((result) => toCitation(result.url, result.title, "searched"));
  return {
    text: textBlocks.map((block) => text(block.text)).join("").trim(),
    returnedModel: modelName(root.model),
    searchPerformed: blocks.some((block) => block.type === "server_tool_use" && block.name === "web_search"),
    citations: dedupe([...cited, ...searched]),
  };
}

export function parseGeminiGrounding(response: unknown): GroundedAnswer {
  const root = record(response);
  const metadata = record(list(root.candidates)[0]?.groundingMetadata);
  const queries = Array.isArray(metadata.webSearchQueries) ? metadata.webSearchQueries : [];
  const chunks = list(metadata.groundingChunks).map((chunk) => record(chunk.web)).filter((web) => web.uri);
  return {
    text: text(root.text).trim(),
    returnedModel: modelName(root.modelVersion),
    searchPerformed: queries.length > 0 || chunks.length > 0,
    citations: dedupe(chunks.map((web) => toCitation(web.uri, web.title, "cited"))),
  };
}
