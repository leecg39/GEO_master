"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CreditCard, ExternalLink, FilePenLine, LoaderCircle, Play } from "lucide-react";
import { SEMFORGE_SUBSCRIPTION_PATH } from "@/lib/semforge/navigation";
import { NAEO_REPO_URL, naeoFeatures } from "@/lib/naeo/navigation";
import { SemforgeGateBanner } from "@/components/SemforgeGateBanner";
import { Badge, Card, PageHeader } from "@/components/ui";

interface SubscriptionState {
  active: boolean;
  amountKrw: number;
}

async function parse<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "요청에 실패했습니다.");
  return body;
}

function FeatureGrid() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {naeoFeatures.map(({ label, description, icon: Icon }) => (
        <div key={label} className="rounded-2xl border border-white/8 bg-slate-900/65 p-5">
          <span className="mb-4 grid h-10 w-10 place-items-center rounded-xl bg-violet-400/10">
            <Icon className="h-5 w-5 text-violet-300" />
          </span>
          <h3 className="font-semibold text-white">{label}</h3>
          <p className="mt-2 text-sm leading-6 text-slate-400">{description}</p>
        </div>
      ))}
    </div>
  );
}

export function NaeoHubClient({ serviceUrl }: { serviceUrl: string | null }) {
  const [subscription, setSubscription] = useState<SubscriptionState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const data = await parse<{ subscription: SubscriptionState }>(await fetch("/api/semforge/subscription"));
        setSubscription(data.subscription);
      } catch {
        setSubscription(null);
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
          eyebrow="유료 서비스 · Naeo"
          title="Naeo"
          description="네이버 블로그 진단, 키워드 상위 노출과 AI 인용 확인, 메이트 재진단과 AI 글쓰기를 다루는 별도 워크스페이스입니다. SEMForge Pro 구독 후 실행할 수 있습니다."
        />
        <SemforgeGateBanner message="Naeo는 SEMForge Pro 구독에 포함된 서비스입니다. 구독하면 이 페이지에서 Naeo 워크스페이스를 바로 실행할 수 있습니다." />
        <div className="mt-8">
          <FeatureGrid />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="유료 서비스 · Naeo"
        title="Naeo"
        description="네이버 블로그 진단, 키워드 상위 노출과 AI 인용 확인, 메이트 재진단과 AI 글쓰기를 다루는 별도 워크스페이스입니다."
        action={(
          <Link href={SEMFORGE_SUBSCRIPTION_PATH} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10">
            <CreditCard className="h-4 w-4" />구독 관리
          </Link>
        )}
      />

      <Card className="mb-6 border-violet-400/20 bg-gradient-to-br from-slate-900/90 to-violet-950/25">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-violet-400/10">
              <FilePenLine className="h-5 w-5 text-violet-300" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold text-white">Naeo 워크스페이스</h2>
                <Badge tone="good">Pro 활성</Badge>
              </div>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">
                Naeo는 GEO Master와 별도로 실행되는 서비스입니다. 실행 화면에서 쓰는 로그인과 작업 데이터는 GEO Master와 공유되지 않습니다.
              </p>
            </div>
          </div>
          <p className="shrink-0 text-sm font-semibold text-white">
            ₩{subscription.amountKrw.toLocaleString("ko-KR")}<span className="font-normal text-slate-500">/월 · SEMForge Pro 포함</span>
          </p>
        </div>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
          {serviceUrl ? (
            <a
              href={serviceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-cyan-400 px-5 py-3 text-sm font-bold text-black transition hover:bg-cyan-300"
            >
              <Play className="h-4 w-4" />Naeo 실행하기<ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
              <span className="sr-only"> (새 탭에서 열기)</span>
            </a>
          ) : (
            <span
              aria-disabled="true"
              className="inline-flex min-h-11 cursor-not-allowed items-center justify-center gap-2 rounded-xl bg-white/5 px-5 py-3 text-sm font-bold text-slate-500"
            >
              <Play className="h-4 w-4" />Naeo 실행하기
            </span>
          )}
          <a
            href={NAEO_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
          >
            GitHub 저장소<ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
            <span className="sr-only"> (새 탭에서 열기)</span>
          </a>
        </div>

        {serviceUrl ? (
          <p className="mt-4 text-xs leading-5 text-slate-500">
            실행 주소: <span className="break-all text-slate-400">{serviceUrl}</span>
          </p>
        ) : (
          <p role="alert" className="mt-4 text-xs leading-5 text-amber-300">
            Naeo 실행 주소가 설정되지 않았습니다. 서버 환경변수 <code className="text-amber-200">NAEO_SERVICE_URL</code>에 별도로 실행 중인 Naeo 주소(예: http://127.0.0.1:3100)를 설정한 뒤 서버를 재시작하세요.
          </p>
        )}
      </Card>

      <FeatureGrid />
    </div>
  );
}
