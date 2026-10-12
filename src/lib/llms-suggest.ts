/**
 * 사이트맵으로 llms.txt 초안의 문서 목록을 채운다 (RankSEO REA G4, A6).
 * - robots.txt의 Sitemap: 줄(같은 사이트만), 없으면 /sitemap.xml. 사이트맵 인덱스는 하위 5개까지 한 단계만 따라간다
 * - 같은 사이트의 HTML 페이지 주소만 최대 60개. 제목은 페이지를 다시 요청하지 않고 경로에서 만든다
 * - LLM을 쓰지 않고, 저장하지 않는다. 결과는 편집기에 채울 초안일 뿐이다
 * - 모든 요청은 fetchPublicText(SSRF 방지)를 거친다
 */
import * as cheerio from "cheerio";
import { z } from "zod";
import { AppError } from "./errors";
import type { ResourceSection } from "./llms-resources";
import { fetchPublicText } from "./url-security";

export const MAX_SUGGESTED_LINKS = 60;
const MAX_ROBOTS_SITEMAPS = 3;
const MAX_CHILD_SITEMAPS = 5;
const MAX_SECTIONS = 20;
const TIMEOUT_MS = 10_000;
const NON_HTML = /\.(pdf|jpe?g|png|gif|webp|svg|mp4|mp3|zip|xml|txt|json|css|js|ico|woff2?)$/i;

const websiteSchema = z.string().trim().max(2048).refine((value) => {
  try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; }
}, "http 또는 https 주소만 허용합니다.");

const bareHost = (host: string) => host.toLowerCase().replace(/^www\./, "");

function sameSite(url: string, origin: URL) {
  try { return bareHost(new URL(url).hostname) === bareHost(origin.hostname); } catch { return false; }
}

async function fetchOk(url: string) {
  try {
    const response = await fetchPublicText(url, TIMEOUT_MS);
    return response.status >= 200 && response.status < 300 ? response.text : null;
  } catch {
    return null;
  }
}

function readLocs(xml: string) {
  const $ = cheerio.load(xml, { xml: true });
  const kind = $("sitemapindex").length ? "index" as const : "urlset" as const;
  const locs = $(kind === "index" ? "sitemap > loc" : "url > loc").map((_, node) => $(node).text().trim()).get().filter(Boolean);
  return { kind, locs };
}

async function sitemapEntryPoints(origin: URL) {
  const robots = await fetchOk(new URL("/robots.txt", origin).toString());
  const listed = (robots ?? "").split("\n").map((line) => line.match(/^\s*sitemap\s*:\s*(\S+)/i)?.[1] ?? null)
    .filter((url): url is string => url !== null && sameSite(url, origin)).slice(0, MAX_ROBOTS_SITEMAPS);
  return listed.length ? listed : [new URL("/sitemap.xml", origin).toString()];
}

async function collectPageUrls(origin: URL) {
  const visited: string[] = [];
  const pages: string[] = [];
  const queue = (await sitemapEntryPoints(origin)).map((url) => ({ url, depth: 0 }));
  let children = 0;
  while (queue.length) {
    const { url, depth } = queue.shift()!;
    const xml = await fetchOk(url);
    if (xml === null) continue;
    visited.push(url);
    const { kind, locs } = readLocs(xml);
    if (kind === "urlset") { pages.push(...locs); continue; }
    if (depth > 0) continue;
    for (const child of locs.filter((loc) => sameSite(loc, origin))) {
      if (children >= MAX_CHILD_SITEMAPS) break;
      children += 1;
      queue.push({ url: child, depth: 1 });
    }
  }
  return { visited, pages };
}

const decode = (segment: string) => { try { return decodeURIComponent(segment); } catch { return segment; } };
const humanize = (segment: string) => decode(segment).replace(/[-_]+/g, " ").trim();

function toSections(urls: readonly string[]): ResourceSection[] {
  const groups = new Map<string, ResourceSection["links"]>();
  for (const url of urls) {
    const segments = new URL(url).pathname.split("/").filter(Boolean);
    const heading = segments.length ? decode(segments[0]!) : "홈";
    const title = segments.length ? humanize(segments.at(-1)!) || heading : "홈";
    groups.set(heading, [...(groups.get(heading) ?? []), { title, url, description: "" }]);
  }
  return [...groups].map(([heading, links]) => ({ heading, links }))
    .sort((a, b) => b.links.length - a.links.length || (a.heading === "홈" ? 1 : b.heading === "홈" ? -1 : a.heading.localeCompare(b.heading)))
    .slice(0, MAX_SECTIONS);
}

export async function suggestLlmsSections(websiteInput: unknown) {
  const origin = new URL(new URL(websiteSchema.parse(websiteInput)).origin);
  const { visited, pages } = await collectPageUrls(origin);
  const candidates = [...new Set(pages.filter((url) => sameSite(url, origin) && /^https?:\/\//i.test(url) && !NON_HTML.test(new URL(url).pathname)))];
  if (candidates.length === 0) {
    throw new AppError("사이트맵에서 이 사이트의 페이지 주소를 찾지 못했습니다. robots.txt의 Sitemap 줄이나 /sitemap.xml을 확인하세요.", 422, "LLMS_SUGGEST_EMPTY");
  }
  return {
    sections: toSections(candidates.slice(0, MAX_SUGGESTED_LINKS)),
    source: { sitemaps: visited, urlCount: candidates.length, truncated: candidates.length > MAX_SUGGESTED_LINKS },
  };
}
