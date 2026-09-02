"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  CreditCard,
  LoaderCircle,
  Play,
  Sparkles,
  Zap,
} from "lucide-react";
import { semforgeFeatures } from "@/lib/semforge/navigation";
import type { AllInStepResult } from "@/lib/semforge/all-in";
import { SemforgeGateBanner } from "@/components/SemforgeGateBanner";
import { Badge, Button, Card, PageHeader } from "@/components/ui";
import { cn } from "@/lib/utils";

interface SubscriptionState {
  active: boolean;
  status: string;
  amountKrw: number;
  currentPeriodEnd: string | null;
  daysRemaining: number | null;
  features: string[];
}

interface ProjectSummary {
  brandName: string;
  domain: string;
}

async function parse<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "요청에 실패했습니다.");
  return body;
}

function stepTone(status: AllInStepResult["status"]): "default" | "good" | "warn" | "bad" | "cyan" {
  if (status === "ok") return "good";
  if (status === "skipped") return "warn";
  return "bad";
}

export function SemforgeHubClient() {
  const [subscription, setSubscription] = useState<SubscriptionState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [brandName, setBrandName] = useState("");
  const [domain, setDomain] = useState("");
  const [locationLabel, setLocationLabel] = useState("서울");
  const [steps, setSteps] = useState<AllInStepResult[] | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const subData = await parse<{ subscription: SubscriptionState }>(await fetch("/api/semforge/subscription"));
        const projectRes = await fetch("/api/projects?limit=1");
        const projectData = projectRes.ok
          ? await projectRes.json() as { activeProject?: ProjectSummary }
          : null;
        setSubscription(subData.subscription);
        const active = projectData?.activeProject;
        if (active) {
          setBrandName(active.brandName ?? "");
          setDomain(active.domain ?? "");
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function runAllIn(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSteps(null);
    try {
      const data = await parse<{ report: { steps: AllInStepResult[] } }>(
        await fetch("/api/semforge/all-in", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ brandName, domain, locationLabel }),
        }),
      );
      setSteps(data.report.steps);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ALL IN 실행 실패");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div className="grid min-h-96 place-items-center"><LoaderCircle className="h-7 w-7 animate-spin text-cyan-400" /></div>;
  }

  if (!subscription?.active) {
    return (
      <div>
        <PageHeader
          eyebrow="SEMForge Pro"
          title="ALL IN SEMForge"
          description="브랜드명·도메인 한 번 입력으로 AI SEO, 사이트 진단, 포지션 추적, 도메인 개요, 지역 SEO를 한꺼번에 실행합니다. SEMForge Pro 구독 후 이용할 수 있습니다."
        />
        <SemforgeGateBanner />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="SEMForge"
        title="ALL IN SEMForge"
        description="브랜드명과 도메인을 입력하면 AI SEO · 사이트 진단 · 포지션 추적 · 도메인 개요 · 지역 SEO를 순차 실행합니다."
        action={(
          <Link href="/subscription" className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10">
            <CreditCard className="h-4 w-4" />구독 관리
          </Link>
        )}
      />

      <Card className="mb-6 border-violet-400/20 bg-gradient-to-br from-slate-900/90 to-violet-950/25">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-violet-400/10">
              <Zap className="h-5 w-5 text-violet-300" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold text-white">ALL IN SEMForge</h2>
                <Badge tone="good">Pro 활성</Badge>
              </div>
              <p className="mt-1 text-sm text-slate-400">
                한 번의 실행으로 SEMForge 전 카테고리 워크스페이스를 프로비저닝하고 실측·크롤을 시작합니다.
              </p>
            </div>
          </div>
          <p className="text-sm font-semibold text-white">
            ₩{subscription.amountKrw.toLocaleString("ko-KR")}<span className="font-normal text-slate-500">/월</span>
          </p>
        </div>

        <form onSubmit={runAllIn} className="grid gap-4 lg:grid-cols-4 lg:items-end">
          <label className="text-sm text-slate-400">
            브랜드명
            <input className="mt-2" value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder="안나타르" required />
          </label>
          <label className="text-sm text-slate-400">
            도메인
            <input className="mt-2" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com" required />
          </label>
          <label className="text-sm text-slate-400">
            지역 (지역 SEO)
            <input className="mt-2" value={locationLabel} onChange={(e) => setLocationLabel(e.target.value)} placeholder="강남, 서울" />
          </label>
          <Button type="submit" disabled={busy} className="w-full lg:w-auto">
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {busy ? "전체 실행 중…" : "ALL IN 실행"}
          </Button>
        </form>

        <p className="mt-4 text-xs leading-5 text-slate-500">
          TalorData·Firecrawl 연결이 없는 항목은 키워드/캠페인만 등록하고 건너뜁니다. 데모: <code className="text-slate-400">SEMFORGE_MOCK_TALORDATA=1</code>, <code className="text-slate-400">SEMFORGE_MOCK_FIRECRAWL=1</code>
        </p>
      </Card>

      {steps && (
        <Card className="mb-6 border-cyan-400/15">
          <div className="mb-4 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-cyan-300" />
            <h3 className="font-semibold text-white">실행 결과</h3>
          </div>
          <ul className="space-y-3">
            {steps.map((step) => (
              <li key={step.key} className="flex flex-col gap-2 rounded-xl border border-white/7 bg-slate-950/35 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-white">{step.label}</strong>
                    <Badge tone={stepTone(step.status)}>
                      {step.status === "ok" ? "완료" : step.status === "skipped" ? "건너뜀" : "오류"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-slate-400">{step.message}</p>
                </div>
                <Link href={step.href} className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-cyan-300 hover:underline">
                  상세 보기 <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-300">개별 워크스페이스</h3>
      </div>
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

      {error && <p role="alert" className="mt-5 text-sm text-rose-300">{error}</p>}
    </div>
  );
}
