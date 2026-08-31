import type { Metadata } from "next";
import { StrategyClient } from "@/components/StrategyClient";

export const metadata: Metadata = { title: "전략 워크스페이스" };
export default function StrategyPage() { return <StrategyClient />; }
