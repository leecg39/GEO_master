/** @vitest-environment jsdom */
import fs from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChangeReportClient } from "@/components/ChangeReportClient";
import type { ChangeReport } from "@/lib/change-report";

let root: Root | null = null;
const URL_A = "https://example.com/a";

function fixture(): ChangeReport {
  const base = {
    url: URL_A, wordpressValue: null, deliveryMethod: "manual", deliveredAt: "2026-10-12T00:00:00.000Z", updatedAt: "2026-10-12T00:00:00.000Z",
    lastFinalUrl: `${URL_A}/`, finalUrlMismatch: false,
  };
  return {
    schemaVersion: 1, kind: "changes", generatedAt: "2026-10-13T00:00:00.000Z", scope: { url: URL_A, ids: null },
    kpi: { total: 2, draft: 0, approved: 0, delivered: 0, pending: 1, verified: 1, conflict: 0, failed: 0 },
    items: [
      { ...base, id: 1, field: "title", status: "verified", originalValue: "옛 제목", proposedValue: "새 제목", publicValue: "새 제목", lastCheckedAt: "2026-10-12T01:00:00.000Z", lastHttpStatus: 200, lastResult: "matched",
        history: [{ id: 9, changeItemId: 1, source: "public", result: "matched", httpStatus: 200, matched: true, actualExcerpt: "새 제목", checkedUrl: URL_A, finalUrl: `${URL_A}/`, durationMs: 120, errorCode: null, checkedAt: "2026-10-12T01:00:00.000Z" }] },
      { ...base, id: 2, field: "description", status: "verification_pending", originalValue: "", proposedValue: "<img src=x onerror=alert(1)>", publicValue: null, lastCheckedAt: null, lastHttpStatus: null, lastResult: null,
        lastFinalUrl: "https://example.com/elsewhere", finalUrlMismatch: true, history: [] },
    ],
    actions: [{ id: 2, url: URL_A, field: "description", kind: "pending", message: "공개 페이지에 아직 반영되지 않았습니다." }],
    reaudits: [{ url: URL_A, before: { id: 3, score: 18, createdAt: "2026-10-01T00:00:00.000Z" }, after: null }],
  };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(fixture())));
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

async function mount(initialUrl: string | null) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<ChangeReportClient initialUrl={initialUrl} />));
  await act(async () => { await Promise.resolve(); });
  return container;
}

it("loads the report for the URL and shows the KPIs, values and actions", async () => {
  const container = await mount(URL_A);
  expect(fetch).toHaveBeenCalledWith(`/api/change-items/report?url=${encodeURIComponent(URL_A)}`, expect.objectContaining({ cache: "no-store" }));
  const text = container.textContent ?? "";
  expect(text).toContain("반영 확인1");
  expect(text).toContain("옛 제목");
  expect(text).toContain("빈 값 또는 기록 없음");
  expect(text).toContain("확인 기록 없음");
  expect(text).toContain("연결 안 됨");
  expect(text).toContain("공개 페이지에 아직 반영되지 않았습니다.");
  expect(text).toMatch(/수정 이후 진단이 없어/);
  expect(text).toMatch(/확인 주소가 수정안 주소와 다릅니다/);
});

it("renders untrusted values as text, never as HTML", async () => {
  const container = await mount(URL_A);
  expect(container.querySelector("img")).toBeNull();
  expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
});

it("offers Markdown and JSON downloads for the same scope", async () => {
  const container = await mount(URL_A);
  const hrefs = [...container.querySelectorAll("a[download]")].map((link) => link.getAttribute("href"));
  expect(hrefs).toEqual([
    `/api/change-items/report?url=${encodeURIComponent(URL_A)}&format=md`,
    `/api/change-items/report?url=${encodeURIComponent(URL_A)}&format=json&download=1`,
  ]);
});

it("says there is nothing to compare when the URL has no change items", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...fixture(), items: [], actions: [], reaudits: [], kpi: { ...fixture().kpi, total: 0, pending: 0, verified: 0 } })));
  const container = await mount(URL_A);
  expect(container.textContent).toContain("비교할 수정안이 없습니다.");
});

it("reloads when the active project changes", async () => {
  await mount(URL_A);
  await act(async () => { window.dispatchEvent(new Event("geo-master:project-changed")); });
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("asks for a URL instead of fetching when none is given", async () => {
  const container = await mount(null);
  expect(fetch).not.toHaveBeenCalled();
  expect(container.textContent).toMatch(/URL을 입력/);
});

it("does not use dangerouslySetInnerHTML", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src/components/ChangeReportClient.tsx"), "utf8");
  expect(source).not.toContain("dangerouslySetInnerHTML");
});
