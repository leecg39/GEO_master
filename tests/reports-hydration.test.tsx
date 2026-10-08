/** @vitest-environment jsdom */
import { act } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ReportsClient } from "@/components/ReportsClient";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });
it("hydrates without depending on the server locale or render time", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(url.includes("audits") ? { audits: [] } : url.includes("presets") ? { items: [] } : { runs: [] })));
  const clock = vi.spyOn(Date.prototype, "toLocaleString").mockReturnValue("server PM 1:00");
  const container = document.createElement("div");
  container.innerHTML = renderToString(<ReportsClient />);
  expect(clock).not.toHaveBeenCalled();
  document.body.append(container);
  clock.mockReturnValue("브라우저 오후 1:01");
  const recoverable = vi.fn();
  let root!: ReturnType<typeof hydrateRoot>;
  await act(async () => { root = hydrateRoot(container, <ReportsClient />, { onRecoverableError: recoverable }); });
  expect(recoverable).not.toHaveBeenCalled();
  expect(container.querySelector("footer")?.textContent).toContain("브라우저 오후 1:01");
  await act(async () => root.unmount());
});
