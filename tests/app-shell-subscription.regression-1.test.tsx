/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/AppShell";
import { semforgeFeatures, SEMFORGE_SUBSCRIPTION_PATH } from "@/lib/semforge/navigation";

const route = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));
vi.mock("@/components/ProjectSwitcher", () => ({ ProjectSwitcher: () => null }));
vi.mock("@/components/ThemeToggle", () => ({ ThemeToggle: () => null }));
let root: Root | undefined;
beforeEach(() => {
  route.pathname = "/";
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } });
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

async function renderShell(guest = false) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(<AppShell account={guest ? { id: "guest", role: "guest" } : undefined}>QA</AppShell>));
  return container;
}

// Regression: ISSUE-001 — stale subscription responses could hide the newly unlocked navigation.
// Found by /qa on 2026-10-07. Report: docs/qa/qa-report-2026-10-07.md
describe("subscription navigation refresh", () => {
  it("hides guest settings, paid navigation and settings backup paths without querying billing", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const container = await renderShell(true);
    for (const href of ["/settings", "/subscription", "/workspace", "/semforge"]) {
      expect(container.querySelector(`a[href="${href}"]`)).toBeNull();
    }
    expect(container.querySelector('a[href="/audit"]')).not.toBeNull();
    expect(container.textContent).toContain("guest · 게스트");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("ignores an older inactive response after activation was confirmed", async () => {
    let resolveInitial!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn()
      .mockReturnValueOnce(new Promise<Response>((resolve) => { resolveInitial = resolve; }))
      .mockResolvedValueOnce(Response.json({ subscription: { active: true } })));
    const container = await renderShell();
    await act(async () => window.dispatchEvent(new Event("geo-master:subscription-changed")));
    expect(container.querySelector('a[href="/subscription"]')).toBeNull();
    await act(async () => resolveInitial(Response.json({ subscription: { active: false } })));
    expect(container.querySelector('a[href="/subscription"]')).toBeNull();
    expect(container.querySelector('nav a[href="/semforge"]')?.getAttribute("target")).toBe("_blank");
  });

  it("shows the subscription link when the status endpoint fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
    const container = await renderShell();
    expect(container.querySelector('a[href="/subscription"]')?.textContent).toBe("SEMForge Pro");
    expect(container.textContent).not.toContain("SEMForge 확인 중");
  });

  it.each(["paid", "admin"])("opens a separate workspace for %s access from GEO billing", async (accessSource) => {
    route.pathname = "/subscription";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ subscription: { active: true, accessSource } })));
    const container = await renderShell();
    const link = container.querySelector('nav a[href="/semforge"]');
    expect(link?.textContent).toContain("SEMForge Pro");
    expect(link?.textContent).toContain("새 탭에서 열기");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(container.querySelector('nav a[href="/monitoring"]')).not.toBeNull();
    expect(container.querySelector('nav a[href="/ai-seo"]')).toBeNull();
  });

  it("keeps inactive accounts in the same-tab payment flow and refreshes after returning from another tab", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json({ subscription: { active: false } }))
      .mockResolvedValueOnce(Response.json({ subscription: { active: true } }))
      .mockResolvedValueOnce(Response.json({ subscription: { active: false } })));
    const container = await renderShell();
    expect(container.querySelector('a[href="/subscription"]')?.hasAttribute("target")).toBe(false);
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(container.querySelector('nav a[href="/semforge"]')?.getAttribute("target")).toBe("_blank");
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(container.querySelector('nav a[href="/semforge"]')).toBeNull();
    expect(container.querySelector('a[href="/subscription"]')).not.toBeNull();
  });

  it.each(["/semforge", ...semforgeFeatures.map(({ href }) => href), SEMFORGE_SUBSCRIPTION_PATH, "/position-tracking/123"])("keeps only SEMForge categories on %s", async (pathname) => {
    route.pathname = pathname;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ subscription: { active: true } })));
    const container = await renderShell();
    const nav = container.querySelector('nav[aria-label="SEMForge 메뉴"]')!;
    const expectedPaths = ["/semforge", ...semforgeFeatures.map(({ href }) => href), SEMFORGE_SUBSCRIPTION_PATH];
    expect([...nav.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual(expectedPaths);
    expect(nav.querySelectorAll('[target="_blank"]')).toHaveLength(0);
    expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(nav.querySelector('[aria-current="page"]')?.getAttribute("href")).toBe(pathname === "/position-tracking/123" ? "/position-tracking" : pathname);
    expect(container.querySelector('nav[aria-label="주요 메뉴"]')).toBeNull();
    expect(container.querySelector('aside > a')?.textContent).toContain("SEMForge Pro");
    expect([...container.querySelectorAll('a[href="/"]')].some((a) => a.textContent === "GEO Master로 돌아가기")).toBe(true);
  });

  it("uses the same dedicated categories in the mobile drawer", async () => {
    route.pathname = "/semforge";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ subscription: { active: true } })));
    const container = await renderShell();
    await act(async () => (container.querySelector('[aria-label="메뉴 열기"]') as HTMLButtonElement).click());
    const nav = document.querySelector('#mobile-navigation nav[aria-label="SEMForge 메뉴"]');
    expect(nav?.querySelectorAll("a")).toHaveLength(7);
    expect(nav?.querySelector('a[href="/monitoring"]')).toBeNull();
    await act(async () => (document.querySelector('[aria-label="메뉴 닫기"]') as HTMLButtonElement).click());
    expect(document.querySelector("#mobile-navigation")).toBeNull();
  });
});
