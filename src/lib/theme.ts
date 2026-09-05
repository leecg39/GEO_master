export const THEME_STORAGE_KEY = "geo-master-theme";
export const THEME_ATTRIBUTE = "data-theme";
export const THEME_CHANGE_EVENT = "geo-master:theme-change";

export type Theme = "light" | "dark";
export const DEFAULT_THEME: Theme = "dark";

export function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}

export function resolveTheme(value: unknown): Theme {
  return isTheme(value) ? value : DEFAULT_THEME;
}

export function toggleTheme(theme: Theme): Theme {
  return theme === "dark" ? "light" : "dark";
}

export function readStoredTheme(storage: Pick<Storage, "getItem"> | null | undefined): Theme | null {
  if (!storage) return null;
  try {
    const value = storage.getItem(THEME_STORAGE_KEY);
    return isTheme(value) ? value : null;
  } catch {
    return null;
  }
}

export function persistTheme(theme: Theme, storage: Pick<Storage, "setItem">): void {
  storage.setItem(THEME_STORAGE_KEY, theme);
}

export function applyTheme(theme: Theme, root: HTMLElement): void {
  root.setAttribute(THEME_ATTRIBUTE, theme);
  root.style.colorScheme = theme;
}

export function readDocumentTheme(root: HTMLElement | null | undefined): Theme {
  return resolveTheme(root?.getAttribute(THEME_ATTRIBUTE));
}

export function setTheme(theme: Theme, options?: {
  root?: HTMLElement | null;
  storage?: Pick<Storage, "setItem"> | null;
}): void {
  const root = options?.root === undefined
    ? (typeof document === "undefined" ? null : document.documentElement)
    : options.root;
  if (root) applyTheme(theme, root);

  const storage = options?.storage === undefined
    ? (typeof localStorage === "undefined" ? null : localStorage)
    : options.storage;
  if (storage) persistTheme(theme, storage);

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<Theme>(THEME_CHANGE_EVENT, { detail: theme }));
  }
}

export function themeInitScript(): string {
  const key = JSON.stringify(THEME_STORAGE_KEY);
  const attr = JSON.stringify(THEME_ATTRIBUTE);
  const fallback = JSON.stringify(DEFAULT_THEME);
  return `(function(){try{var t=localStorage.getItem(${key});if(t!=="light"&&t!=="dark")t=${fallback};var r=document.documentElement;r.setAttribute(${attr},t);r.style.colorScheme=t;}catch(e){var d=document.documentElement;d.setAttribute(${attr},${fallback});d.style.colorScheme=${fallback};}})();`;
}
