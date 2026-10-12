import type { Metadata } from "next";
import { ChangeReportClient } from "@/components/ChangeReportClient";

export const metadata: Metadata = { title: "수정 결과 보고서" };

export default async function ChangeReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { url } = await searchParams;
  return <ChangeReportClient initialUrl={typeof url === "string" && url.trim() ? url.trim() : null} />;
}
