import type { Metadata } from "next";
import { SubscriptionClient } from "@/components/SubscriptionClient";

export const metadata: Metadata = { title: "SEMForge Pro 구독" };
export default function SubscriptionPage() { return <SubscriptionClient />; }
