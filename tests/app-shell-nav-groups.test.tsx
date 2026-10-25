/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/AppShell";
import { CORE_NAV_GROUPS, NAV_GROUPS_STORAGE_KEY } from "@/components/NavGroups";
import type { RequestAccount } from "@/lib/request-account";

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("@/components/ProjectSwitcher", () => ({ ProjectSwitcher: () => null }));
vi.mock("@/components/ThemeToggle", () => ({ ThemeToggle: () => null }));

let root: Root | undefined;
beforeEach(() => { pathname = "/"; window.localStorage.clear(); });
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

async function shell(account: RequestAccount = { id: "local", role: "member" }, haloEnabled = true) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ subscription: { active: false } })));
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(<AppShell account={account} haloEnabled={haloEnabled}>QA</AppShell>));
  return container.querySelector<HTMLElement>("aside nav")!;
}

const groupButton = (nav: HTMLElement, label: string) =>
  [...nav.querySelectorAll<HTMLButtonElement>("button[aria-expanded]")].find((button) => button.textContent?.includes(label))!;
const panelOf = (nav: HTMLElement, button: HTMLButtonElement) => nav.querySelector<HTMLElement>(`#${CSS.escape(button.getAttribute("aria-controls")!)}`)!;

describe("grouped sidebar navigation", () => {
  it("hides the new routes when the rollout flag is off", async () => {
    const nav = await shell(undefined, false);
    expect(nav.querySelector('a[href="/opportunities"]')).toBeNull();
    expect(nav.querySelector('a[href="/library"]')).toBeNull();
    expect(nav.querySelector('a[href="/studio"]')).not.toBeNull();
  });
  it("keeps every core page reachable exactly once, with the dashboard outside any group", async () => {
    const nav = await shell();
    for (const href of CORE_NAV_GROUPS.flatMap((group) => group.items.map((item) => item.href))) {
      expect(nav.querySelectorAll(`a[href="${href}"]`), href).toHaveLength(1);
    }
    expect(nav.querySelector('a[href="/"]')?.closest("[data-nav-group]")).toBeNull();
  });

  it("opens the group of the current page and collapses the others", async () => {
    pathname = "/audit";
    const nav = await shell();
    const diagnose = groupButton(nav, "사이트 진단");
    const measure = groupButton(nav, "AI 노출 측정");
    expect(diagnose.getAttribute("aria-expanded")).toBe("true");
    expect(panelOf(nav, diagnose).hidden).toBe(false);
    expect(measure.getAttribute("aria-expanded")).toBe("false");
    expect(panelOf(nav, measure).hidden).toBe(true);
    expect(nav.querySelector('a[href="/audit"]')?.getAttribute("aria-current")).toBe("page");
  });

  it("toggles a group and remembers it in the browser", async () => {
    const nav = await shell();
    const measure = groupButton(nav, "AI 노출 측정");
    await act(async () => { measure.click(); });
    expect(measure.getAttribute("aria-expanded")).toBe("true");
    expect(panelOf(nav, measure).hidden).toBe(false);
    expect(JSON.parse(window.localStorage.getItem(NAV_GROUPS_STORAGE_KEY) ?? "{}")).toMatchObject({ measure: true });
    await act(async () => root?.unmount());
    root = undefined;
    document.body.replaceChildren();
    const again = await shell();
    expect(groupButton(again, "AI 노출 측정").getAttribute("aria-expanded")).toBe("true");
  });

  it("lets the user collapse the current page's group and marks it", async () => {
    pathname = "/changes";
    const nav = await shell();
    const improve = groupButton(nav, "콘텐츠 개선");
    await act(async () => { improve.click(); });
    expect(improve.getAttribute("aria-expanded")).toBe("false");
    expect(improve.querySelector("[data-active-dot]")).not.toBeNull();
  });

  it("still works when browser storage is unavailable or write-only blocked", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    const nav = await shell();
    const measure = groupButton(nav, "AI 노출 측정");
    await act(async () => { measure.click(); });
    expect(measure.getAttribute("aria-expanded")).toBe("true");
    await act(async () => { measure.click(); });
    expect(measure.getAttribute("aria-expanded")).toBe("false");
    vi.restoreAllMocks();

    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("QuotaExceededError"); });
    const quotaNav = await shell();
    const strategy = groupButton(quotaNav, "전략·학습");
    await act(async () => { strategy.click(); });
    expect(strategy.getAttribute("aria-expanded")).toBe("true");
    await act(async () => { strategy.click(); });
    vi.restoreAllMocks();
  });

  it("drops role-hidden pages from their group without leaving empty groups", async () => {
    const nav = await shell({ id: "guest@example.com", role: "guest" });
    expect(nav.querySelector('a[href="/workspace"]')).toBeNull();
    expect(nav.querySelector('a[href="/search-console"]')).toBeNull();
    for (const button of nav.querySelectorAll<HTMLButtonElement>("button[aria-expanded]")) {
      expect(panelOf(nav, button).querySelectorAll("a").length, button.textContent ?? "").toBeGreaterThan(0);
    }
  });
});
