import fs from "node:fs";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { analyzePage } from "@/lib/site-ops/snapshots";
import type { ChangeItem, PageSnapshot } from "@/lib/site-ops/types";
import { compareSeoSnapshots } from "@/lib/seo/drift";
import { parseMapLinks } from "@/lib/integrations/firecrawl";
import { applyDatabaseMigrations } from "@/lib/db";
import { migrateSeoDrift } from "@/lib/db/seo-drift-migration";
import { runSeoAnalysis } from "@/lib/seo/run-analysis";

const html = fs.readFileSync(new URL("./fixtures/seo/product.ko.html", import.meta.url), "utf8");
const url = "https://example.com/tea";
function page(id: number, source = html, overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  const parsed = analyzePage(source, url);
  return { id, projectId: 1, campaignId: 2, url, finalUrl: url, statusCode: 200, contentType: "text/html",
    fetchState: "fetched", dataState: "live", renderMode: "native_fetch", capturedAt: `2026-09-10T00:00:0${id}.000Z`,
    contentHash: `raw-${id}`, revisionHash: parsed.revisionHash, responseMs: 10, bytes: source.length,
    metadata: parsed.metadata, rules: parsed.rules, parserVersion: "site-ops/2", errorCode: null,
    responseHeaders: { "content-language": "ko" }, analysis: null, ...overrides };
}
const titleChange: ChangeItem = { field: "title", before: "제주 녹차 100g", after: "제주 녹차 보관 안내", reason: "제목 수정", evidence: "snapshot/1" };

describe("approved baseline drift", () => {
  it("allows diagnostic analyzer/config upgrades and missing legacy analysis without changing the baseline", () => {
    const baseline = page(1), current = page(3);
    baseline.analysis = runSeoAnalysis(baseline);
    current.analysis = { ...runSeoAnalysis(current), version: "seo-analysis/future", configHash: "new-config" };
    expect(compareSeoSnapshots(baseline, current, [titleChange])).toMatchObject({ comparable: true, counts: { pending: 1 } });
    baseline.analysis = null;
    current.metadata!.title = titleChange.after;
    expect(compareSeoSnapshots(baseline, current, [titleChange])).toMatchObject({ comparable: true, baselineSnapshotId: 1, fields: { title: true }, counts: { expected: 1 } });
  });
  it("separates the approved title from an unexpected noindex in the same fresh capture", () => {
    const baseline = page(1);
    const current = page(3, html.replace("<title>제주 녹차 100g</title>", "<title>제주 녹차 보관 안내</title>").replace('content="index,follow"', 'content="noindex,follow"'));
    const result = compareSeoSnapshots(baseline, current, [titleChange], "2026-09-10T00:00:02.000Z");
    expect(result.fields).toEqual({ title: true });
    expect(result.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "title", classification: "expected", approvedChange: true }),
      expect.objectContaining({ field: "robots", classification: "unexpected", ruleId: "noindex-added" }),
    ]));
    expect(compareSeoSnapshots(baseline, current, [titleChange], "2026-09-10T00:00:02.000Z")).toEqual(result);
    expect(baseline.metadata?.title).toBe("제주 녹차 100g");
    expect(result.baselineSnapshotId).toBe(1);
  });
  it("keeps the unchanged approved target pending instead of verified", () => {
    const result = compareSeoSnapshots(page(1), page(3), [titleChange]);
    expect(result.fields).toEqual({ title: false });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({ field: "title", classification: "pending" });
  });
  it("accepts the removal of parse errors only when the approved JSON-LD is fully repaired", () => {
    const malformed = '<script type="application/ld+json">{"broken":</script>';
    const baseline = page(1, html + malformed), current = page(3);
    const item: ChangeItem = { field: "jsonLd", before: JSON.stringify(baseline.metadata!.jsonLd),
      after: JSON.stringify(current.metadata!.jsonLd), reason: "스키마 오류 수정", evidence: "snapshot/1" };
    const result = compareSeoSnapshots(baseline, current, [item]);
    expect(baseline.metadata!.jsonLdErrors).toBe(1);
    expect(result).toMatchObject({ comparable: true, fields: { jsonLd: true }, counts: { expected: 1, unexpected: 0 } });
    expect(compareSeoSnapshots(baseline, current, []).events).toContainEqual(
      expect.objectContaining({ field: "jsonLdErrors", classification: "unexpected" }));
  });
  it.each([1, 2])("rejects approved JSON-LD with %i remaining malformed scripts, including an unchanged error count", (remaining) => {
    const malformed = '<script type="application/ld+json">{"broken":</script>';
    const baseline = page(1, html + malformed), current = page(3, html + malformed.repeat(remaining));
    const item: ChangeItem = { field: "jsonLd", before: JSON.stringify(baseline.metadata!.jsonLd),
      after: JSON.stringify(current.metadata!.jsonLd), reason: "스키마 오류 수정", evidence: "snapshot/1" };
    const result = compareSeoSnapshots(baseline, current, [item]);
    expect(result.fields.jsonLd).toBe(true);
    expect(result.events).toContainEqual(expect.objectContaining({ field: "jsonLdErrors", classification: "unexpected", ruleId: "jsonld-errors-remain" }));
  });
  it("ignores object key order, robots token order, and raw HTML-only noise", () => {
    const current = page(3, html.replace('content="index,follow"', 'content="follow, index"'));
    current.metadata!.jsonLd = current.metadata!.jsonLd.map((entity) => Object.fromEntries(Object.entries(entity).reverse()));
    const result = compareSeoSnapshots(page(1), current, []);
    expect(result.comparable).toBe(true);
    expect(result.events).toEqual([]);
  });
  it.each(["", "https://example.com/tea/", "https://example.com/tea?utm_source=new"])("detects canonical change/removal without merging URL identity: %s", (canonical) => {
    const current = page(3);
    current.metadata!.canonical = canonical;
    expect(compareSeoSnapshots(page(1), current, []).events).toEqual([
      expect.objectContaining({ field: "canonical", classification: "unexpected", after: canonical }),
    ]);
  });
  it("does not merge different request URLs, slash variants or queries", () => {
    expect(compareSeoSnapshots(page(1), page(3, html, { url: url + "/" }), []).comparable).toBe(false);
    expect(parseMapLinks({ links: [url, url + "/", url + "?utm_source=a", url + "?utm_source=b"] }, "https://example.com"))
      .toEqual([url, url + "/", url + "?utm_source=a", url + "?utm_source=b"]);
  });
  it("rejects stale, failed, mixed-project and incompatible-condition comparisons", () => {
    const baseline = page(1);
    for (const current of [baseline, page(3, html, { capturedAt: null }),
      page(3, html, { fetchState: "failed", statusCode: 404, metadata: null }),
      page(3, html, { projectId: 99 }), page(3, html, { renderMode: "mock" }),
      page(3, html, { parserVersion: "site-ops/old" }), page(3, html, { responseHeaders: { "content-language": "en" } })]) {
      const result = compareSeoSnapshots(baseline, current, [titleChange]);
      expect(result.comparable).toBe(false);
      expect(result.counts.unknown).toBe(1);
      expect(result.fields.title).toBe(false);
      expect(result.baselineSnapshotId).toBe(1);
    }
    expect(compareSeoSnapshots(baseline, page(3), [titleChange], "2026-09-10T00:00:04.000Z").comparable).toBe(false);
  });
  it("protects final redirects and HTTP noindex even when changed title matches", () => {
    const current = page(3);
    current.metadata!.title = titleChange.after;
    current.metadata!.robotsHeader = "noindex";
    current.finalUrl = url + "/other";
    expect(compareSeoSnapshots(page(1), current, [titleChange]).events).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "title", classification: "expected" }),
      expect.objectContaining({ field: "robotsHeader", classification: "unexpected", ruleId: "http-noindex-added" }),
      expect.objectContaining({ field: "finalUrl", classification: "unexpected" }),
    ]));
  });
  it("adds v15 once, preserves existing snapshots and prevents duplicate comparison events", () => {
    const db = new Database(":memory:");
    try {
      db.pragma("foreign_keys=ON");
      db.exec(`CREATE TABLE projects(id INTEGER PRIMARY KEY); INSERT INTO projects VALUES(1);
        CREATE TABLE site_audit_campaigns(id INTEGER PRIMARY KEY); INSERT INTO site_audit_campaigns VALUES(2);
        CREATE TABLE page_snapshots(id INTEGER PRIMARY KEY,analysis TEXT); INSERT INTO page_snapshots VALUES(1,'legacy-preserved'),(3,NULL);
        CREATE TABLE change_sets(id INTEGER PRIMARY KEY,snapshot_id INTEGER,approved_at TEXT); INSERT INTO change_sets VALUES(4,1,'2026-09-10');`);
      const migration = [{ version: 15, name: "approved-seo-drift-events", up: migrateSeoDrift }];
      applyDatabaseMigrations(db, migration);
      applyDatabaseMigrations(db, migration);
      expect(db.prepare("SELECT snapshot_id FROM change_sets").get()).toEqual({ snapshot_id: 1 });
      expect(db.prepare("SELECT analysis FROM page_snapshots WHERE id=1").get()).toEqual({ analysis: "legacy-preserved" });
      const insert = db.prepare(`INSERT INTO seo_drift_events(project_id,campaign_id,change_set_id,baseline_snapshot_id,current_snapshot_id,field,classification,approved_change,rule_id,rule_version,detail,created_at)
        VALUES(1,2,4,1,3,'title','expected',1,'title-expected','drift/1','검증','2026-09-10')`);
      insert.run();
      expect(() => insert.run()).toThrow(/UNIQUE/);
      expect(db.pragma("foreign_key_check")).toEqual([]);
    } finally { db.close(); }
  });
});
