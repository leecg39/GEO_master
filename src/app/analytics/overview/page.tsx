import type { Metadata } from "next";
import { AnalyticsOverviewClient } from "@/components/AnalyticsOverviewClient";

export const metadata: Metadata = { title: "도메인 개요" };
export default function AnalyticsOverviewPage() { return <AnalyticsOverviewClient />; }
