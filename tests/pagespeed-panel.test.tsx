/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PageSpeedPanel } from "@/components/PageSpeedPanel";

let root: Root | null = null;
const result = {
  url: "https://shop.example/p", strategy: "mobile", measuredAt: "2026-10-13T00:00:00Z",
  lab: { performanceScore: 73, lcpMs: 3120, cls: 0.081, tbtMs: 240, fcpMs: 1501 },
  field: { scope: "origin", overall: "FAST", metrics: [{ key: "LARGEST_CONTENTFUL_PAINT_MS", label: "LCP", p75: "2,500ms", category: "FAST" }] },
};
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; document.body.replaceChildren(); vi.unstubAllGlobals(); });
async function mount() {
  const container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<PageSpeedPanel url="https://shop.example/p" />));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  return container;
}

it("asks for a key when none is configured and never measures", async () => {
  const fetchMock = vi.fn(async (url: string) => Response.json(url.startsWith("/api/pagespeed/key") ? { configured: false, source: null } : {}));
  vi.stubGlobal("fetch", fetchMock);
  const container = await mount();
  expect(container.querySelector<HTMLInputElement>("input[type=password]")).not.toBeNull();
  expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith("/api/pagespeed?"))).toBe(false);
});

it("shows lab and real-user data in separate sections and says it is not scored", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(String(url).startsWith("/api/pagespeed/key") ? { configured: true, source: "saved" } : { result })));
  const container = await mount();
  await act(async () => { [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("모바일"))!.click(); });
  const text = container.textContent ?? "";
  expect(text).toContain("진단 점수에는 반영하지 않습니다");
  expect(text).toMatch(/실험실 측정.*Lighthouse 1회/);
  expect(text).toMatch(/실사용자 측정.*사이트 전체 기준/);
  expect(text).toContain("2,500ms");
  expect(text).toContain("73");
});
