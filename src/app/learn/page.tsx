import type { Metadata } from "next";
import { LearnClient } from "@/components/LearnClient";

export const metadata: Metadata = { title: "학습 센터" };
export default function LearnPage() { return <LearnClient />; }
