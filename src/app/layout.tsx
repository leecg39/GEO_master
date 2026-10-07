import { headers } from "next/headers";
import { withRequestAccount, getRequestAccount } from "@/lib/request-account";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Rubik, Space_Grotesk } from "next/font/google";
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
  metadataBase: new URL("https://geo.soverin.cloud"),
  title: { default: "GEO Master", template: "%s · GEO Master" },
  description: "AI 검색 속 브랜드의 존재감을 높이세요. GEO 진단, 응답 점유율 분석, 콘텐츠 전략을 한곳에서 관리합니다.",
  openGraph: {
    type: "website",
    locale: "ko_KR",
    url: "https://geo.soverin.cloud/",
    siteName: "GEO Master",
    title: "GEO Master | AI 검색 최적화 워크스페이스",
    description: "AI 검색 속 브랜드의 존재감을 높이세요. GEO 진단, 응답 점유율 분석, 콘텐츠 전략을 한곳에서 관리합니다.",
    images: [{
      url: "/og/geo-master-20261007.jpg",
      width: 1200,
      height: 630,
      type: "image/jpeg",
      alt: "GEO Master — AI 검색 속, 브랜드의 존재감을 높이다",
    }],
  },
  twitter: {
    card: "summary_large_image",
    title: "GEO Master | AI 검색 최적화 워크스페이스",
    description: "AI 검색 속 브랜드의 존재감을 높이세요. GEO 진단, 응답 점유율 분석, 콘텐츠 전략을 한곳에서 관리합니다.",
    images: [{
      url: "/og/geo-master-thumbnail-20261007.jpg",
      alt: "GEO Master — AI 검색, 브랜드가 답이 되다",
    }],
  },
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const account = withRequestAccount(await headers(), getRequestAccount);
  return (
    <html lang="ko" data-theme={DEFAULT_THEME} className={`${rubik.variable} ${spaceGrotesk.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript() }} />
      </head>
      <body>
        <AppShell account={account}>{children}</AppShell>
        {process.env.NODE_ENV === "development" && <Agentation />}
      </body>
    </html>
  );
}
