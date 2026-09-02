"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, CreditCard, LoaderCircle, Sparkles } from "lucide-react";
import { semforgeFeatures } from "@/lib/semforge/navigation";
import { SemforgeGateBanner } from "@/components/SemforgeGateBanner";
import { Badge, Card, PageHeader } from "@/components/ui";
import { cn } from "@/lib/utils";

interface SubscriptionState {
  active: boolean;
  status: string;
  amountKrw: number;
  currentPeriodEnd: string | null;
  daysRemaining: number | null;
  features: string[];
}

async function parse<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "요청에 실패했습니다.");
  return body;
}

export function SemforgeHubClient() {
  const [subscription, setSubscription] = useState<SubscriptionState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const data = await parse<{ subscription: SubscriptionState }>(await fetch("/api/semforge/subscription"));
        setSubscription(data.subscription);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return <div className="grid min-h-96 place-items-center"><LoaderCircle className="h-7 w-7 animate-spin text-cyan-400" /></div>;
  }

  if (!subscription?.active) {
    return (
      <div>
        <PageHeader
          eyebrow="SEMForge Pro"
          title="SEMForge 실행 워크스페이스"
          description="GEO Master 분석 인사이트를 TalorData·Firecrawl·GSC·GBP 기반 실행 기능으로 이어갑니다. 월 300,000원(VAT 별도) 구독 후 이용할 수 있습니다."
        />
        <SemforgeGateBanner />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="SEMForge"
        title="실행 워크스페이스"
        description="SERP 실측, 사이트 크롤 진단, 포지션 추적, 도메인·지역 SEO 기능을 한곳에서 실행합니다."
        action={(
          <Link href="/subscription" className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10">
            <CreditCard className="h-4 w-4" />구독 관리
          </Link>
        )}
      />

      <Card className="mb-6 border-cyan-400/15 bg-cyan-400/5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-cyan-400/10"><Sparkles className="h-5 w-5 text-cyan-300" /></span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold text-white">SEMForge Pro 활성</h2>
                <Badge tone="good">구독 중</Badge>
              </div>
              <p className="mt-1 text-sm text-slate-400">
                {subscription.currentPeriodEnd
                  ? `만료: ${new Date(subscription.currentPeriodEnd).toLocaleString("ko-KR")} (${subscription.daysRemaining ?? 0}일 남음)`
                  : "구독이 활성화되어 있습니다."}
              </p>
            </div>
          </div>
          <p className="text-sm font-semibold text-white">₩{subscription.amountKrw.toLocaleString("ko-KR")}<span className="font-normal text-slate-500">/월</span></p>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {semforgeFeatures.map(({ href, label, description, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "group rounded-2xl border border-white/8 bg-slate-900/65 p-5 transition",
              "hover:border-cyan-400/25 hover:bg-slate-900/90",
            )}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-violet-400/10">
                <Icon className="h-5 w-5 text-violet-300" />
              </span>
              <ArrowRight className="h-4 w-4 text-slate-600 transition group-hover:translate-x-0.5 group-hover:text-cyan-300" />
            </div>
            <h3 className="font-semibold text-white">{label}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-400">{description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
