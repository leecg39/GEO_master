import { DashboardView } from "@/components/DashboardView";
import { SearchConsoleDashboardCard } from "@/components/SearchConsoleDashboardCard";
import { getDashboardData } from "@/lib/dashboard";
import { headers } from "next/headers";
import { getRequestAccount, withRequestAccount } from "@/lib/request-account";
import { listConsoleImports } from "@/lib/search-console/store";
import { summarizeConsoleImports } from "@/lib/search-console/summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const requestHeaders = await headers();
  const data = withRequestAccount(requestHeaders, getDashboardData);
  // 게스트는 검색 성과 화면에 접근할 수 없으므로 대시보드에서도 요약을 보여 주지 않는다
  const searchConsole = withRequestAccount(requestHeaders, () =>
    getRequestAccount().role === "guest" ? null : summarizeConsoleImports(listConsoleImports()));
  return (
    <>
      <DashboardView data={data} />
      {searchConsole && <SearchConsoleDashboardCard summary={searchConsole} />}
    </>
  );
}
