import type { Metadata } from "next";
import { WorkspaceClient } from "@/components/WorkspaceClient";

export const metadata: Metadata = { title: "팀 공유 스냅샷" };
export default function WorkspacePage() { return <WorkspaceClient />; }
