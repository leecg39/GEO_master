import type { Metadata } from "next";
import { FactsClient } from "@/components/FactsClient";

export const metadata: Metadata = { title: "사실 메모" };
export default function FactsPage() { return <FactsClient />; }
