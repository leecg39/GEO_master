import type { Metadata } from "next";
import { AiSeoClient } from "@/components/AiSeoClient";

export const metadata: Metadata = { title: "AI SEO" };
export default function AiSeoPage() { return <AiSeoClient />; }
