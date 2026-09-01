import type { Metadata } from "next";
import { PositionTrackingClient } from "@/components/PositionTrackingClient";

export const metadata: Metadata = { title: "포지션 추적" };
export default function PositionTrackingPage() { return <PositionTrackingClient />; }
