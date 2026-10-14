import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/url-security", async () => {
  const actual = await vi.importActual<typeof import("@/lib/url-security")>("@/lib/url-security");
  return { ...actual, sendPublicRequest: vi.fn(), assertPublicUrl: vi.fn(async (input: string) => new URL(input)) };
});

import { DELETE as deleteConnection, GET as getConnection, PUT as putConnection } from "@/app/api/wordpress/connection/route";
import { GET as lookup } from "@/app/api/wordpress/lookup/route";
import { closeDatabase, getDatabase, LATEST_SCHEMA_VERSION } from "@/lib/db";
import { ensureActiveProject } from "@/lib/projects";
import { getWordpressCredentials } from "@/lib/wordpress-connections";
import { assertPublicUrl, sendPublicRequest } from "@/lib/url-security";

const fixture = (name: string) => fs.readFileSync(path.join(process.cwd(), "tests/fixtures/wordpress", name), "utf8").replaceAll("http:\\/\\/127.0.0.1:9412", "https:\\/\\/wp.example");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-wordpress-"));
const databasePath = path.join(dir, "geo.db");
const prevDb = process.env.GEO_DB_PATH;
const prevKey = process.env.GEO_MASTER_KEY;
const PASSWORD = "abcd EFGH ijkl MNOP qrst UVWX";
const SITE = "https://wp.example";

type Reply = { status: number; text: string; url?: string };
let routes: Record<string, Reply>;
function respond(url: string): Reply {
  // REST 색인(/wp-json/)은 정확히 같을 때만, 나머지는 앞부분 일치
  const key = Object.keys(routes).find((prefix) => prefix.endsWith("/wp-json/") ? url === prefix : url.startsWith(prefix));
  return key ? routes[key]! : { status: 404, text: fixture("error-404.json") };
}
const json = (status: number, text: string): Reply => ({ status, text });
const okRoutes = () => ({
  [`${SITE}/wp-json/wp/v2/users/me`]: json(200, fixture("users-me.json")),
  [`${SITE}/wp-json/wp/v2/posts?slug=spike-post`]: json(200, fixture("posts-by-slug.json")),
  [`${SITE}/wp-json/wp/v2/pages?slug=spike-post`]: json(200, "[]"),
  [`${SITE}/wp-json/wp/v2/posts/4?context=edit`]: json(200, fixture("post-edit-yoast.json")),
  [`${SITE}/wp-json/`]: json(200, fixture("index-yoast.json")),
});

const put = (body: unknown) => putConnection(new NextRequest("http://localhost/api/wordpress/connection", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
const valid = { siteUrl: SITE, username: "admin", applicationPassword: PASSWORD };

beforeAll(() => {
  process.env.GEO_DB_PATH = databasePath;
  process.env.GEO_MASTER_KEY = "wordpress-connection-master-key-32chars!";
  ensureActiveProject();
});
beforeEach(() => {
  routes = okRoutes();
  vi.mocked(sendPublicRequest).mockReset().mockImplementation(async (url: string) => ({ url, contentType: "application/json", ...respond(url) }));
  vi.mocked(assertPublicUrl).mockClear();
});
afterAll(() => {
  closeDatabase(databasePath);
  fs.rmSync(dir, { recursive: true, force: true });
  if (prevDb === undefined) delete process.env.GEO_DB_PATH; else process.env.GEO_DB_PATH = prevDb;
  if (prevKey === undefined) delete process.env.GEO_MASTER_KEY; else process.env.GEO_MASTER_KEY = prevKey;
});

describe.sequential("WordPress connection (R07)", () => {
  it("adds the wordpress_connections table", () => {
    expect(LATEST_SCHEMA_VERSION).toBeGreaterThanOrEqual(29);
    const columns = (getDatabase().sqlite.pragma("table_info(wordpress_connections)") as { name: string }[]).map(({ name }) => name);
    expect(columns).toEqual(expect.arrayContaining(["project_id", "site_url", "username", "password_encrypted", "seo_plugin", "allow_seo_plugin_writes", "verified_at"]));
  });

  it("verifies, detects Yoast and stores the password only encrypted", async () => {
    const response = await put({ ...valid, allowSeoPluginWrites: true });
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).not.toContain(PASSWORD);
    expect(JSON.parse(body).connection).toMatchObject({ siteUrl: SITE, username: "admin", seoPlugin: "yoast", allowSeoPluginWrites: true, passwordStored: true, verifiedAt: expect.any(String) });
    const row = getDatabase().sqlite.prepare("SELECT password_encrypted FROM wordpress_connections").get() as { password_encrypted: string };
    expect(row.password_encrypted).not.toContain("abcd");
    expect(getWordpressCredentials()?.applicationPassword).toBe(PASSWORD);
    const auth = vi.mocked(sendPublicRequest).mock.calls.find(([url]) => url.includes("/users/me"))?.[1]?.headers?.authorization;
    expect(auth).toBe(`Basic ${Buffer.from(`admin:${PASSWORD}`).toString("base64")}`);
    expect(vi.mocked(sendPublicRequest).mock.calls.find(([url]) => url.endsWith("/wp-json/"))?.[1]?.headers?.authorization).toBeUndefined();
  });

  it("never returns the password from GET", async () => {
    const text = await (await getConnection()).text();
    expect(text).not.toContain(PASSWORD);
    expect(JSON.parse(text).connection.seoPlugin).toBe("yoast");
  });

  it("requires https and checks the address is public", async () => {
    expect((await put({ ...valid, siteUrl: "http://wp.example" })).status).toBe(422);
    const { AppError } = await import("@/lib/errors");
    vi.mocked(assertPublicUrl).mockRejectedValueOnce(new AppError("사설 IP", 403, "PRIVATE_IP_BLOCKED"));
    expect((await put({ ...valid, siteUrl: "https://intranet.example" })).status).toBe(403);
  });

  it("tells 401, 403 and a missing REST API apart without saving", async () => {
    getDatabase().sqlite.exec("DELETE FROM wordpress_connections");
    routes[`${SITE}/wp-json/wp/v2/users/me`] = json(401, fixture("error-401.json"));
    expect(await (await put(valid)).json()).toMatchObject({ code: "WORDPRESS_AUTH_FAILED" });
    routes[`${SITE}/wp-json/wp/v2/users/me`] = json(200, JSON.stringify({ id: 2, slug: "viewer", capabilities: { edit_posts: false } }));
    expect(await (await put(valid)).json()).toMatchObject({ code: "WORDPRESS_FORBIDDEN" });
    routes[`${SITE}/wp-json/`] = json(404, "<html>not found</html>");
    expect(await (await put(valid)).json()).toMatchObject({ code: "WORDPRESS_REST_NOT_FOUND" });
    expect(getDatabase().sqlite.prepare("SELECT COUNT(*) AS n FROM wordpress_connections").get()).toEqual({ n: 0 });
  });

  it("does not follow redirects with credentials", async () => {
    routes[`${SITE}/wp-json/wp/v2/users/me`] = { status: 301, text: "" };
    expect(await (await put(valid)).json()).toMatchObject({ code: "WORDPRESS_REDIRECT" });
  });

  it("finds exactly one post for a URL and reads the Yoast fields", async () => {
    expect((await put(valid)).status).toBe(200);
    const response = await lookup(new NextRequest(`http://localhost/api/wordpress/lookup?url=${encodeURIComponent(`${SITE}/spike-post/`)}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ result: { status: "found", id: 4, type: "post", modifiedGmt: expect.any(String), fields: { title: "Exact SEO Title For Spike", description: "Spike meta description from REST." } } });
  });

  it("reports none and ambiguous candidates instead of guessing", async () => {
    routes[`${SITE}/wp-json/wp/v2/posts?slug=spike-post`] = json(200, "[]");
    const none = await lookup(new NextRequest(`http://localhost/api/wordpress/lookup?url=${encodeURIComponent(`${SITE}/spike-post/`)}`));
    expect(await none.json()).toMatchObject({ result: { status: "none" } });
    routes[`${SITE}/wp-json/wp/v2/posts?slug=spike-post`] = json(200, JSON.stringify([{ id: 4, link: `${SITE}/spike-post/`, type: "post" }]));
    routes[`${SITE}/wp-json/wp/v2/pages?slug=spike-post`] = json(200, JSON.stringify([{ id: 9, link: `${SITE}/spike-post/`, type: "page" }]));
    const both = await lookup(new NextRequest(`http://localhost/api/wordpress/lookup?url=${encodeURIComponent(`${SITE}/spike-post/`)}`));
    expect(await both.json()).toMatchObject({ result: { status: "ambiguous", count: 2 } });
  });

  it("refuses URLs on another site", async () => {
    const response = await lookup(new NextRequest(`http://localhost/api/wordpress/lookup?url=${encodeURIComponent("https://other.example/spike-post/")}`));
    expect(await response.json()).toMatchObject({ code: "WORDPRESS_URL_OUTSIDE_SITE" });
  });

  it("handles a malformed percent-encoded path without crashing", async () => {
    // 실제 WordPress는 없는 slug에 빈 배열을 돌려준다
    routes[`${SITE}/wp-json/wp/v2/posts?slug=`] = json(200, "[]");
    routes[`${SITE}/wp-json/wp/v2/pages?slug=`] = json(200, "[]");
    const response = await lookup(new NextRequest(`http://localhost/api/wordpress/lookup?url=${encodeURIComponent(`${SITE}/bad%E0%A4%A/`)}`));
    expect(response.status).toBe(200);
    expect((await response.json()).result.status).toBe("none");
  });

  it("reports a non-array search response as a bad response, not a crash", async () => {
    routes[`${SITE}/wp-json/wp/v2/posts?slug=spike-post`] = json(200, JSON.stringify({ blocked: true }));
    const response = await lookup(new NextRequest(`http://localhost/api/wordpress/lookup?url=${encodeURIComponent(`${SITE}/spike-post/`)}`));
    expect(await response.json()).toMatchObject({ code: "WORDPRESS_BAD_RESPONSE" });
  });

  it("asks to reconnect when the stored password can no longer be decrypted", async () => {
    getDatabase().sqlite.prepare("UPDATE wordpress_connections SET password_encrypted = 'v1:broken:broken:broken'").run();
    const response = await lookup(new NextRequest(`http://localhost/api/wordpress/lookup?url=${encodeURIComponent(`${SITE}/spike-post/`)}`));
    expect(await response.json()).toMatchObject({ code: "WORDPRESS_SECRET_UNREADABLE" });
  });

  it("deletes the connection", async () => {
    expect((await deleteConnection()).status).toBe(200);
    expect(getWordpressCredentials()).toBeNull();
    expect((await (await getConnection()).json()).connection).toBeNull();
  });

  it("rejects colons in usernames, non-http lookup URLs, and URLs outside a subdirectory install", async () => {
    expect((await put({ ...valid, username: "admin:injected" })).status).toBe(422);
    routes[`${SITE}/blog/wp-json/`] = json(200, fixture("index-yoast.json"));
    routes[`${SITE}/blog/wp-json/wp/v2/users/me`] = json(200, fixture("users-me.json"));
    expect((await put({ ...valid, siteUrl: `${SITE}/blog` })).status).toBe(200);

    const outsideSubdir = await lookup(new NextRequest(`http://localhost/api/wordpress/lookup?url=${encodeURIComponent(`${SITE}/shop/item`)}`));
    expect(outsideSubdir.status).toBe(422);
    expect(await outsideSubdir.json()).toMatchObject({ code: "WORDPRESS_URL_OUTSIDE_SITE" });

    const rootOfSubdir = await lookup(new NextRequest(`http://localhost/api/wordpress/lookup?url=${encodeURIComponent(`${SITE}/blog/`)}`));
    expect(rootOfSubdir.status).toBe(200);
    expect(await rootOfSubdir.json()).toMatchObject({ result: { status: "none" } });

    const nonHttp = await lookup(new NextRequest(`http://localhost/api/wordpress/lookup?url=${encodeURIComponent("ftp://wp.example/blog/post")}`));
    expect(nonHttp.status).toBe(422);
  });

  it("blocks guest accounts from saving or deleting connections", async () => {
    const secret = "s".repeat(64);
    vi.stubEnv("GEO_AUTH_MODE", "proxy");
    vi.stubEnv("GEO_AUTH_PROXY_SECRET", secret);
    vi.stubEnv("GEO_GUEST_USERS", "guest");
    const guestHeaders = { "content-type": "application/json", "x-geo-auth-secret": secret, "x-geo-auth-user": "guest" };
    expect((await putConnection(new NextRequest("http://localhost/api/wordpress/connection", { method: "PUT", headers: guestHeaders, body: JSON.stringify(valid) }))).status).toBe(403);
    expect((await deleteConnection(new NextRequest("http://localhost/api/wordpress/connection", { method: "DELETE", headers: guestHeaders }))).status).toBe(403);
    vi.stubEnv("GEO_AUTH_MODE", "local");
  });
});
