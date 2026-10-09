import type { Metadata } from "next";
import { OutcomesClient } from "@/components/OutcomesClient";

export const metadata: Metadata = { title: "사업 성과" };
export default function OutcomesPage() { return <OutcomesClient />; }
