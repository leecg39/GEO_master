"use client";

import { Moon, Sun } from "lucide-react";
import { useCallback, useSyncExternalStore } from "react";
import {
  DEFAULT_THEME,
  THEME_CHANGE_EVENT,
  type Theme,
  readDocumentTheme,
  setTheme,
  toggleTheme,
} from "@/lib/theme";

function subscribe(onStoreChange: () => void) {
  window.addEventListener(THEME_CHANGE_EVENT, onStoreChange);
  return () => window.removeEventListener(THEME_CHANGE_EVENT, onStoreChange);
}

function getSnapshot(): Theme {
  return readDocumentTheme(document.documentElement);
}

function getServerSnapshot(): Theme {
  return DEFAULT_THEME;
}

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const theme = useSyncExternalStore<Theme>(subscribe, getSnapshot, getServerSnapshot);
  const onToggle = useCallback(() => setTheme(toggleTheme(theme)), [theme]);
  const light = theme === "light";
  const label = light ? "라이트 모드" : "다크 모드";

  if (compact) {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={light}
        aria-label={light ? "다크 모드로 전환" : "라이트 모드로 전환"}
        suppressHydrationWarning
        onClick={onToggle}
        className="grid h-11 w-11 cursor-pointer place-items-center rounded-[8px] text-white transition hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-[color:var(--color-ring-focus)]"
      >
        {light ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
      </button>
    );
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={light}
      aria-label="라이트 모드"
      suppressHydrationWarning
      onClick={onToggle}
      className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 rounded-[12px] px-3 py-2 text-sm font-medium text-[color:var(--color-on-dark-muted)] transition hover:bg-white/5 hover:text-white focus:outline-none focus:ring-2 focus:ring-[color:var(--color-ring-focus)]"
    >
      <span className="flex items-center gap-3">
        {light ? <Sun className="h-4.5 w-4.5 text-amber-300" /> : <Moon className="h-4.5 w-4.5 text-[color:var(--color-accent-lime)]" />}
        {label}
      </span>
      <span
        aria-hidden="true"
        data-theme-track
        className="relative h-6 w-11 shrink-0 rounded-full border border-[color:var(--color-hairline-violet)] bg-[color:var(--color-ink-deep)] transition-colors duration-200"
      >
        <span data-theme-thumb className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full border border-black/10 bg-white shadow-sm motion-reduce:transition-none" />
      </span>
    </button>
  );
}
