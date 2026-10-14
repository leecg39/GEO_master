import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/url-security", async () => {
  const actual = await vi.importActual<typeof import("@/lib/url-security")>("@/lib/url-security");
  return { ...actual, sendPublicRequest: vi.fn(), fetchPublicText: vi.fn(), assertPublicUrl: vi.fn(async (input: string) => new URL(input)) };
});

import { POST as wordpressAction } from "@/app/api/change-items/[id]/wordpress/route";
import { approveChangeItem, createChangeItem, listChangeItems, markDelivered, verifyChangeItem } from "@/lib/change-items";
import { buildChangeReport } from "@/lib/change-report";
import { listChangeVerifications } from "@/lib/change-verifications";
import { listChangeDeliveries } from "@/lib/change-deliveries";
import { closeDatabase, getDatabase, LATEST_SCHEMA_VERSION } from "@/lib/db";
import { ensureActiveProject } from "@/lib/projects";
import { executeWordpressDelivery, previewWordpressDelivery } from "@/lib/wordpress-delivery";
import { saveWordpressConnection } from "@/lib/wordpress-connections";
import { fetchPublicText, sendPublicRequest } from "@/lib/url-security";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-wp-delivery-"));
const databasePath = path.join(dir, "geo.db");
const prevDb = process.env.GEO_DB_PATH;
const prevKey = process.env.GEO_MASTER_KEY;
const SITE = "https://wp.example";
const PAGE = `${SITE}/spike-post/`;

/** R06에서 관찰한 Yoast 28.6 동작을 메모리로 흉내 낸다 */
const wp = { meta: {} as Record<string, string>, modified: "2026-10-12T17:14:29", blogTitle: "Original Title - GEO Spike", registered: new Set(["_yoast_wpseo_title", "_yoast_wpseo_metadesc", "_yoast_wpseo_focuskw"]), posts: [] as string[] };
const page = () => `<html><head><title>${wp.meta._yoast_wpseo_title || wp.blogTitle}</title>${wp.meta._yoast_wpseo_metadesc ? `<meta name="description" content="${wp.meta._yoast_wpseo_metadesc}">` : ""}</head><body><h1>Original Title</h1></body></html>`;
const reply = (url: string, status: number, body: unknown) => ({ url, status, text: typeof body === "string" ? body : JSON.stringify(body), contentType: "application/json", retryAfter: null });

function fakeWordpress(url: string, init?: { method?: string; body?: string }) {
  if (url === `${SITE}/wp-json/`) return reply(url, 200, { namespaces: ["wp/v2", "yoast/v1"] });
  if (url.startsWith(`${SITE}/wp-json/wp/v2/users/me`)) return reply(url, 200, { id: 1, capabilities: { edit_posts: true } });
  if (url.startsWith(`${SITE}/wp-json/wp/v2/posts?slug=spike-post`)) return reply(url, 200, [{ id: 4, type: "post", link: PAGE }]);
  if (url.startsWith(`${SITE}/wp-json/wp/v2/pages?slug=`)) return reply(url, 200, []);
  if (url.startsWith(`${SITE}/wp-json/wp/v2/posts/4`)) {
    if (init?.method === "POST") {
      wp.posts.push(init.body ?? "");
      const sent = JSON.parse(init.body ?? "{}") as { meta?: Record<string, string> };
      for (const [key, value] of Object.entries(sent.meta ?? {})) if (wp.registered.has(key)) wp.meta = { ...wp.meta, [key]: value };
      wp.modified = "2026-10-13T00:00:00";
    }
    return reply(url, 200, { id: 4, modified_gmt: wp.modified, meta: { _yoast_wpseo_focuskw: "", _yoast_wpseo_title: "", _yoast_wpseo_metadesc: "", ...wp.meta, footnotes: "" } });
  }
  return reply(url, 404, { code: "rest_no_route" });
}

function approved(field: string, originalValue: string, proposedValue: string, url = PAGE) {
  const item = createChangeItem({ url, field, originalValue, proposedValue });
  return approveChangeItem(item.id, { expectedUpdatedAt: item.updatedAt });
}
const status = (id: number) => listChangeItems().find((item) => item.id === id)!.status;
const action = (id: number, body: unknown) => wordpressAction(new NextRequest(`http://localhost/api/change-items/${id}/wordpress`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: String(id) }) });

beforeAll(async () => {
  process.env.GEO_DB_PATH = databasePath;
  process.env.GEO_MASTER_KEY = "wordpress-delivery-master-key-32-chars!!";
  ensureActiveProject();
  vi.mocked(sendPublicRequest).mockImplementation(async (url: string, init) => fakeWordpress(url, init));
  await saveWordpressConnection({ siteUrl: SITE, username: "admin", applicationPassword: "abcd EFGH ijkl MNOP", allowSeoPluginWrites: true });
});
beforeEach(() => {
  wp.meta = {}; wp.posts = []; wp.registered = new Set(["_yoast_wpseo_title", "_yoast_wpseo_metadesc", "_yoast_wpseo_focuskw"]);
  vi.mocked(sendPublicRequest).mockClear();
  vi.mocked(fetchPublicText).mockReset().mockImplementation(async (url: string) => ({ url, status: 200, text: page(), contentType: "text/html", retryAfter: null }));
  getDatabase().sqlite.prepare("UPDATE wordpress_connections SET allow_seo_plugin_writes = 1, seo_plugin = 'yoast'").run();
});
afterAll(() => {
  closeDatabase(databasePath);
  fs.rmSync(dir, { recursive: true, force: true });
  if (prevDb === undefined) delete process.env.GEO_DB_PATH; else process.env.GEO_DB_PATH = prevDb;
  if (prevKey === undefined) delete process.env.GEO_MASTER_KEY; else process.env.GEO_MASTER_KEY = prevKey;
});

describe("migration 30", () => {
  it("adds change_deliveries", () => {
    expect(LATEST_SCHEMA_VERSION).toBeGreaterThanOrEqual(30);
    const columns = (getDatabase().sqlite.pragma("table_info(change_deliveries)") as { name: string }[]).map(({ name }) => name);
    expect(columns).toEqual(expect.arrayContaining(["change_item_id", "method", "target_json", "result", "http_status", "error_code", "previous_value", "remote_modified_at", "duration_ms"]));
  });
});

describe("WordPress delivery (R08)", () => {
  it("previews exactly which post, key and values will change", async () => {
    const item = approved("description", "", "새 설명입니다.");
    const preview = await previewWordpressDelivery(item.id);
    expect(preview).toMatchObject({ postId: 4, postType: "post", metaKey: "_yoast_wpseo_metadesc", storedValue: "", publicValue: null, proposedValue: "새 설명입니다.", previewToken: expect.stringMatching(/^[a-f0-9]{64}$/) });
  });

  it("writes one meta field, records the delivery and leaves verification to the public check", async () => {
    const item = approved("title", "Original Title - GEO Spike", "새 SEO 제목");
    const { previewToken } = await previewWordpressDelivery(item.id);
    const result = await executeWordpressDelivery(item.id, { previewToken });
    expect(result.item.status).toBe("delivered");
    expect(result.item.deliveryMethod).toBe("wordpress");
    expect(wp.posts).toHaveLength(1);
    expect(JSON.parse(wp.posts[0]!)).toEqual({ meta: { _yoast_wpseo_title: "새 SEO 제목" } });
    expect(listChangeDeliveries(item.id)[0]).toMatchObject({ method: "wordpress", result: "ok", httpStatus: 200, previousValue: "", remoteModifiedAt: "2026-10-13T00:00:00", target: { postId: 4, metaKey: "_yoast_wpseo_title" } });
    expect(status(item.id)).not.toBe("verified");
  });

  it("refuses items that are not approved", async () => {
    const draft = createChangeItem({ url: PAGE, field: "title", originalValue: "a", proposedValue: "b" });
    await expect(previewWordpressDelivery(draft.id)).rejects.toMatchObject({ code: "CHANGE_NOT_APPROVED" });
    expect(wp.posts).toEqual([]);
  });

  it("refuses fields and plugins without a verified 1:1 mapping", async () => {
    await expect(previewWordpressDelivery(approved("canonical", "https://a", "https://b").id)).rejects.toMatchObject({ code: "WORDPRESS_FIELD_UNSUPPORTED" });
    await expect(previewWordpressDelivery(approved("body", "x", "y").id)).rejects.toMatchObject({ code: "WORDPRESS_FIELD_UNSUPPORTED" });
    getDatabase().sqlite.prepare("UPDATE wordpress_connections SET seo_plugin = 'none'").run();
    await expect(previewWordpressDelivery(approved("title", "t", "u").id)).rejects.toMatchObject({ code: "WORDPRESS_FIELD_UNSUPPORTED" });
  });

  it("requires the plugin-write opt-in", async () => {
    getDatabase().sqlite.prepare("UPDATE wordpress_connections SET allow_seo_plugin_writes = 0").run();
    await expect(previewWordpressDelivery(approved("title", "t", "u").id)).rejects.toMatchObject({ code: "WORDPRESS_WRITES_DISABLED" });
  });

  it("marks a conflict instead of writing when the public value is no longer the original", async () => {
    const item = approved("title", "옛날 제목", "새 제목");
    const { previewToken } = await previewWordpressDelivery(item.id);
    await expect(executeWordpressDelivery(item.id, { previewToken })).rejects.toMatchObject({ code: "CHANGE_CONFLICT" });
    expect(wp.posts).toEqual([]);
    expect(status(item.id)).toBe("conflict");
    expect(listChangeDeliveries(item.id)[0]).toMatchObject({ result: "conflict", errorCode: "CHANGE_CONFLICT" });
  });

  it("refuses a stale preview when WordPress changed in between", async () => {
    const item = approved("description", "", "설명 A");
    const { previewToken } = await previewWordpressDelivery(item.id);
    wp.meta = { _yoast_wpseo_metadesc: "" }; wp.modified = "2026-10-12T23:00:00";
    await expect(executeWordpressDelivery(item.id, { previewToken })).rejects.toMatchObject({ code: "WORDPRESS_PREVIEW_STALE" });
    expect(wp.posts).toEqual([]);
    expect(status(item.id)).toBe("approved");
  });

  it("records an error and stays approved when WordPress silently ignores the field", async () => {
    wp.registered = new Set();
    const item = approved("description", "", "설명 B");
    const { previewToken } = await previewWordpressDelivery(item.id);
    await expect(executeWordpressDelivery(item.id, { previewToken })).rejects.toMatchObject({ code: "WORDPRESS_WRITE_IGNORED" });
    expect(status(item.id)).toBe("approved");
    expect(listChangeDeliveries(item.id)[0]).toMatchObject({ result: "error", errorCode: "WORDPRESS_WRITE_IGNORED" });
  });

  it("records manual deliveries in the same history", () => {
    const item = approved("title", "a", "b");
    markDelivered(item.id, { method: "manual" });
    expect(listChangeDeliveries(item.id)[0]).toMatchObject({ method: "manual", result: "ok", target: null });
  });

  it("does not let the manual API claim a WordPress delivery", () => {
    const item = approved("title", "a", "b");
    expect(() => markDelivered(item.id, { method: "wordpress" })).toThrow();
  });

  it("exposes preview and execute through one item endpoint, with no bulk route", async () => {
    const item = approved("description", "", "API 설명");
    const preview = await (await action(item.id, { action: "preview" })).json() as { preview: { previewToken: string } };
    const done = await action(item.id, { action: "execute", previewToken: preview.preview.previewToken });
    expect(done.status).toBe(200);
    expect((await done.json() as { item: { status: string } }).item.status).toBe("delivered");
    expect((await action(item.id, { action: "execute-all" })).status).toBe(422);
    expect(fs.existsSync(path.join(process.cwd(), "src/app/api/change-items/wordpress"))).toBe(false);
  });

  it("accepts WordPress whitespace normalization on write and blocks guest accounts", async () => {
    const item = approved("title", "Original Title - GEO Spike", "새   SEO\n제목 ");
    const { previewToken } = await previewWordpressDelivery(item.id);
    vi.mocked(sendPublicRequest).mockImplementation(async (url: string, init) => {
      const response = fakeWordpress(url, init);
      if (init?.method === "POST") {
        wp.meta._yoast_wpseo_title = "새 SEO 제목";
        return reply(url, 200, { id: 4, modified_gmt: wp.modified, meta: { ...wp.meta } });
      }
      return response;
    });
    const delivered = await executeWordpressDelivery(item.id, { previewToken });
    expect(delivered.item.status).toBe("delivered");
    vi.mocked(sendPublicRequest).mockImplementation(async (url: string, init) => fakeWordpress(url, init));

    const secret = "s".repeat(64);
    vi.stubEnv("GEO_AUTH_MODE", "proxy");
    vi.stubEnv("GEO_AUTH_PROXY_SECRET", secret);
    vi.stubEnv("GEO_GUEST_USERS", "guest");
    const guestRes = await wordpressAction(
      new NextRequest(`http://localhost/api/change-items/${item.id}/wordpress`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-geo-auth-secret": secret, "x-geo-auth-user": "guest" },
        body: JSON.stringify({ action: "preview" }),
      }),
      { params: Promise.resolve({ id: String(item.id) }) },
    );
    expect(guestRes.status).toBe(403);
    vi.stubEnv("GEO_AUTH_MODE", "local");
  });
});

describe("WordPress stored value in checks and the report (R09)", () => {
  it("separates 'saved in WordPress' from 'visible on the public page' while a cache is stale", async () => {
    const item = approved("title", "Original Title - GEO Spike", "캐시 테스트 제목");
    const { previewToken } = await previewWordpressDelivery(item.id);
    const stale = page();
    await executeWordpressDelivery(item.id, { previewToken });
    vi.mocked(fetchPublicText).mockImplementation(async (url: string) => ({ url, status: 200, text: stale, contentType: "text/html", retryAfter: null }));
    expect((await verifyChangeItem(item.id)).item.status).toBe("verification_pending");
    expect(listChangeVerifications(item.id).map(({ source, result, actualExcerpt }) => ({ source, result, actualExcerpt }))).toEqual(expect.arrayContaining([
      { source: "wordpress", result: "matched", actualExcerpt: "캐시 테스트 제목" },
      { source: "public", result: "pending", actualExcerpt: "Original Title - GEO Spike" },
    ]));
    const report = buildChangeReport({ ids: [item.id] });
    expect(report.items[0]).toMatchObject({ wordpressValue: "캐시 테스트 제목", publicValue: "Original Title - GEO Spike" });
    expect(report.actions[0]?.message).toMatch(/WordPress에는 저장됐지만.*캐시/);

    vi.mocked(fetchPublicText).mockImplementation(async (url: string) => ({ url, status: 200, text: page(), contentType: "text/html", retryAfter: null }));
    expect((await verifyChangeItem(item.id)).item.status).toBe("verified");
  });

  it("still checks the public page when reading WordPress fails", async () => {
    const item = approved("description", "", "실패해도 계속");
    const { previewToken } = await previewWordpressDelivery(item.id);
    await executeWordpressDelivery(item.id, { previewToken });
    vi.mocked(sendPublicRequest).mockImplementationOnce(async (url: string) => reply(url, 500, "oops"));
    expect((await verifyChangeItem(item.id)).item.status).toBe("verified");
    expect(listChangeVerifications(item.id).find((entry) => entry.source === "wordpress")).toMatchObject({ result: "fetch_error", errorCode: expect.any(String) });
  });

  it("does not read WordPress for fields it cannot map", async () => {
    const item = approved("canonical", "", "https://wp.example/x");
    markDelivered(item.id, { method: "manual" });
    vi.mocked(sendPublicRequest).mockClear();
    await verifyChangeItem(item.id);
    expect(vi.mocked(sendPublicRequest)).not.toHaveBeenCalled();
    expect(listChangeVerifications(item.id).every((entry) => entry.source === "public")).toBe(true);
  });
});
