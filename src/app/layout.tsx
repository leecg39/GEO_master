import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Rubik, Space_Grotesk } from "next/font/google";
import Script from "next/script";
import { Agentation } from "agentation";
import { AppShell } from "@/components/AppShell";
import { DEFAULT_THEME, themeInitScript } from "@/lib/theme";
import "./globals.css";

const rubik = Rubik({
  subsets: ["latin"],
  variable: "--font-rubik",
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display-face",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "GEO Master", template: "%s · GEO Master" },
  description: "응답 점유율, GEO 진단, 콘텐츠와 전략을 한곳에서 관리하는 로컬 퍼스트 워크스페이스",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ko" data-theme={DEFAULT_THEME} className={`${rubik.variable} ${spaceGrotesk.variable}`} suppressHydrationWarning>
      <body>
        <Script id="geo-master-theme-init" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: themeInitScript() }} />
        <AppShell>{children}</AppShell>
        {process.env.NODE_ENV === "development" && <Agentation />}
      </body>
    </html>
  );
}
