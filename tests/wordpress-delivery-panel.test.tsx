/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WordpressDeliveryPanel } from "@/components/WordpressDeliveryPanel";

let root: Root | null = null;
const preview = { site: "https://wp.example", postId: 4, postType: "post", metaKey: "_yoast_wpseo_title", storedValue: "", publicValue: "Original Title - GEO Spike", proposedValue: "<b>새 제목</b>", previewToken: "a".repeat(64) };

beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; document.body.replaceChildren(); vi.unstubAllGlobals(); });

async function mount(onDone: () => void) {
  const container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<WordpressDeliveryPanel changeId={7} onDone={onDone} />));
  return container;
}
const click = async (container: HTMLElement, label: string) => {
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent?.includes(label))!;
  await act(async () => { button.click(); });
};

it("shows the target and values before writing, then writes with the preview token", async () => {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => Response.json(JSON.parse(String(init?.body)).action === "preview" ? { preview } : { item: { status: "delivered" } }));
  vi.stubGlobal("fetch", fetchMock);
  const onDone = vi.fn();
  const container = await mount(onDone);
  await click(container, "미리보기");
  expect(container.textContent).toContain("post #4 · _yoast_wpseo_title");
  expect(container.textContent).toContain("플러그인 기본 템플릿");
  expect(container.querySelector("b")).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await click(container, "쓰기 실행");
  expect(JSON.parse(String(fetchMock.mock.calls[1]![1]!.body))).toEqual({ action: "execute", previewToken: preview.previewToken });
  expect(onDone).toHaveBeenCalled();
});

it("shows the server's reason when the write is refused", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "WordPress 연결에서 'SEO 플러그인 메타 쓰기'를 허용해야 합니다." }, { status: 409 })));
  const container = await mount(vi.fn());
  await click(container, "미리보기");
  expect(container.querySelector("[role=alert]")?.textContent).toContain("허용해야 합니다");
});
