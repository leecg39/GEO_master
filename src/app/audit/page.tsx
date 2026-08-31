import type { Metadata } from "next";
import { AuditClient } from "@/components/AuditClient";

export const metadata: Metadata = { title: "GEO 진단" };
export default function AuditPage() { return <AuditClient />; }
