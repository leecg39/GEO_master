import type { Metadata } from "next";
import { StudioClient } from "@/components/StudioClient";

export const metadata: Metadata = { title: "콘텐츠 스튜디오" };
export default function StudioPage() { return <StudioClient />; }
