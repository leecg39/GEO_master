import { DashboardView } from "@/components/DashboardView";
import { getDashboardData } from "@/lib/dashboard";
import { headers } from "next/headers";
import { withRequestAccount } from "@/lib/request-account";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const data = withRequestAccount(await headers(), getDashboardData);
  return <DashboardView data={data} />;
}
