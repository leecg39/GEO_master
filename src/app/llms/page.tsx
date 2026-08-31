import type { Metadata } from "next";
import { LlmsTxtClient } from "@/components/LlmsTxtClient";

export const metadata: Metadata = { title: "llms.txt 워크플로" };
export default function LlmsTxtPage() { return <LlmsTxtClient />; }
