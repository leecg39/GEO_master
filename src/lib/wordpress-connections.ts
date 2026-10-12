/**
 * 프로젝트별 WordPress 연결 저장소 (R07).
 * 애플리케이션 비밀번호는 crypto.ts로 암호화해서만 저장하고, 화면·API 응답에는 절대 돌려주지 않는다.
 */
import { z } from "zod";
import { decryptSecret, encryptSecret, SecretDecryptionError } from "./crypto";
import { getDatabase } from "./db";
import { AppError } from "./errors";
import { findWordpressPost, mappedFields, normalizeWordpressSite, probeWordpress, readWordpressMeta, type SeoPlugin, type WordpressCredentials } from "./integrations/wordpress";
import { requireActiveProject } from "./projects";
import { assertPublicUrl } from "./url-security";

export const wordpressConnectionSchema = z.object({
  siteUrl: z.string().trim().min(1).max(2048),
  username: z.string().trim().min(1).max(120),
  applicationPassword: z.string().trim().min(8).max(200),
  allowSeoPluginWrites: z.boolean().optional().default(false),
}).strict();

interface Row {
  project_id: number; site_url: string; username: string; password_encrypted: string; seo_plugin: SeoPlugin;
  allow_seo_plugin_writes: number; verified_at: string; created_at: string; updated_at: string;
}

const publicView = (row: Row) => ({
  siteUrl: row.site_url, username: row.username, seoPlugin: row.seo_plugin, allowSeoPluginWrites: row.allow_seo_plugin_writes === 1,
  passwordStored: true, verifiedAt: row.verified_at, updatedAt: row.updated_at,
});
export type WordpressConnectionView = ReturnType<typeof publicView>;

function currentRow(): Row | undefined {
  return getDatabase().sqlite.prepare("SELECT * FROM wordpress_connections WHERE project_id = ?").get(requireActiveProject().id) as Row | undefined;
}

export function getWordpressConnection(): WordpressConnectionView | null {
  const row = currentRow();
  return row ? publicView(row) : null;
}

/** 서버 내부 전용: 복호화된 자격증명과 연결 정보 */
export function getWordpressCredentials(): (WordpressCredentials & { seoPlugin: SeoPlugin; allowSeoPluginWrites: boolean }) | null {
  const row = currentRow();
  if (!row) return null;
  let password: string | null;
  try {
    password = decryptSecret(row.password_encrypted);
  } catch (error) {
    if (error instanceof SecretDecryptionError) throw new AppError("저장된 WordPress 비밀번호를 읽을 수 없습니다(서버 키가 바뀌었을 수 있음). 연결을 다시 저장하세요.", 409, "WORDPRESS_SECRET_UNREADABLE");
    throw error;
  }
  if (!password) return null;
  return { siteUrl: row.site_url, username: row.username, applicationPassword: password, seoPlugin: row.seo_plugin, allowSeoPluginWrites: row.allow_seo_plugin_writes === 1 };
}

/** 연결을 실제로 확인한 뒤에만 저장한다 */
export async function saveWordpressConnection(input: unknown): Promise<WordpressConnectionView> {
  const parsed = wordpressConnectionSchema.parse(input);
  const site = normalizeWordpressSite(parsed.siteUrl);
  await assertPublicUrl(site);
  const probe = await probeWordpress({ siteUrl: site, username: parsed.username, applicationPassword: parsed.applicationPassword });
  const project = requireActiveProject();
  const now = new Date().toISOString();
  getDatabase().sqlite.prepare(`
    INSERT INTO wordpress_connections (project_id, site_url, username, password_encrypted, seo_plugin, allow_seo_plugin_writes, verified_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET site_url = excluded.site_url, username = excluded.username, password_encrypted = excluded.password_encrypted,
      seo_plugin = excluded.seo_plugin, allow_seo_plugin_writes = excluded.allow_seo_plugin_writes, verified_at = excluded.verified_at, updated_at = excluded.updated_at
  `).run(project.id, probe.site, parsed.username, encryptSecret(parsed.applicationPassword), probe.seoPlugin, Number(parsed.allowSeoPluginWrites), now, now, now);
  return getWordpressConnection()!;
}

export function deleteWordpressConnection() {
  const result = getDatabase().sqlite.prepare("DELETE FROM wordpress_connections WHERE project_id = ?").run(requireActiveProject().id);
  return { deleted: result.changes > 0 };
}

export function requireWordpressCredentials() {
  const credentials = getWordpressCredentials();
  if (!credentials) throw new AppError("WordPress 연결이 없습니다. 먼저 연결을 저장하세요.", 409, "WORDPRESS_NOT_CONNECTED");
  return credentials;
}

/** URL의 글을 찾고, 쓰기 가능한 필드의 현재 저장값을 읽는다 */
export async function lookupWordpressPage(urlInput: unknown) {
  const url = z.string().trim().url().max(2048).parse(urlInput);
  const credentials = requireWordpressCredentials();
  const post = await findWordpressPost(credentials, url);
  if (post.status !== "found") return post;
  const stored = await readWordpressMeta(credentials, post.type, post.id);
  return { ...post, modifiedGmt: stored.modifiedGmt, fields: mappedFields(credentials.seoPlugin, stored.meta) };
}
