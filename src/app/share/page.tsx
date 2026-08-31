import type { Metadata } from "next";
import { ShareClient } from "@/components/ShareClient";

export const metadata: Metadata = { title: "응답 점유율" };
export default function SharePage() { return <ShareClient />; }
