/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WordpressConnectionPanel } from "@/components/WordpressConnectionPanel";

let root: Root | null = null;
const SECRET = "abcd EFGH ijkl MNOP";
const connected = { siteUrl: "https://wp.example", username: "admin", seoPlugin: "yoast", allowSeoPluginWrites: false, passwordStored: true, verifiedAt: "2026-10-13T00:00:00Z", updatedAt: "2026-10-13T00:00:00Z" };

beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; document.body.replaceChildren(); vi.unstubAllGlobals(); });

async function mount() {
  const container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<WordpressConnectionPanel />));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  return container;
}
function type(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

it("shows the detected plugin and never renders the password after saving", async () => {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => Response.json({ connection: init?.method === "PUT" ? connected : null }));
  vi.stubGlobal("fetch", fetchMock);
  const container = await mount();
  expect(container.textContent).toContain("연결 안 됨");
  await act(async () => { container.querySelector<HTMLButtonElement>("button")!.click(); });
  const inputs = container.querySelectorAll<HTMLInputElement>("form input");
  expect(inputs[2]!.type).toBe("password");
  await act(async () => { type(inputs[0]!, "https://wp.example"); type(inputs[1]!, "admin"); type(inputs[2]!, SECRET); });
  await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT")!;
  expect(JSON.parse(String(put[1]!.body))).toMatchObject({ siteUrl: "https://wp.example", username: "admin", applicationPassword: SECRET, allowSeoPluginWrites: false });
  expect(container.textContent).toContain("Yoast SEO");
  expect(container.innerHTML).not.toContain(SECRET);
  expect(container.querySelector("form")).toBeNull();
});
