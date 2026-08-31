import type { Metadata } from "next";
import { SettingsClient } from "@/components/SettingsClient";

export const metadata: Metadata = { title: "설정" };
export default function SettingsPage() { return <SettingsClient />; }
