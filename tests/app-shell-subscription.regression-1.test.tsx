/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/AppShell";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("@/components/ProjectSwitcher", () => ({ ProjectSwitcher: () => null }));
vi.mock("@/components/ThemeToggle", () => ({ ThemeToggle: () => null }));
let root: Root | undefined;
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
    expect([...container.querySelectorAll("button")].some((button) => button.textContent === "SEMForge")).toBe(true);
  });

  it("shows the subscription link when the status endpoint fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
    const container = await renderShell();
    expect(container.querySelector('a[href="/subscription"]')?.textContent).toBe("SEMForge Pro");
    expect(container.textContent).not.toContain("SEMForge 확인 중");
  });
});
