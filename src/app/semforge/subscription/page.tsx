import type { Metadata } from "next";
import { SubscriptionClient } from "@/components/SubscriptionClient";

export const metadata: Metadata = { title: "SEMForge Pro 구독 관리" };

export default function SemforgeSubscriptionPage() {
  return <SubscriptionClient workspace />;
}
