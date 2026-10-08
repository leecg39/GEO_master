import type { Metadata } from "next";
import { StructuredDataClient } from "@/components/StructuredDataClient";

export const metadata: Metadata = { title: "구조화 데이터 생성기" };
export default function StructuredDataPage() { return <StructuredDataClient />; }
