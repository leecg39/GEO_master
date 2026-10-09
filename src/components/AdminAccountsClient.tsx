"use client";

import { useState } from "react";
import { LoaderCircle, RotateCcw, ShieldAlert, UserCheck, UserX } from "lucide-react";
import type { AdminAccountView } from "@/lib/accounts/admin";
import type { SignupMode } from "@/lib/accounts/signup";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui";

type AccountStatus = AdminAccountView["status"];

const STATUS_LABEL: Record<AccountStatus, string> = { pending: "승인 대기", active: "이용 중", disabled: "이용 중지" };
const STATUS_TONE = { pending: "warn", active: "good", disabled: "bad" } as const;
const PLAN_LABEL = { free: "무료 · GEO 측정", semforge: "SEMForge Pro" } as const;
const MODE_LABEL: Record<SignupMode, string> = { approval: "관리자 승인 후 이용", auto: "가입 즉시 이용", closed: "신규 가입 중단" };
// 서버(Node ICU)와 브라우저의 한국어 오전/오후 표기가 달라 하이드레이션이 어긋나므로 숫자 부분만 조합한다.
const dateParts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function formatSeoulTime(iso: string) {
  const part = Object.fromEntries(dateParts.formatToParts(new Date(iso)).map(({ type, value }) => [type, value]));
  return `${part.year}-${part.month}-${part.day} ${part.hour}:${part.minute}`;
}

function summarize(accounts: AdminAccountView[]) {
  return [
    { label: "승인 대기", value: accounts.filter((account) => account.status === "pending").length },
    { label: "이용 중", value: accounts.filter((account) => account.status === "active").length },
    { label: "무료 · GEO 측정 가입", value: accounts.filter((account) => account.plan === "free").length },
    { label: "SEMForge Pro 가입 (결제 완료)", value: `${accounts.filter((account) => account.plan === "semforge").length} (${accounts.filter((account) => account.semforge.active).length})` },
  ];
}

function Actions({ account, busy, onChange }: { account: AdminAccountView; busy: boolean; onChange: (status: AccountStatus) => void }) {
  if (busy) return <LoaderCircle className="h-5 w-5 animate-spin text-[color:var(--color-accent-lime)]" aria-label="처리 중" />;
  if (account.status === "pending") {
    return (
      <div className="flex flex-wrap gap-2">
        <Button className="min-h-9 px-3 py-2 text-xs" onClick={() => onChange("active")}><UserCheck className="h-4 w-4" />승인</Button>
        <Button variant="danger" className="min-h-9 px-3 py-2 text-xs" onClick={() => onChange("disabled")}><UserX className="h-4 w-4" />거절</Button>
      </div>
    );
  }
  if (account.status === "active") {
    return <Button variant="danger" className="min-h-9 px-3 py-2 text-xs" onClick={() => onChange("disabled")}><UserX className="h-4 w-4" />이용 중지</Button>;
  }
  return <Button variant="secondary" className="min-h-9 px-3 py-2 text-xs" onClick={() => onChange("active")}><RotateCcw className="h-4 w-4" />다시 활성화</Button>;
}

function AccountRow({ account, busy, onChange }: { account: AdminAccountView; busy: boolean; onChange: (status: AccountStatus) => void }) {
  return (
    <tr className="border-t border-[color:var(--app-card-border)] align-top">
      <td className="py-3 pr-4"><p className="font-semibold text-white">{account.displayName}</p><p className="text-xs text-[color:var(--color-on-dark-muted)]">{account.loginId}</p></td>
      <td className="py-3 pr-4"><Badge tone={account.plan === "semforge" ? "cyan" : "default"}>{PLAN_LABEL[account.plan]}</Badge></td>
      <td className="py-3 pr-4 text-xs">{account.semforge.active ? <Badge tone="good">결제 완료</Badge> : <span className="text-[color:var(--color-on-dark-muted)]">미결제</span>}</td>
      <td className="py-3 pr-4"><Badge tone={STATUS_TONE[account.status]}>{STATUS_LABEL[account.status]}</Badge></td>
      <td className="py-3 pr-4 text-xs text-[color:var(--color-on-dark-muted)]"><time dateTime={account.createdAt}>{formatSeoulTime(account.createdAt)}</time></td>
      <td className="py-3"><Actions account={account} busy={busy} onChange={onChange} /></td>
    </tr>
  );
}

export function AdminAccountsClient({ initialAccounts, signupMode }: { initialAccounts: AdminAccountView[]; signupMode: SignupMode }) {
  const [accounts, setAccounts] = useState(initialAccounts);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function changeStatus(account: AdminAccountView, status: AccountStatus) {
    setBusyId(account.id); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/admin/accounts/${account.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) });
      const body = await response.json() as { account?: AdminAccountView; error?: string };
      if (!response.ok || !body.account) throw new Error(body.error ?? "계정 상태를 바꾸지 못했습니다.");
      const updated = body.account;
      setAccounts((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setMessage(`${updated.loginId} 계정을 '${STATUS_LABEL[updated.status]}' 상태로 바꿨습니다.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "계정 상태를 바꾸지 못했습니다.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <PageHeader eyebrow="관리자" title="회원 관리" description="회원가입 신청을 승인하고 계정 이용 상태를 관리합니다. 가입 유형으로 무료(GEO 측정) 회원과 SEMForge Pro(유료) 회원을 구분하며, SEMForge 기능은 결제가 확인된 계정에만 열립니다." />
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {summarize(accounts).map(({ label, value }) => (
          <Card key={label} className="p-4"><p className="text-xs text-[color:var(--color-on-dark-muted)]">{label}</p><p className="mt-1 font-display text-2xl text-white">{value}</p></Card>
        ))}
      </div>
      <Card className="mb-5 flex gap-3 p-4 text-sm leading-6 text-[color:var(--color-on-dark-muted)]">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" aria-hidden="true" />
        <p>가입 방식: <strong className="text-white">{MODE_LABEL[signupMode]}</strong> (<code>GEO_SIGNUP_MODE</code>). 승인된 회원은 운영 계정과 같은 워크스페이스(프로젝트·측정 데이터)를 함께 사용합니다. 설정(API 키)과 워크스페이스 백업·복원, 회원 관리는 회원에게 열리지 않습니다.</p>
      </Card>
      {message && <p role="status" className="mb-4 rounded-xl border border-[color:var(--color-accent-lime)]/25 bg-[color:var(--color-accent-lime)]/10 p-3 text-sm text-[color:var(--app-status-good)]">{message}</p>}
      {error && <p role="alert" className="mb-4 rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-300">{error}</p>}
      {accounts.length === 0 ? (
        <EmptyState>아직 회원가입 신청이 없습니다. 소개 화면의 ‘무료로 시작하기’ 또는 /signup에서 가입할 수 있습니다.</EmptyState>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <caption className="sr-only">회원 목록</caption>
            <thead className="text-xs text-[color:var(--color-on-dark-muted)]">
              <tr><th scope="col" className="pb-3 pr-4 font-medium">회원</th><th scope="col" className="pb-3 pr-4 font-medium">가입 유형</th><th scope="col" className="pb-3 pr-4 font-medium">SEMForge 결제</th><th scope="col" className="pb-3 pr-4 font-medium">상태</th><th scope="col" className="pb-3 pr-4 font-medium">가입일</th><th scope="col" className="pb-3 font-medium">관리</th></tr>
            </thead>
            <tbody>
              {accounts.map((account) => <AccountRow key={account.id} account={account} busy={busyId === account.id} onChange={(status) => void changeStatus(account, status)} />)}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
