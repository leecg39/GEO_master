import type { Metadata } from "next";
import { AutomationClient } from "@/components/AutomationClient";

export const metadata: Metadata = { title: "예약 측정 자동화" };
export default function AutomationPage() { return <AutomationClient />; }
