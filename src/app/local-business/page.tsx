import type { Metadata } from "next";
import { LocalBusinessClient } from "@/components/LocalBusinessClient";

export const metadata: Metadata = { title: "지역 SEO" };
export default function LocalBusinessPage() { return <LocalBusinessClient />; }
