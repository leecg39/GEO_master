import type { Metadata } from "next";
import { SearchPerformanceClient } from "@/components/SearchPerformanceClient";

export const metadata: Metadata = { title: "검색 성과" };
export default function SearchPerformancePage() { return <SearchPerformanceClient />; }
