import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDatabase, getDatabase } from "@/lib/db";
import { requireActiveProject, createProject } from "@/lib/projects";
import { fetchPublicText } from "@/lib/url-security";
import {
  createSiteAuditCampaign,
  getSiteAuditOverview,
  runSiteAuditCampaign,
} from "@/lib/semforge/siteaudit";
import {
  getChangeSet,
  getSiteOpsWorkspace,
  performSiteOps,
} from "@/lib/site-ops";
import { analyzePage, getSnapshot } from "@/lib/site-ops/snapshots";
import {
  generateStructuredData,
  validateStructuredData,
} from "@/lib/site-ops/structured-data";
import { parseMapLinks } from "@/lib/integrations/firecrawl";
import {
  createLlmsDocument,
  getLlmsDocument,
  updateLlmsDocument,
  verifyStoredLlmsDocument,
} from "@/lib/llms-documents";
import { verifyRemoteLlmsTxt, validateLlmsTxt } from "@/lib/llms-txt";
import type { ChangeSet, PageSnapshot } from "@/lib/site-ops/types";

vi.mock("@/lib/semforge-subscription", () => ({
  requireSemforgeSubscription: vi.fn(),
}));
vi.mock("@/lib/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/settings")>()),
  resolveFirecrawlApiKey: () => ({ value: "test-key" }),
}));
vi.mock("@/lib/url-security", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/url-security")>()),
  fetchPublicText: vi.fn(),
  assertPublicUrl: vi.fn(async (url: string) => new URL(url)),
}));
const url = "https://example.com/";
const html = (
  title = "원본 제목",
  body = "테스트 상품은 공개된 정보와 조건을 안내합니다.",
) =>
  `<!doctype html><html><head><title>${title}</title><meta name="description" content="원본 설명"></head><body><h1>테스트 상품</h1><p>${body}</p></body></html>`;
const document =
  "# 테스트\n\n## 핵심 문서\n\n- [홈](https://example.com/): 공식 소개\n";
let directory: string;
let campaignId: number;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "geo-site-ops-"));
  vi.stubEnv("GEO_DB_PATH", path.join(directory, "test.db"));
  vi.stubEnv("GEO_MASTER_KEY", "site-ops-test-key-32-characters-long");
  requireActiveProject();
  campaignId = createSiteAuditCampaign({
    name: "테스트",
    domain: "example.com",
  }).id;
  vi.mocked(fetchPublicText).mockImplementation(async (target) => ({
    url: target,
    status: 200,
    contentType: target.endsWith(".txt") ? "text/plain" : "text/html",
    text: target.endsWith(".txt") ? document : html(),
  }));
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            links: [{ url }, { url: url + "missing" }],
          }),
          { status: 200 },
        ),
    ),
  );
});
afterEach(() => {
  closeDatabase(path.join(directory, "test.db"));
  fs.rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
async function capture() {
  return (
    (await performSiteOps({ action: "capture", campaignId, url })) as {
      snapshot: PageSnapshot;
    }
  ).snapshot;
}
async function draft(
  snapshotId: number,
  field = "title",
  after = "수정한 제목",
) {
  return (
    (await performSiteOps({
      action: "draft",
      campaignId,
      snapshotId,
      items: [{ field, after, reason: "공개 정보 반영" }],
    })) as { change: ChangeSet }
  ).change;
}
async function transition(
  change: ChangeSet,
  action: "approve" | "deliver" | "verify",
) {
  return (await performSiteOps({
    action,
    campaignId,
    changeId: change.id,
    expectedUpdatedAt: change.updatedAt,
    ...(action === "approve" ? { approvedBy: "운영자" } : {}),
  })) as {
    change: ChangeSet;
    delivery?: { document: string; published: boolean };
  };
}

describe("evidence-based site operations", () => {
  it("persists versioned findings and only the allowed response headers", async () => {
    vi.mocked(fetchPublicText).mockResolvedValue({ url, status: 200, contentType: "text/html", text: html(),
      seoHeaders: { "content-language": "ko", "x-robots-tag": "index", "set-cookie": "private-cookie-marker", authorization: "private-auth-marker" } });
    const snapshot = await capture();
    expect(snapshot.responseHeaders).toEqual({ "content-language": "ko", "x-robots-tag": "index" });
    const stored = getSiteOpsWorkspace(campaignId).snapshots[0];
    expect(stored.analysis).toEqual(snapshot.analysis);
    expect(stored.analysis?.findings.every((finding) => finding.snapshotId === snapshot.id)).toBe(true);
    expect(JSON.stringify(stored)).not.toContain("private-cookie-marker");
    expect(JSON.stringify(stored)).not.toContain("private-auth-marker");
  });
  it("returns an identical retry without a second map charge and stops at the monthly limit", async () => {
    vi.stubEnv("GEO_FIRECRAWL_MONTHLY_MAP_LIMIT", "1");
    const first = await runSiteAuditCampaign(campaignId, undefined, "same-request");
    expect(await runSiteAuditCampaign(campaignId, undefined, "same-request")).toEqual(first);
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(runSiteAuditCampaign(campaignId, undefined, "new-request")).rejects.toMatchObject({code:"MAP_BUDGET_EXCEEDED"});
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(getDatabase().sqlite.prepare("SELECT SUM(reserved_calls) AS n FROM integration_jobs").get()).toEqual({n:1});
  });
  it("accepts v1/v2 map links, normalizes and excludes external or credential URLs", () => {
    expect(
      parseMapLinks(
        {
          links: [
            url,
            { url: url + "#a" },
            { url: "https://other.example/" },
            { url: "https://user:pass@example.com/" },
            { url: url + "?utm_source=x" },
          ],
        },
        "https://example.com",
      ),
    ).toEqual([url, url + "?utm_source=x"]);
    expect(() =>
      parseMapLinks(
        { success: true, links: [{ href: url }] },
        "https://example.com",
      ),
    ).toThrow(/형식/);
  });
  it("stores real 404s and separately checks llms.txt absent from map", async () => {
    vi.mocked(fetchPublicText).mockImplementation(async (target) => ({
      url: target,
      status: target.endsWith("missing") ? 404 : 200,
      contentType: target.endsWith(".txt") ? "text/plain" : "text/html",
      text: target.endsWith(".txt") ? document : html(),
    }));
    const result = await runSiteAuditCampaign(campaignId);
    expect(result).toMatchObject({
      status: "partial",
      crawledPages: 1,
      failedPages: 1,
      siteHealth: 67,
    });
    const overview = getSiteAuditOverview(campaignId);
    expect(overview.briefing.llmsState).toBe("present");
    expect(
      overview.briefing.pages.find((p) => p.url.endsWith("missing"))
        ?.statusCode,
    ).toBe(404);
    expect(overview.snapshots[0].contentHash).toHaveLength(64);
  });
  it("does not turn rate limits into successful or mock results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 429 })),
    );
    await expect(runSiteAuditCampaign(campaignId)).rejects.toMatchObject({
      code: "MAP_RATE_LIMIT",
    });
    expect(getSiteAuditOverview(campaignId).campaign).toMatchObject({
      status: "failed",
      siteHealth: null,
      dataState: "error",
    });
  });
  it("preserves discoveries with null HTTP when canceled", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        controller.abort();
        return new Response(JSON.stringify({ links: [url] }));
      }),
    );
    const result = await runSiteAuditCampaign(campaignId, controller.signal);
    expect(result.status).toBe("failed");
    expect(getSiteAuditOverview(campaignId).briefing.pages[0]).toMatchObject({
      statusCode: null,
      fetchState: "discovered",
    });
  });
  it("protects in-flight campaigns from duplicate billable calls", async () => {
    getDatabase()
      .sqlite.prepare(
        "UPDATE site_audit_campaigns SET status='running',updated_at=? WHERE id=?",
      )
      .run(new Date().toISOString(), campaignId);
    await expect(runSiteAuditCampaign(campaignId)).rejects.toMatchObject({
      code: "CAMPAIGN_RUNNING",
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("keeps legacy estimates out of current status, score and issue claims", () => {
    const sqlite = getDatabase().sqlite;
    sqlite
      .prepare(
        "INSERT INTO site_audit_pages (campaign_id,url,status_code,depth,bytes,captured_at) VALUES (?,?,200,1,0,?)",
      )
      .run(campaignId, url, new Date().toISOString());
    sqlite
      .prepare(
        "UPDATE site_audit_campaigns SET data_state='legacy_estimate',site_health=82 WHERE id=?",
      )
      .run(campaignId);
    expect(getSiteAuditOverview(campaignId).briefing).toMatchObject({
      score: null,
      pageCount: 0,
      legacyPages: 1,
    });
  });
  it("uses actual body and page type without forcing FAQ on products", () => {
    const parsed = analyzePage(
      html() +
        `<script type="application/ld+json">{"@type":"Product"}</script>`,
      url,
    );
    expect(parsed.rules.some((r) => r.code.includes("faq"))).toBe(false);
    expect(parsed.metadata.bodyText).not.toContain("@type");
    expect(parsed.metadata.title).toBe("원본 제목");
  });
  it("persists draft approval delivery and verifies only actual matching fields", async () => {
    const snapshot = await capture();
    let change = await draft(snapshot.id);
    expect(getSiteOpsWorkspace(campaignId).changes[0].status).toBe("draft");
    await expect(transition(change, "deliver")).rejects.toMatchObject({
      code: "APPROVAL_REQUIRED",
    });
    change = (await transition(change, "approve")).change;
    const delivery = await transition(change, "deliver");
    change = delivery.change;
    expect(delivery.delivery).toMatchObject({ published: false });
    expect(delivery.delivery?.document).toContain(
      "기존 사이트의 구조화 데이터 확인 메뉴",
    );
    expect(change.status).toBe("delivered");
    change = (await transition(change, "verify")).change;
    expect(change.status).toBe("verification_pending");
    expect(change.driftEvents[0]).toMatchObject({ field: "title", classification: "pending", baselineSnapshotId: snapshot.id });
    vi.mocked(fetchPublicText).mockResolvedValue({
      url,
      status: 200,
      contentType: "text/html",
      text: html("수정한 제목"),
    });
    change = (await transition(change, "verify")).change;
    expect(change.status).toBe("verified");
    expect(change.verifiedAt).not.toBeNull();
    expect(change.driftEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "title", classification: "expected", baselineSnapshotId: snapshot.id }),
      expect.objectContaining({ field: "title", classification: "pending", baselineSnapshotId: snapshot.id }),
    ]));
    expect(change.snapshotId).toBe(snapshot.id);
    expect(getChangeSet(change.id, campaignId).verification.fields).toEqual({
      title: true,
    });
  });
  it("stores approved title and unexpected noindex as distinct events in one verification", async () => {
    const snapshot = await capture();
    let change = await draft(snapshot.id);
    change = (await transition(change, "approve")).change;
    change = (await transition(change, "deliver")).change;
    vi.mocked(fetchPublicText).mockResolvedValue({ url, status: 200, contentType: "text/html", text: html("수정한 제목").replace("</head>", '<meta name="robots" content="noindex"></head>') });
    change = (await transition(change, "verify")).change;
    expect(change.status).toBe("conflict");
    expect(change.verification.fields).toEqual({ title: true });
    expect(change.driftEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "title", classification: "expected" }),
      expect.objectContaining({ field: "robots", classification: "unexpected", ruleId: "noindex-added" }),
    ]));
    expect(change.snapshotId).toBe(snapshot.id);
    const other = createSiteAuditCampaign({ name: "다른 캠페인", domain: "example.com" }).id;
    expect(() => getChangeSet(change.id, other)).toThrow(/찾을 수 없습니다/);
    createProject({ name: "다른 프로젝트", brandName: "", category: "", competitors: [], activate: true });
    expect(() => getChangeSet(change.id, campaignId)).toThrow(/찾을 수 없습니다/);
  });
  it("verifies an approved snapshot with legacy null analysis after a diagnostic upgrade", async () => {
    const snapshot = await capture();
    getDatabase().sqlite.prepare("UPDATE page_snapshots SET analysis=NULL WHERE id=?").run(snapshot.id);
    let change = await draft(snapshot.id);
    change = (await transition(change, "approve")).change;
    change = (await transition(change, "deliver")).change;
    vi.mocked(fetchPublicText).mockResolvedValue({ url, status: 200, contentType: "text/html", text: html("수정한 제목") });
    change = (await transition(change, "verify")).change;
    expect(change).toMatchObject({ status: "verified", snapshotId: snapshot.id });
    expect(change.driftEvents[0]).toMatchObject({ field: "title", classification: "expected", baselineSnapshotId: snapshot.id });
    expect(getDatabase().sqlite.prepare("SELECT analysis FROM page_snapshots WHERE id=?").get(snapshot.id)).toEqual({ analysis: null });
  });
  it.each([false, true])("verifies an approved JSON-LD repair only without remaining parser errors (remaining=%s)", async (remaining) => {
    const malformed = '<script type="application/ld+json">{"broken":</script>';
    vi.mocked(fetchPublicText).mockResolvedValue({ url, status: 200, contentType: "text/html", text: html() + malformed });
    const snapshot = await capture();
    expect(snapshot.metadata?.jsonLdErrors).toBe(1);
    const valid = JSON.stringify({ "@context": "https://schema.org", "@type": "WebPage", "@id": url + "#webpage", name: "테스트 상품" });
    let change = await draft(snapshot.id, "jsonLd", valid);
    change = (await transition(change, "approve")).change;
    change = (await transition(change, "deliver")).change;
    vi.mocked(fetchPublicText).mockResolvedValue({ url, status: 200, contentType: "text/html",
      text: html() + `<script type="application/ld+json">${valid}</script>` + (remaining ? malformed : "") });
    change = (await transition(change, "verify")).change;
    expect(change).toMatchObject({ status: remaining ? "conflict" : "verified", snapshotId: snapshot.id });
    expect(change.driftEvents).toContainEqual(expect.objectContaining({ field: "jsonLd", classification: "expected", baselineSnapshotId: snapshot.id }));
    expect(change.driftEvents.some((event) => event.classification === "unexpected")).toBe(remaining);
    expect(getSnapshot(snapshot.id, snapshot.projectId).metadata?.jsonLdErrors).toBe(1);
  });
  it("retains failed verification and its unknown event without changing the approved baseline", async () => {
    const snapshot = await capture();
    let change = await draft(snapshot.id);
    change = (await transition(change, "approve")).change;
    change = (await transition(change, "deliver")).change;
    vi.mocked(fetchPublicText).mockRejectedValue(new Error("timeout"));
    change = (await transition(change, "verify")).change;
    expect(change).toMatchObject({ status: "failed", snapshotId: snapshot.id, verifiedAt: null });
    expect(change.driftEvents[0]).toMatchObject({ field: "collection", classification: "unknown", baselineSnapshotId: snapshot.id });
    expect(getSiteOpsWorkspace(campaignId).snapshots[0].fetchState).toBe("failed");
  });
  it("detects changed source before approval and before delivery", async () => {
    let change = await draft((await capture()).id);
    vi.mocked(fetchPublicText).mockResolvedValue({
      url,
      status: 200,
      contentType: "text/html",
      text: html("타인 수정"),
    });
    expect((await transition(change, "approve")).change.status).toBe(
      "conflict",
    );
    change = await draft((await capture()).id);
    change = (await transition(change, "approve")).change;
    vi.mocked(fetchPublicText).mockResolvedValue({
      url,
      status: 200,
      contentType: "text/html",
      text: html("다시 변경"),
    });
    const result = await transition(change, "deliver");
    expect(result.change.status).toBe("conflict");
    expect(result.delivery).toBeUndefined();
  });
  it("does not verify matching metadata if visible source content changed", async () => {
    let change = await draft((await capture()).id);
    change = (await transition(change, "approve")).change;
    change = (await transition(change, "deliver")).change;
    vi.mocked(fetchPublicText).mockResolvedValue({
      url,
      status: 200,
      contentType: "text/html",
      text: html("수정한 제목", "완전히 다른 상품"),
    });
    expect((await transition(change, "verify")).change.status).toBe("conflict");
  });
  it("requires a separate confirmation for search indexing changes", async () => {
    const change = await draft((await capture()).id, "robots", "noindex");
    await expect(transition(change, "approve")).rejects.toMatchObject({
      code: "POLICY_CONFIRMATION_REQUIRED",
    });
  });
  it("blocks other projects and campaign/snapshot ID mixing", async () => {
    const snapshot = await capture();
    const other = createSiteAuditCampaign({
      name: "다른 캠페인",
      domain: "example.com",
    }).id;
    await expect(
      performSiteOps({
        action: "draft",
        campaignId: other,
        snapshotId: snapshot.id,
        items: [{ field: "title", after: "제목", reason: "변경" }],
      }),
    ).rejects.toMatchObject({ code: "SNAPSHOT_SCOPE_MISMATCH" });
    const project = createProject({
      name: "다른 프로젝트",
      brandName: "",
      category: "",
      competitors: [],
      activate: true,
    });
    expect(project.id).not.toBe(snapshot.projectId);
    await expect(
      performSiteOps({ action: "capture", campaignId, url }),
    ).rejects.toMatchObject({ code: "CAMPAIGN_NOT_FOUND" });
  });
  it("rejects external URL capture before requesting it", async () => {
    await expect(
      performSiteOps({
        action: "capture",
        campaignId,
        url: "https://other.example/",
      }),
    ).rejects.toMatchObject({ code: "SITE_SCOPE_MISMATCH" });
    expect(fetchPublicText).not.toHaveBeenCalled();
  });
  it("allows capturing the www host of the campaign apex domain", async () => {
    const result = await performSiteOps({
      action: "capture",
      campaignId,
      url: "https://www.example.com/",
    });
    expect(result).toMatchObject({ snapshot: { url: "https://www.example.com/" } });
    expect(fetchPublicText).toHaveBeenCalled();
  });
  it("generates schema without invented prices and blocks unsupported facts or duplicate IDs", () => {
    const page = analyzePage(html(), url).metadata;
    const generated = generateStructuredData(page, url, "Product");
    expect(generated.document).not.toMatch(/offers|rating|price/);
    const schema = JSON.parse(generated.document);
    expect(() =>
      validateStructuredData(
        JSON.stringify({ ...schema, offers: { "@type": "Offer", price: 999 } }),
        page,
        url,
      ),
    ).toThrow(/원본/);
    expect(() =>
      validateStructuredData(
        JSON.stringify({ ...schema, name: "가짜 상품" }),
        page,
        url,
      ),
    ).toThrow(/근거/);
    expect(() =>
      validateStructuredData(JSON.stringify([schema, schema]), page, url),
    ).toThrow(/중복/);
  });
});

describe("AI file evidence", () => {
  it("allows omitted summary and rejects an HTML 200 response", async () => {
    expect(validateLlmsTxt(document).valid).toBe(true);
    vi.mocked(fetchPublicText).mockResolvedValue({
      url: url + "llms.txt",
      status: 200,
      contentType: "text/html",
      text: html(),
    });
    const remote = await verifyRemoteLlmsTxt(url, "/llms.txt", document);
    expect(remote.verified).toBe(false);
    expect(remote.validation.valid).toBe(false);
  });
  it("verifies scoped paths and preserves local draft on content mismatch", async () => {
    const local = createLlmsDocument({
      title: "안내",
      website: url,
      brandName: "브랜드",
      summary: "",
      resources: [{ title: "홈", url }],
      document,
      targetPath: "/docs/llms.txt",
      language: "ko",
    });
    vi.mocked(fetchPublicText).mockResolvedValue({
      url: url + "docs/llms.txt",
      status: 200,
      contentType: "text/plain",
      text: document.replace("테스트", "원격 변경"),
    });
    const result = await verifyStoredLlmsDocument(local.id, {
      expectedUpdatedAt: local.updatedAt,
    });
    expect(result).toMatchObject({
      document,
      status: "draft",
      remoteMatch: false,
    });
    expect(result.remoteDocument).toContain("원격 변경");
    expect(fetchPublicText).toHaveBeenCalledWith(url + "docs/llms.txt", 10000, {
      origin: "https://example.com",
    });
    vi.mocked(fetchPublicText).mockResolvedValue({
      url: url + "docs/llms.txt",
      status: 200,
      contentType: "text/plain",
      text: document.replaceAll("\n", "\r\n"),
    });
    const verified = await verifyStoredLlmsDocument(local.id, {
      expectedUpdatedAt: result.updatedAt,
    });
    expect(verified.status).toBe("deployed");
    expect(() =>
      updateLlmsDocument(local.id, {
        status: "deployed",
        expectedUpdatedAt: verified.updatedAt,
      }),
    ).toThrow(/재검증/);
    const updated = updateLlmsDocument(local.id, {
      document: document + "\n안내 추가",
      expectedUpdatedAt: verified.updatedAt,
    });
    expect(updated.status).toBe("validated");
    expect(updated.remoteMatch).toBeNull();
    expect(getLlmsDocument(local.id).document).toContain("안내 추가");
  });
});
