import type { Metadata } from "next";
import { headers } from "next/headers";
import { AdminAccountsClient } from "@/components/AdminAccountsClient";
import { Card, PageHeader } from "@/components/ui";
import { listAdminAccounts } from "@/lib/accounts/admin";
import { signupMode } from "@/lib/accounts/signup";
import { getRequestAccount, withRequestAccount } from "@/lib/request-account";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "회원 관리" };

export default async function AdminAccountsPage() {
  // 프록시가 관리자 외 접근을 403으로 막지만, 로그인 없는 local 모드 등을 위해 화면에서도 다시 확인한다.
  const accounts = withRequestAccount(await headers(), () => (getRequestAccount().role === "admin" ? listAdminAccounts() : null));
  if (!accounts) {
    return (
      <div>
        <PageHeader eyebrow="관리자" title="회원 관리" description="관리자 계정만 회원가입 신청을 승인하고 계정을 관리할 수 있습니다." />
        <Card><p className="text-sm text-[color:var(--color-on-dark-muted)]">.env의 GEO_ADMIN_ID·GEO_ADMIN_PASSWORD로 지정한 관리자 계정으로 로그인해 주세요.</p></Card>
      </div>
    );
  }
  return <AdminAccountsClient initialAccounts={accounts} signupMode={signupMode()} />;
}
