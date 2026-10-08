import type { Metadata } from "next";
import { SearchConsoleImportClient } from "@/components/SearchConsoleImportClient";

export const metadata: Metadata = { title: "검색 성과 가져오기" };
export default function SearchConsolePage() { return <SearchConsoleImportClient />; }
