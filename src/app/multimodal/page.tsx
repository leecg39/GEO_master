import type { Metadata } from "next";
import { MultimodalClient } from "@/components/MultimodalClient";

export const metadata: Metadata = { title: "이미지·영상 일괄 감사" };
export default function MultimodalPage() { return <MultimodalClient />; }
