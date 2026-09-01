import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Agentation } from "agentation";
import { AppShell } from "@/components/AppShell";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "GEO Master", template: "%s · GEO Master" },
  description: "응답 점유율, GEO 진단, 콘텐츠와 전략을 한곳에서 관리하는 로컬 퍼스트 워크스페이스",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ko">
      <body>
        <AppShell>{children}</AppShell>
        {process.env.NODE_ENV === "development" && <Agentation />}
      </body>
    </html>
  );
}
