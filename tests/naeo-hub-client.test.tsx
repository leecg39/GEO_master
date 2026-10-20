/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NaeoHubClient } from "@/components/NaeoHubClient";

let root: Root | undefined;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

async function renderHub(serviceUrl: string | null, active: boolean) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
    Response.json({ subscription: { active, amountKrw: 300_000 } }),
  ));
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(<NaeoHubClient serviceUrl={serviceUrl} />));
  return container;
}

describe("NaeoHubClient subscription gate", () => {
  it("shows the SEMForge gate and hides the launch link when inactive", async () => {
    const container = await renderHub("http://127.0.0.1:3100", false);
    expect(container.textContent).toContain("SEMForge Pro 필요");
    expect(container.textContent).toContain("Naeo는 SEMForge Pro 구독에 포함된 서비스입니다");
    expect(container.querySelector('a[href="/semforge/subscription"]')).not.toBeNull();
    expect(container.querySelector('a[href="http://127.0.0.1:3100"]')).toBeNull();
    expect(container.textContent).toContain("블로그 진단");
  });

  it("opens the configured Naeo service in a new tab when active", async () => {
    const container = await renderHub("http://127.0.0.1:3100", true);
    const launch = container.querySelector('a[href="http://127.0.0.1:3100"]');
    expect(launch?.textContent).toContain("Naeo 실행하기");
    expect(launch?.getAttribute("target")).toBe("_blank");
    expect(launch?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(container.textContent).toContain("Pro 활성");
    expect(container.textContent).toContain("₩300,000");
    expect(container.querySelector('a[href="https://github.com/leecg39/Naeo"]')).not.toBeNull();
  });

  it("disables launch and explains the env var when the service URL is missing", async () => {
    const container = await renderHub(null, true);
    expect(container.querySelector('[aria-disabled="true"]')?.textContent).toContain("Naeo 실행하기");
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("NAEO_SERVICE_URL");
    expect(container.textContent).toContain("키워드·AI 인용 확인");
  });
});
