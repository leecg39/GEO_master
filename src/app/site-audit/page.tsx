import type { Metadata } from "next";
import { SiteAuditClient } from "@/components/SiteAuditClient";

export const metadata: Metadata = { title: "사이트 진단" };
export default function SiteAuditPage() { return <SiteAuditClient />; }
