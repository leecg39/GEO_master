import type { Metadata } from "next";
import { BotLogClient } from "@/components/BotLogClient";

export const metadata: Metadata = { title: "AI 봇 방문 로그" };
export default function BotLogsPage() { return <BotLogClient />; }
