/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GscApiPanel } from "@/components/GscApiPanel";

let root: Root | undefined;
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); });
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function renderPanel() {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(<GscApiPanel />));
  await act(async () => { await vi.runAllTimersAsync(); });
  return container;
}
const status = (state: string, siteUrl: string | null, lastError: string | null = null) => ({
  status: { configured: true, state, siteUrl, lastError, lastSyncedAt: null }, latest: null,
});

describe("GSC connection panel", () => {
  it("requires explicit property selection after reconnecting", async () => {
    let selected = false;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/sites")) return Response.json({ state: "ok", sites: [{ siteUrl: "sc-domain:new.example", permissionLevel: "siteOwner" }] });
      if (init?.method === "PUT") { selected = true; return new Response(null, { status: 204 }); }
      return Response.json(status("connected", selected ? "sc-domain:new.example" : null));
    }));
    const container = await renderPanel();
    expect(container.textContent).not.toContain("성과 가져오기");
    const button = (label: string) => [...container.querySelectorAll("button")].find((item) => item.textContent === label)!;
    await act(async () => button("속성 불러오기").click());
    expect(button("선택 저장").disabled).toBe(true);
    const select = container.querySelector("select")!;
    await act(async () => { select.value = "sc-domain:new.example"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(container.textContent).not.toContain("성과 가져오기");
    await act(async () => button("선택 저장").click());
    expect(container.textContent).toContain("성과 가져오기");
  });

  it("does not announce success when remote revocation fails", async () => {
    let disconnected = false;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        disconnected = true;
        return Response.json({ error: "Google 승인 취소를 확인하지 못했습니다.", code: "GSC_REVOCATION_FAILED" }, { status: 502 });
      }
      return Response.json(status(disconnected ? "not_connected" : "connected", null, disconnected ? "GSC_REVOCATION_FAILED" : null));
    }));
    const container = await renderPanel();
    const disconnect = [...container.querySelectorAll("button")].find((item) => item.textContent?.includes("연결 해제"))!;
    await act(async () => disconnect.click());
    expect(container.textContent).toContain("로컬 연결과 저장된 토큰은 삭제");
    expect(container.textContent).not.toContain("연결을 해제하고 Google 승인을 취소했습니다.");
    expect(container.querySelector('a[href="https://myaccount.google.com/connections"]')).not.toBeNull();
  });

  it("keeps the manual revocation guidance visible on a fresh page load", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(status("not_connected", null, "GSC_REVOCATION_FAILED"))));
    const container = await renderPanel();
    expect(container.textContent).toContain("Google 승인 취소는 확인하지 못했습니다");
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });
});
