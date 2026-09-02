import type { Metadata } from "next";
import { SemforgeHubClient } from "@/components/SemforgeHubClient";

export const metadata: Metadata = { title: "SEMForge" };

export default function SemforgePage() {
  return <SemforgeHubClient />;
}
