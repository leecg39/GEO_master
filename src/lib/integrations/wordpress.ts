/**
 * WordPress 코어 REST 클라이언트 (R07). 근거: docs/planning/rankseo-wordpress-spike.md
 * - RankSEO는 사용자가 설정한 MCP 엔드포인트에 HTTP도 허용하고 키를 붙였다. 여기서는 https만, SSRF 방어 요청만 쓴다
 * - 인증이 붙은 요청은 리다이렉트를 따라가지 않는다(자격증명이 다른 주소로 가지 않게)
 * - 오류는 401·403·404·리다이렉트·형식 오류를 구분한다
 */
import { AppError } from "../errors";
import { sameDocumentUrl } from "../hreflang";
import { sendPublicRequest } from "../url-security";

export type SeoPlugin = "none" | "yoast" | "rankmath" | "other";

export interface WordpressCredentials {
  siteUrl: string;
  username: string;
  applicationPassword: string;
}

/** 공개 페이지와 1:1로 반영이 확인된 필드만 (R06). 다른 필드·플러그인은 수동 적용 */
export const WORDPRESS_WRITABLE_FIELDS: Readonly<Partial<Record<SeoPlugin, Readonly<Record<string, string>>>>> = Object.freeze({
  yoast: Object.freeze({ title: "_yoast_wpseo_title", description: "_yoast_wpseo_metadesc" }),
});

const TIMEOUT_MS = 12_000;

/** https만, 끝 슬래시 없는 사이트 주소(하위 경로 설치 허용) */
export function normalizeWordpressSite(input: string) {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new AppError("WordPress 사이트 주소가 올바르지 않습니다.", 422, "WORDPRESS_SITE_INVALID"); }
  if (url.protocol !== "https:") throw new AppError("WordPress 연결은 https 주소만 허용합니다. 애플리케이션 비밀번호가 평문으로 전송되지 않게 하기 위해서입니다.", 422, "WORDPRESS_HTTPS_REQUIRED");
  if (url.username || url.password || url.search || url.hash) throw new AppError("사이트 주소에 계정·쿼리·조각을 넣을 수 없습니다.", 422, "WORDPRESS_SITE_INVALID");
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

const authHeader = (credentials: WordpressCredentials) =>
  `Basic ${Buffer.from(`${credentials.username}:${credentials.applicationPassword}`).toString("base64")}`;

function failure(status: number): AppError {
  if (status >= 300 && status < 400) return new AppError("WordPress가 다른 주소로 이동시켰습니다. 사이트 주소(https, www 여부, 설치 경로)를 확인하세요.", 422, "WORDPRESS_REDIRECT");
  if (status === 401) return new AppError("WordPress 인증에 실패했습니다. 사용자명과 애플리케이션 비밀번호를 확인하세요.", 422, "WORDPRESS_AUTH_FAILED");
  if (status === 403) return new AppError("이 계정에는 해당 작업 권한이 없습니다.", 403, "WORDPRESS_FORBIDDEN");
  if (status === 404) return new AppError("WordPress에서 요청한 대상을 찾지 못했습니다.", 404, "WORDPRESS_NOT_FOUND");
  return new AppError(`WordPress가 HTTP ${status}로 응답했습니다.`, 502, "WORDPRESS_HTTP_ERROR");
}

export async function wordpressRequest<T>(site: string, path: string, options: { credentials?: WordpressCredentials; method?: "GET" | "POST"; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (options.credentials) headers.authorization = authHeader(options.credentials);
  if (options.body !== undefined) headers["content-type"] = "application/json";
  const response = await sendPublicRequest(`${site}${path}`, {
    method: options.method ?? "GET", headers, timeoutMs: TIMEOUT_MS,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (response.status < 200 || response.status >= 300) throw failure(response.status);
  try {
    return JSON.parse(response.text) as T;
  } catch {
    throw new AppError("WordPress 응답이 JSON이 아닙니다. REST API가 막혀 있거나 다른 페이지가 응답했을 수 있습니다.", 502, "WORDPRESS_BAD_RESPONSE");
  }
}

function pluginFrom(namespaces: unknown): SeoPlugin {
  const list = Array.isArray(namespaces) ? namespaces.filter((entry): entry is string => typeof entry === "string") : [];
  if (list.some((entry) => entry.startsWith("yoast/"))) return "yoast";
  if (list.some((entry) => entry.startsWith("rankmath/"))) return "rankmath";
  return "none";
}

/** 연결 확인: REST 색인(인증 없이)으로 플러그인을 감지하고, 인증된 users/me로 글 편집 권한을 확인한다 */
export async function probeWordpress(credentials: WordpressCredentials) {
  const site = normalizeWordpressSite(credentials.siteUrl);
  let index: { namespaces?: unknown };
  try {
    index = await wordpressRequest<{ namespaces?: unknown }>(site, "/wp-json/");
  } catch (error) {
    if (error instanceof AppError && ["WORDPRESS_NOT_FOUND", "WORDPRESS_BAD_RESPONSE"].includes(error.code)) {
      throw new AppError("이 주소에서 WordPress REST API(/wp-json/)를 찾지 못했습니다.", 422, "WORDPRESS_REST_NOT_FOUND");
    }
    throw error;
  }
  const me = await wordpressRequest<{ id?: number; capabilities?: Record<string, boolean> }>(site, "/wp-json/wp/v2/users/me?context=edit&_fields=id,capabilities", { credentials });
  if (me.capabilities?.edit_posts !== true) throw new AppError("이 계정에는 글 편집 권한(edit_posts)이 없습니다.", 403, "WORDPRESS_FORBIDDEN");
  return { site, seoPlugin: pluginFrom(index.namespaces), userId: me.id ?? null };
}

export type PostLookup =
  | { status: "found"; id: number; type: "post" | "page" }
  | { status: "none" }
  | { status: "ambiguous"; count: number };

/** 공개 URL → 글 ID. 마지막 경로를 slug로 글·페이지를 찾고, link가 정확히 같은 후보가 하나일 때만 인정한다 */
export async function findWordpressPost(credentials: WordpressCredentials, pageUrl: string): Promise<PostLookup> {
  const site = normalizeWordpressSite(credentials.siteUrl);
  const siteUrl = new URL(site);
  const target = new URL(pageUrl);
  const basePath = siteUrl.pathname.replace(/\/+$/, "");
  const inSitePath = !basePath || target.pathname === basePath || target.pathname.startsWith(`${basePath}/`);
  if (target.origin !== siteUrl.origin || !inSitePath) throw new AppError("연결된 WordPress 사이트의 주소가 아닙니다.", 422, "WORDPRESS_URL_OUTSIDE_SITE");
  const slug = target.pathname.slice(basePath.length).split("/").filter(Boolean).at(-1);
  if (!slug) return { status: "none" };
  let decoded = slug;
  try { decoded = decodeURIComponent(slug); } catch { /* 잘못된 % 인코딩은 원문 그대로 찾는다 */ }
  const query = `?slug=${encodeURIComponent(decoded)}&_fields=id,link,type&context=view`;
  const lists = await Promise.all(["posts", "pages"].map(async (kind) => {
    const list = await wordpressRequest<unknown>(site, `/wp-json/wp/v2/${kind}${query}`, { credentials });
    if (!Array.isArray(list)) throw new AppError("WordPress 검색 응답 형식이 예상과 다릅니다. 보안 플러그인이 REST API를 막고 있을 수 있습니다.", 502, "WORDPRESS_BAD_RESPONSE");
    return list as Array<{ id?: unknown; link?: unknown; type?: unknown }>;
  }));
  const candidates = lists.flat().filter((item): item is { id: number; link: string; type?: unknown } =>
    typeof item?.id === "number" && typeof item.link === "string" && sameDocumentUrl(item.link, pageUrl));
  if (candidates.length === 0) return { status: "none" };
  if (candidates.length > 1) return { status: "ambiguous", count: candidates.length };
  return { status: "found", id: candidates[0]!.id, type: candidates[0]!.type === "page" ? "page" : "post" };
}

export async function readWordpressMeta(credentials: WordpressCredentials, type: "post" | "page", id: number) {
  const site = normalizeWordpressSite(credentials.siteUrl);
  const row = await wordpressRequest<{ modified_gmt?: string; meta?: Record<string, unknown> }>(site, `/wp-json/wp/v2/${type}s/${id}?context=edit&_fields=id,modified_gmt,meta`, { credentials });
  return { modifiedGmt: row.modified_gmt ?? null, meta: row.meta ?? {} };
}

/** 쓰기 가능한 필드의 현재 저장값 (플러그인이 지원하지 않으면 빈 객체) */
export function mappedFields(seoPlugin: SeoPlugin, meta: Record<string, unknown>) {
  const keys = WORDPRESS_WRITABLE_FIELDS[seoPlugin] ?? {};
  return Object.fromEntries(Object.entries(keys).map(([field, key]) => [field, typeof meta[key] === "string" ? meta[key] as string : null]));
}
