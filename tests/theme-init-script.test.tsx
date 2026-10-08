/** @vitest-environment jsdom */
import { runInNewContext } from "node:vm";
import { act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ThemeInitScript } from "@/components/ThemeInitScript";
import { THEME_STORAGE_KEY } from "@/lib/theme";

let root: Root | undefined;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.colorScheme = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function serverMarkup() {
  const browserWindow = window;
  vi.stubGlobal("window", undefined);
  try {
    return renderToString(<ThemeInitScript />);
  } finally {
    vi.stubGlobal("window", browserWindow);
  }
}

it.each([
  { stored: "light", blocked: false, expected: "light" },
  { stored: "dark", blocked: false, expected: "dark" },
  { stored: "invalid", blocked: false, expected: "dark" },
  { stored: null, blocked: false, expected: "dark" },
  { stored: null, blocked: true, expected: "dark" },
])("initializes $expected from server HTML (stored=$stored, blocked=$blocked)", ({ stored, blocked, expected }) => {
  const container = document.createElement("div");
  container.innerHTML = serverMarkup();
  const script = container.querySelector("script")!;
  expect(script.type).toBe("text/javascript");
  const getItem = vi.fn((key: string) => {
    expect(key).toBe(THEME_STORAGE_KEY);
    if (blocked) throw new Error("Storage unavailable");
    return stored;
  });

  runInNewContext(script.textContent!, { document, localStorage: { getItem } });

  expect(document.documentElement.dataset.theme).toBe(expected);
  expect(document.documentElement.style.colorScheme).toBe(expected);
});

it("hydrates the server script without warnings or resetting the chosen theme", async () => {
  const container = document.createElement("div");
  container.innerHTML = serverMarkup();
  document.body.append(container);
  document.documentElement.dataset.theme = "light";
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  const onRecoverableError = vi.fn();

  await act(async () => {
    root = hydrateRoot(container, <ThemeInitScript />, { onRecoverableError });
  });

  expect(onRecoverableError).not.toHaveBeenCalled();
  expect(consoleError).not.toHaveBeenCalled();
  expect(document.documentElement.dataset.theme).toBe("light");
});

it("renders an inert script on client mounts and preserves the active theme", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  document.documentElement.dataset.theme = "light";
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  root = createRoot(container);

  await act(async () => root!.render(<ThemeInitScript />));

  expect(container.querySelector("script")?.type).toBe("text/plain");
  expect(consoleError).not.toHaveBeenCalled();
  expect(document.documentElement.dataset.theme).toBe("light");
});
