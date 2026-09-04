import type { Metadata } from "next";
import { GeoBlocksClient } from "@/components/GeoBlocksClient";

export const metadata: Metadata = { title: "GEO Blocks" };
export default function GeoBlocksPage() {
  return <GeoBlocksClient />;
}
