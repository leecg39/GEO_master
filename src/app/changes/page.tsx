import type { Metadata } from "next";
import { ChangeItemsClient } from "@/components/ChangeItemsClient";

export const metadata: Metadata = { title: "수정안 작업대" };
export default function ChangesPage() { return <ChangeItemsClient />; }
