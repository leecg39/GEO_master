/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SubscriptionClient } from "@/components/SubscriptionClient";
import { proxy } from "@/proxy";

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("subscription checkout regression", () => {
  it("shows the administrator exemption without checkout controls or a monthly price", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ subscription: {
      accountId: "geo-admin", role: "admin", accessSource: "admin", billingAvailable: false,
      active: true, status: "active", amountKrw: 0, features: [],
    } })));
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(<SubscriptionClient />));
    expect(container.textContent).toContain("결제 면제");
    expect(container.textContent).toContain("geo-admin");
    expect(container.textContent).not.toContain("300,000");
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector('a[href="/semforge"]')).not.toBeNull();
  });

  it("keeps unpaid members locked and explains that live checkout is not available", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ subscription: {
      accountId: "member", role: "member", accessSource: "none", billingAvailable: false,
      active: false, status: "inactive", amountKrw: 300000, features: [],
    } })));
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(<SubscriptionClient />));
    expect(container.textContent).toContain("결제 필요");
    expect(container.textContent).toContain("결제 연동 준비 중");
    expect(container.querySelector("button")?.disabled).toBe(true);
    expect(container.querySelector('a[href="/semforge"]')).toBeNull();
  });

  // Regression: ISSUE-001 — checkout was rejected by the JSON-only proxy.
  // Found by /qa on 2026-10-07. Report: docs/qa/qa-report-2026-10-07.md
  it("starts checkout through the real proxy and announces successful activation", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const subscription = { active: false, status: "inactive", amountKrw: 300000, features: [] };
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const gate = await proxy(new NextRequest(`http://localhost${url}`, { ...init, signal: init?.signal ?? undefined }));
      if (gate.status !== 200) return gate;
      if (url.endsWith("/checkout")) return Response.json({ checkout: { orderId: "qa-order", devConfirmToken: "qa-development-token" } });
      if (url.endsWith("/confirm")) return Response.json({ subscription: { ...subscription, active: true, status: "active" } });
      return Response.json({ subscription });
    }));
    const changed = vi.fn();
    window.addEventListener("geo-master:subscription-changed", changed);
    try {
      const container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
      await act(async () => root?.render(<SubscriptionClient />));
      await act(async () => container.querySelector("button")?.click());
      expect(container.querySelector("[role=alert]")).toBeNull();
      const form = container.querySelector("form");
      expect(form).not.toBeNull();
      await act(async () => form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
      expect(container.textContent).toContain("구독이 활성화되어 있습니다.");
      expect(changed).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("geo-master:subscription-changed", changed);
    }
  });
});
