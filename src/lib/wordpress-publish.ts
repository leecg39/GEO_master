import { decryptSecret, maskSecret, SecretDecryptionError } from "./crypto";
import { AppError } from "./errors";
import { geoPageSpecToGutenberg, slugifyTopic } from "./geo-gutenberg";
import type { GeoPageSpec } from "./geo-page-spec";
import { geoPageSpecSchema } from "./geo-page-spec";
import { ensureSettingsRow } from "./settings";
import { assertPublicUrl, normalizePublicUrl, requestPublicJson } from "./url-security";

export interface WordpressConnectionPublic {
  siteUrl: string;
  username: string;
  applicationPassword: { configured: boolean; preview: string | null; error: boolean };
  ready: boolean;
}

export function getWordpressConnectionPublic(): WordpressConnectionPublic {
  const row = ensureSettingsRow();
  const siteUrl = row.wordpressSiteUrl?.trim() ?? "";
  const username = row.wordpressUsername?.trim() ?? "";
  let applicationPassword = { configured: false, preview: null as string | null, error: false };
  if (row.wordpressApplicationPassword) {
    try {
      const value = decryptSecret(row.wordpressApplicationPassword);
      applicationPassword = {
        configured: Boolean(value),
        preview: value ? maskSecret(value) : null,
        error: false,
      };
    } catch (error) {
      if (error instanceof SecretDecryptionError) {
        applicationPassword = { configured: true, preview: null, error: true };
      } else throw error;
    }
  }
  return {
    siteUrl,
    username,
    applicationPassword,
    ready: Boolean(siteUrl && username && applicationPassword.configured && !applicationPassword.error),
  };
}

function getWordpressCredentials() {
  const row = ensureSettingsRow();
  const siteUrlRaw = row.wordpressSiteUrl?.trim() ?? "";
  const username = row.wordpressUsername?.trim() ?? "";
  const encryptedPassword = row.wordpressApplicationPassword;
  if (!siteUrlRaw || !username || !encryptedPassword) {
    throw new AppError("Settings에서 WordPress 사이트 URL·사용자명·Application Password를 저장하세요.", 422, "WORDPRESS_NOT_CONFIGURED");
  }
  let password = "";
  try {
    password = decryptSecret(encryptedPassword) ?? "";
  } catch (error) {
    if (error instanceof SecretDecryptionError) {
      throw new AppError("WordPress Application Password를 복호화할 수 없습니다. 설정에서 다시 저장해 주세요.", 409, "INVALID_WORDPRESS_PASSWORD_STORAGE");
    }
    throw error;
  }
  if (!password) {
    throw new AppError("WordPress Application Password가 비어 있습니다.", 422, "WORDPRESS_NOT_CONFIGURED");
  }
  return {
    siteUrl: normalizePublicUrl(siteUrlRaw),
    username,
    password,
  };
}

function basicAuthHeader(username: string, password: string) {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

function postsEndpoint(siteUrl: URL) {
  return `${siteUrl.toString().replace(/\/+$/, "")}/wp-json/wp/v2/posts`;
}

export interface WordpressDraftPreview {
  title: string;
  slug: string;
  status: "draft";
  contentHtml: string;
  endpoint: string;
  riskLevel: "write";
  note: string;
}

export function previewWordpressDraft(spec: GeoPageSpec): WordpressDraftPreview {
  const creds = getWordpressCredentials();
  return {
    title: spec.topic.slice(0, 200),
    slug: slugifyTopic(spec.topic),
    status: "draft",
    contentHtml: geoPageSpecToGutenberg(spec),
    endpoint: postsEndpoint(creds.siteUrl),
    riskLevel: "write",
    note: "Application Password로 draft만 생성합니다. publish 상태는 보내지 않으며 Elementor/SQL 도구는 호출하지 않습니다.",
  };
}

interface WpPostResponse {
  id?: number;
  link?: string;
  status?: string;
  message?: string;
}

export async function pushWordpressDraft(specInput: unknown) {
  const spec = geoPageSpecSchema.parse(specInput);
  const preview = previewWordpressDraft(spec);
  const creds = getWordpressCredentials();
  await assertPublicUrl(creds.siteUrl);
  const response = await requestPublicJson<WpPostResponse>(preview.endpoint, {
    method: "POST",
    body: JSON.stringify({
      title: preview.title,
      slug: preview.slug,
      status: "draft",
      content: preview.contentHtml,
    }),
    headers: {
      authorization: basicAuthHeader(creds.username, creds.password),
    },
  });
  if (response.status === 401 || response.status === 403) {
    throw new AppError("WordPress 인증에 실패했습니다. Application Password와 사용자 역할을 확인하세요.", 403, "WORDPRESS_AUTH_FAILED");
  }
  if (response.status < 200 || response.status >= 300 || !response.json?.id) {
    const detail = response.json?.message || response.text.slice(0, 200) || `HTTP ${response.status}`;
    throw new AppError(`WordPress draft 생성 실패: ${detail}`, 502, "WORDPRESS_PUBLISH_FAILED");
  }
  const postId = response.json.id;
  return {
    preview,
    postId,
    editHint: `${creds.siteUrl.toString().replace(/\/+$/, "")}/wp-admin/post.php?post=${postId}&action=edit`,
    viewUrl: response.json.link ?? null,
    status: response.json.status ?? "draft",
  };
}
