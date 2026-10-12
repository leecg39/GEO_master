/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RuleDocLink } from "@/components/RuleDocLink";

let root: Root | null = null;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); });
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

async function mount(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(node));
  return container;
}

it("links to the rule's documentation in a new tab without opener access", async () => {
  const container = await mount(<RuleDocLink code="seo-canonical" />);
  const link = container.querySelector("a");
  expect(link?.getAttribute("href")).toBe("https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls");
  expect(link?.getAttribute("target")).toBe("_blank");
  expect(link?.getAttribute("rel")).toContain("noopener");
  expect(link?.getAttribute("rel")).toContain("noreferrer");
  expect(link?.textContent).toContain("Google 검색 센터");
});

it("shows the caution note when the rule has one", async () => {
  const container = await mount(<RuleDocLink code="tech-faq-schema" />);
  expect(container.textContent).toMatch(/FAQ 리치 결과를 표시하지 않습니다/);
});

it("renders nothing for codes without documentation", async () => {
  const container = await mount(<RuleDocLink code="brand-definition" />);
  expect(container.innerHTML).toBe("");
});
