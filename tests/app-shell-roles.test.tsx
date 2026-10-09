/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminAccountsClient } from "@/components/AdminAccountsClient";
import { AppShell } from "@/components/AppShell";
import type { AdminAccountView } from "@/lib/accounts/admin";
import type { RequestAccount } from "@/lib/request-account";

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

async function render(node: React.ReactNode) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(node));
  return container;
}

function shell(account: RequestAccount, active = false) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ subscription: { active } })));
  return render(<AppShell account={account}>QA</AppShell>);
}

const pending: AdminAccountView = {
  id: 7, loginId: "pro@example.com", displayName: "프로 회원", plan: "semforge", status: "pending",
  consentedAt: "2026-10-09T00:00:00.000Z", approvedAt: null, approvedBy: null,
  createdAt: "2026-10-09T00:00:00.000Z", updatedAt: "2026-10-09T00:00:00.000Z", semforge: { active: false, status: "inactive" },
};

describe("role-aware navigation", () => {
  it("keeps self-registered members away from operator settings and backups", async () => {
    const container = await shell({ id: "member@example.com", role: "customer" });
    for (const href of ["/settings", "/workspace", "/admin/accounts"]) expect(container.querySelector(`a[href="${href}"]`)).toBeNull();
    for (const href of ["/audit", "/share", "/search-console", "/subscription"]) expect(container.querySelector(`a[href="${href}"]`)).not.toBeNull();
    expect(container.textContent).toContain("member@example.com · 무료 · GEO 측정");
  });

  it("labels paid members as SEMForge Pro", async () => {
    const container = await shell({ id: "pro@example.com", role: "customer" }, true);
    expect(container.textContent).toContain("pro@example.com · SEMForge Pro");
  });

  it("shows member administration only to administrators", async () => {
    const admin = await shell({ id: "owner@example.com", role: "admin" }, true);
    expect(admin.querySelector('a[href="/admin/accounts"]')?.textContent).toBe("회원 관리");
    expect(admin.querySelector('a[href="/settings"]')).not.toBeNull();
    expect(admin.textContent).toContain("owner@example.com · 관리자");
    await act(async () => root?.unmount());
    root = undefined;
    const member = await shell({ id: "team", role: "member" });
    expect(member.querySelector('a[href="/admin/accounts"]')).toBeNull();
    expect(member.querySelector('a[href="/settings"]')).not.toBeNull();
  });
});

describe("member administration screen", () => {
  it("approves a pending SEMForge sign-up and reflects the new status", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ account: { ...pending, status: "active", approvedBy: "owner@example.com" } }));
    const container = await render(<AdminAccountsClient initialAccounts={[pending]} signupMode="approval" />);
    vi.stubGlobal("fetch", fetcher);
    expect(container.textContent).toContain("SEMForge Pro");
    expect(container.textContent).toContain("승인 대기");
    expect(container.textContent).toContain("관리자 승인 후 이용");
    const approve = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("승인"))!;
    await act(async () => approve.click());
    expect(fetcher).toHaveBeenCalledWith("/api/admin/accounts/7", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ status: "active" }) }));
    expect(container.querySelector("tbody")?.textContent).toContain("이용 중");
    expect(container.querySelector('[role="status"]')?.textContent).toContain("pro@example.com");
    expect([...container.querySelectorAll("button")].some((button) => button.textContent?.includes("이용 중지"))).toBe(true);
  });

  it("keeps the row unchanged and shows the server error when an update fails", async () => {
    const container = await render(<AdminAccountsClient initialAccounts={[pending]} signupMode="auto" />);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "관리자만 회원을 관리할 수 있습니다." }, { status: 403 })));
    const reject = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("거절"))!;
    await act(async () => reject.click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("관리자만");
    expect(container.querySelector("tbody")?.textContent).toContain("승인 대기");
  });

  it("renders sign-up times identically on server and browser (KST digits only)", async () => {
    const container = await render(<AdminAccountsClient initialAccounts={[{ ...pending, createdAt: "2026-10-08T15:30:00.000Z" }]} signupMode="approval" />);
    const time = container.querySelector("tbody time");
    expect(time?.textContent).toBe("2026-10-09 00:30");
    expect(time?.getAttribute("datetime")).toBe("2026-10-08T15:30:00.000Z");
  });

  it("explains how to receive sign-ups when the list is empty", async () => {
    const container = await render(<AdminAccountsClient initialAccounts={[]} signupMode="closed" />);
    expect(container.textContent).toContain("아직 회원가입 신청이 없습니다");
    expect(container.textContent).toContain("신규 가입 중단");
  });
});
