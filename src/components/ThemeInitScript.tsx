"use client";

import { themeInitScript } from "@/lib/theme";

export function ThemeInitScript() {
  return (
    <script
      // Execute before first paint in server HTML; client renders only carry data.
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: themeInitScript() }}
    />
  );
}
