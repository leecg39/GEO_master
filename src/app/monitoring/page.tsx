import { Suspense } from "react";
import { headers } from "next/headers";
import { MonitoringClient } from "@/components/monitoring/MonitoringClient";
import { requireActiveProject } from "@/lib/projects";
import { getRequestAccount, withRequestAccount } from "@/lib/request-account";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function MonitoringPage() {
  const context = withRequestAccount(await headers(), () => ({ project: requireActiveProject(), canConfigure: getRequestAccount().role !== "guest" }));
  return <Suspense fallback={<p role="status">모니터링 화면을 불러오는 중입니다.</p>}>
    <MonitoringClient key={`${context.project.id}:${context.project.updatedAt}`} projectId={context.project.id} canConfigure={context.canConfigure} />
  </Suspense>;
}
