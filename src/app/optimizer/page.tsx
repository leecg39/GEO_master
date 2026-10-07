import type { Metadata } from "next";
import { OptimizerClient } from "@/components/OptimizerClient";

export const metadata: Metadata = { title: "콘텐츠 최적화 랩" };
export default function OptimizerPage() { return <OptimizerClient />; }
