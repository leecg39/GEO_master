import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzePage } from "@/lib/site-ops/snapshots";
import type { PageSnapshot } from "@/lib/site-ops/types";
import type { SeoFinding } from "@/lib/seo/contracts";
import { runSeoAnalysis } from "@/lib/seo/run-analysis";
import { buildWorkCards, persistWorkCards } from "@/lib/seo/work-cards";
import { closeDatabase } from "@/lib/db";
import { requireActiveProject } from "@/lib/projects";
import { createStrategyItem, listStrategyItems } from "@/lib/strategy";

const product = fs.readFileSync(new URL("./fixtures/seo/product.ko.html", import.meta.url), "utf8");
function snapshot(html = product, overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  const parsed = analyzePage(html, "https://example.com/tea");
  return {
    id: 10, projectId: 1, campaignId: 2, url: "https://example.com/tea", finalUrl: "https://example.com/tea",
    statusCode: 200, contentType: "text/html", fetchState: "fetched", dataState: "live", renderMode: "native_fetch",
    capturedAt: "2026-09-10T00:00:00.000Z", contentHash: "raw-hash", revisionHash: parsed.revisionHash,
    responseMs: 12, bytes: Buffer.byteLength(html), metadata: parsed.metadata, rules: parsed.rules,
    parserVersion: "site-ops/2", errorCode: null, responseHeaders: {}, analysis: null, ...overrides,
  };
}

function finding(overrides: Partial<SeoFinding> = {}): SeoFinding {
  return {
    id: "finding-title",
    projectId: 1,
    snapshotId: 10,
    ruleId: "title",
    ruleVersion: "technical/1",
    analyzerVersion: "technical/1",
    analyzer: "technical",
    category: "technical",
    status: "fail",
    method: "parser_rule",
    severity: "medium",
    sourceUrl: "https://example.com/tea",
    evidenceRefs: ["page_snapshots/10#metadata.title"],
    explanation: "수집한 HTML에 title이 없습니다.",
    dependsOnFindingIds: ["finding-http"],
    proposedAction: "수집한 제목 근거를 확인하고 수정안을 검토하세요.",
    verificationSpec: { ruleId: "title", expectedStatus: "pass", requiresFreshCapture: true },
    ...overrides,
  };
}

describe("evidence-backed SEO work cards", () => {
  it("turns a fail finding with evidence into a work item that keeps refs, deps, and verification", () => {
    const missingTitle = snapshot("<html><head></head><body><p>본문만 있습니다.</p></body></html>");
    const analysis = runSeoAnalysis(missingTitle);
    const titleFail = analysis.findings.find((item) => item.ruleId === "title" && item.status === "fail");
    expect(titleFail).toBeDefined();
    expect(titleFail!.evidenceRefs.length).toBeGreaterThan(0);

    const built = buildWorkCards(analysis.findings);
    const card = built.confirmed.find((item) => item.ruleId === "title");
    expect(card).toMatchObject({
      findingId: titleFail!.id,
      snapshotId: missingTitle.id,
      evidenceRefs: titleFail!.evidenceRefs,
      dependsOnFindingIds: titleFail!.dependsOnFindingIds,
      verificationSpec: titleFail!.verificationSpec,
      decision: "confirmed",
    });
    expect(card!.evidenceRefs).toEqual(titleFail!.evidenceRefs);
    expect(card!.verificationSpec).toEqual({
      ruleId: "title",
      expectedStatus: "pass",
      requiresFreshCapture: true,
    });
  });

  it("refuses evidence-less pass/fail claims as unknown, never as a confirmed work item", () => {
    const failWithoutEvidence = finding({ evidenceRefs: [], status: "fail" });
    const passWithoutEvidence = finding({ id: "finding-pass", status: "pass", evidenceRefs: [] });
    const built = buildWorkCards([failWithoutEvidence, passWithoutEvidence, finding()]);
    expect(built.confirmed.every((card) => card.evidenceRefs.length > 0)).toBe(true);
    expect(built.confirmed.map((card) => card.findingId)).toEqual(["finding-title"]);
    expect(built.rejected).toEqual(expect.arrayContaining([
      expect.objectContaining({ findingId: "finding-title", decision: "unknown" }),
      expect.objectContaining({ findingId: "finding-pass", decision: "unknown" }),
    ]));
    expect(built.confirmed.some((card) => card.findingId === failWithoutEvidence.id && card.evidenceRefs.length === 0)).toBe(false);
    expect(built.confirmed.every((card) => card.decision === "confirmed")).toBe(true);
  });
});

describe("persisted work cards", () => {
  let directory: string;
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "geo-work-cards-"));
    vi.stubEnv("GEO_DB_PATH", path.join(directory, "test.db"));
    requireActiveProject();
  });
  afterEach(() => {
    closeDatabase(path.join(directory, "test.db"));
    fs.rmSync(directory, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("persists only confirmed cards through strategy items and keeps evidence on the stored record", () => {
    const confirmed = finding();
    const unknown = finding({ id: "finding-empty", evidenceRefs: [], status: "fail" });
    const result = persistWorkCards([confirmed, unknown]);
    expect(result.confirmed).toHaveLength(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ type: "work", data: expect.objectContaining({ kind: "seo-work-card", findingId: confirmed.id }) });
    const stored = listStrategyItems().find((item) => item.type === "work");
    expect(stored).toBeDefined();
    expect(JSON.parse(String(stored!.data.evidenceRefs))).toEqual(confirmed.evidenceRefs);
    expect(JSON.parse(String(stored!.data.dependsOnFindingIds))).toEqual(confirmed.dependsOnFindingIds);
    expect(JSON.parse(String(stored!.data.verificationSpec))).toEqual(confirmed.verificationSpec);
    expect(listStrategyItems().filter((item) => item.data.findingId === unknown.id)).toHaveLength(0);
    expect(persistWorkCards([confirmed]).items).toHaveLength(0);
  });

  it("rejects a work strategy item that has no evidence refs", () => {
    expect(() => createStrategyItem({
      type: "work",
      title: "근거 없는 결함",
      data: { kind: "seo-work-card", findingId: "x", evidenceRefs: "[]", verificationSpec: "{}" },
    })).toThrow(/근거 없는 작업 카드/);
  });
});
