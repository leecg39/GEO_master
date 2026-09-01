"use client";

import { FormEvent, useEffect, useState } from "react";
import { CheckCircle2, CreditCard, LoaderCircle, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { Badge, Button, Card, PageHeader } from "@/components/ui";

interface SubscriptionState {
  status: string;
  active: boolean;
  amountKrw: number;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  daysRemaining: number | null;
  features: string[];
}

interface CheckoutState {
  orderId: string;
  amountKrw: number;
  devConfirmToken?: string;
}

async function parse<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "요청에 실패했습니다.");
  return body;
}

export function SubscriptionClient() {
  const [subscription, setSubscription] = useState<SubscriptionState | null>(null);
  const [checkout, setCheckout] = useState<CheckoutState | null>(null);
  const [confirmToken, setConfirmToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const data = await parse<{ subscription: SubscriptionState }>(await fetch("/api/semforge/subscription"));
        if (!active) return;
        setSubscription(data.subscription);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "불러오기 실패");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  async function startCheckout() {
    setBusy(true); setError(""); setMessage("");
    try {
      const data = await parse<{ checkout: CheckoutState }>(await fetch("/api/semforge/subscription/checkout", { method: "POST" }));
      setCheckout(data.checkout);
      if (data.checkout.devConfirmToken) setConfirmToken(data.checkout.devConfirmToken);
      setMessage("결제 요청이 생성되었습니다. 개발 모드에서는 아래 토큰으로 구독을 활성화할 수 있습니다.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "결제 시작 실패"); }
    finally { setBusy(false); }
  }

  async function confirmPayment(event: FormEvent) {
    event.preventDefault();
    if (!checkout) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const data = await parse<{ subscription: SubscriptionState }>(await fetch("/api/semforge/subscription/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId: checkout.orderId, confirmToken }),
      }));
      setSubscription(data.subscription);
      setCheckout(null);
      setMessage("SEMForge Pro 구독이 활성화되었습니다. AI SEO·사이트 진단·포지션 추적을 사용할 수 있습니다.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "결제 확인 실패"); }
    finally { setBusy(false); }
  }

  if (loading) return <div className="grid min-h-96 place-items-center"><LoaderCircle className="h-7 w-7 animate-spin text-cyan-400" /></div>;

  return (
    <div>
      <PageHeader
        eyebrow="SEMForge Pro"
        title="GEO 실행 구독"
        description="GEO Master에서 분석한 인사이트를 TalorData·Firecrawl·GSC·GBP 기반 SEMForge 실행 기능으로 이어갑니다. 월 300,000원(VAT 별도) 구독 시 AI SEO, 사이트 진단, 포지션 추적, 도메인·지역 SEO API를 사용할 수 있습니다."
      />
      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <div className="mb-4 flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-cyan-400/10"><ShieldCheck className="h-5 w-5 text-cyan-300" /></span>
            <div>
              <h2 className="font-semibold text-white">현재 구독</h2>
              <p className="text-xs text-slate-500">로컬 SQLite에 저장 · 단일 워크스페이스</p>
            </div>
          </div>
          {subscription && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={subscription.active ? "good" : "warn"}>{subscription.active ? "활성" : subscription.status}</Badge>
                <span className="text-2xl font-semibold text-white">₩{subscription.amountKrw.toLocaleString("ko-KR")}<span className="text-sm font-normal text-slate-500">/월</span></span>
              </div>
              {subscription.active && subscription.currentPeriodEnd && (
                <p className="mt-3 text-sm text-slate-400">만료: {new Date(subscription.currentPeriodEnd).toLocaleString("ko-KR")} ({subscription.daysRemaining ?? 0}일 남음)</p>
              )}
              <ul className="mt-4 space-y-2 text-sm text-slate-300">
                {subscription.features.map((feature) => <li key={feature} className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-400" />{feature}</li>)}
              </ul>
            </>
          )}
        </Card>
        <Card>
          <div className="mb-4 flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-violet-400/10"><CreditCard className="h-5 w-5 text-violet-300" /></span>
            <div><h2 className="font-semibold text-white">결제</h2><p className="text-xs text-slate-500">운영: Toss Payments · 개발: 확인 토큰</p></div>
          </div>
          {subscription?.active ? (
            <p className="text-sm text-emerald-300">구독이 활성화되어 있습니다. <Link href="/ai-seo" className="underline">AI SEO</Link> 또는 <Link href="/site-audit" className="underline">사이트 진단</Link>으로 이동하세요.</p>
          ) : (
            <>
              <Button disabled={busy} onClick={() => void startCheckout()} className="w-full sm:w-auto">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}월 구독 결제 시작</Button>
              {checkout && (
                <form onSubmit={confirmPayment} className="mt-5 space-y-3 border-t border-white/7 pt-5">
                  <p className="text-xs text-slate-500">주문 ID: {checkout.orderId}</p>
                  <label className="block text-sm text-slate-400">개발 확인 토큰<input className="mt-2" value={confirmToken} onChange={(e) => setConfirmToken(e.target.value)} /></label>
                  <Button type="submit" disabled={busy || !confirmToken.trim()} variant="secondary">결제 확인 · 구독 활성화</Button>
                </form>
              )}
            </>
          )}
        </Card>
      </div>
      {error && <p role="alert" className="mt-5 rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-300">{error}</p>}
      {message && <p className="mt-5 rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-300">{message}</p>}
    </div>
  );
}
