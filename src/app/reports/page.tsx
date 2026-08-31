import type { Metadata } from "next";
import { ReportsClient } from "@/components/ReportsClient";

export const metadata: Metadata = { title: "리포트 내보내기" };
export default function ReportsPage() { return <ReportsClient />; }
