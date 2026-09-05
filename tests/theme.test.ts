/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_THEME,
  THEME_ATTRIBUTE,
  THEME_CHANGE_EVENT,
  THEME_STORAGE_KEY,
  applyTheme,
  isTheme,
  persistTheme,
  readDocumentTheme,
  readStoredTheme,
  resolveTheme,
  setTheme,
  themeInitScript,
  toggleTheme,
} from "@/lib/theme";

describe("theme helpers", () => {
  afterEach(() => {
    if (typeof document !== "undefined") {
      document.documentElement.removeAttribute(THEME_ATTRIBUTE);
      document.documentElement.style.colorScheme = "";
    }
  });

  it("accepts only light and dark", () => {
    expect(isTheme("light")).toBe(true);
    expect(isTheme("dark")).toBe(true);
    expect(isTheme("system")).toBe(false);
    expect(isTheme("")).toBe(false);
    expect(isTheme(null)).toBe(false);
  });

  it("defaults unknown values to dark so the current workspace look is preserved", () => {
    expect(resolveTheme(undefined)).toBe(DEFAULT_THEME);
    expect(resolveTheme("nope")).toBe("dark");
    expect(resolveTheme("light")).toBe("light");
  });

  it("toggles between dark and light", () => {
    expect(toggleTheme("dark")).toBe("light");
    expect(toggleTheme("light")).toBe("dark");
  });

  it("reads a stored theme and ignores junk", () => {
    const storage = memoryStorage({ [THEME_STORAGE_KEY]: "light" });
    expect(readStoredTheme(storage)).toBe("light");
    expect(readStoredTheme(memoryStorage({ [THEME_STORAGE_KEY]: "sepia" }))).toBe(null);
    expect(readStoredTheme(null)).toBe(null);
  });

  it("applies data-theme and color-scheme on a root element", () => {
    const root = element();
    applyTheme("light", root);
    expect(root.getAttribute(THEME_ATTRIBUTE)).toBe("light");
    expect(root.style.colorScheme).toBe("light");
  });

  it("persists the choice and setTheme updates root, storage, and a window event", () => {
    const root = element();
    const storage = memoryStorage();
    const seen: string[] = [];
    const onChange = (event: Event) => {
      seen.push((event as CustomEvent<string>).detail);
    };
    window.addEventListener(THEME_CHANGE_EVENT, onChange);

    persistTheme("light", storage);
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe("light");

    setTheme("dark", { root, storage });
    expect(root.getAttribute(THEME_ATTRIBUTE)).toBe("dark");
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(readDocumentTheme(root)).toBe("dark");
    expect(seen).toEqual(["dark"]);

    window.removeEventListener(THEME_CHANGE_EVENT, onChange);
  });

  it("emits a blocking script that restores a saved theme before paint", () => {
    const script = themeInitScript();
    expect(script.startsWith("(")).toBe(true);
    expect(script).toContain(THEME_STORAGE_KEY);
    expect(script).toContain(THEME_ATTRIBUTE);
    expect(script).toContain("localStorage");
    expect(script).toContain("colorScheme");
    expect(script).not.toContain("document.write");
  });
});

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = { ...initial };
  return {
    get length() { return Object.keys(data).length; },
    clear() { for (const key of Object.keys(data)) delete data[key]; },
    getItem(key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
    key(index) { return Object.keys(data)[index] ?? null; },
    removeItem(key) { delete data[key]; },
    setItem(key, value) { data[key] = String(value); },
  };
}

function element(): HTMLElement {
  return document.createElement("html");
}
