import { DashboardView } from "@/components/DashboardView";
import { getDashboardData } from "@/lib/dashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function DashboardPage() {
  return <DashboardView data={getDashboardData()} />;
}
