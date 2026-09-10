"use client";

import { useEffect, useState } from "react";
import { ChevronDown, LoaderCircle } from "lucide-react";
import { AnalyticsOverviewDashboard } from "@/components/AnalyticsOverviewDashboard";
import { SemforgeGateBanner } from "@/components/SemforgeGateBanner";
import { Badge, Card, PageHeader } from "@/components/ui";
import type { DomainAnalyticsDashboardData } from "@/lib/semforge/domain-overview";
import { cn } from "@/lib/utils";

interface Overview {
  locked: boolean;
  domain: string;
  positionCampaigns: number;
  siteHealth: number | null;
  lastSiteAuditAt: string | null;
  gscConnected: boolean;
  dashboard?: DomainAnalyticsDashboardData;
}

async function parse<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "요청에 실패했습니다.");
  return body;
}

export function AnalyticsOverviewClient() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const data = await parse<{ overview: Overview }>(await fetch("/api/analytics/overview"));
        if (!active) return;
        setOverview(data.overview);
        // 도메인이 있으면 이전처럼 바로 대시보드를 펼칩니다.
        if (data.overview.domain && !data.overview.locked) setExpanded(true);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "불러오기 실패");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  if (loading) return <div className="grid min-h-96 place-items-center"><LoaderCircle className="h-7 w-7 animate-spin text-cyan-400" /></div>;

  return (
    <div>
      <PageHeader
        eyebrow="SEMForge"
        title="도메인 개요"
        description="포지션 추적·사이트 진단·AI SEO·GSC를 프로젝트 도메인 기준으로 요약합니다. 도메인을 클릭하면 아래에 분석 대시보드가 펼쳐집니다."
      />
      {overview?.locked && <SemforgeGateBanner />}
      {overview && !overview.locked && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className={cn(
                "rounded-[18px] border p-5 text-left transition",
                expanded
                  ? "border-cyan-400/35 bg-cyan-400/10"
                  : "border-[color:var(--app-card-border)] bg-[color:var(--app-card-bg)] hover:border-cyan-400/25",
              )}
              aria-expanded={expanded}
              aria-controls="domain-analytics-dashboard"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-slate-500">도메인</p>
                <ChevronDown className={cn("h-4 w-4 text-slate-400 transition", expanded && "rotate-180 text-cyan-300")} />
              </div>
              <p className="mt-2 text-lg font-semibold text-white">{overview.domain || "미설정"}</p>
              <p className="mt-2 text-[11px] text-slate-500">{expanded ? "클릭하면 대시보드를 접습니다" : "클릭하면 분석 대시보드를 엽니다"}</p>
            </button>
            <Card><p className="text-xs text-slate-500">포지션 캠페인</p><p className="mt-2 text-2xl font-semibold text-white">{overview.positionCampaigns}</p></Card>
            <Card><p className="text-xs text-slate-500">사이트 건강</p><p className="mt-2 text-2xl font-semibold text-white">{overview.siteHealth ?? "—"}</p></Card>
            <Card><p className="text-xs text-slate-500">GSC</p><p className="mt-2"><Badge tone={overview.gscConnected ? "good" : "default"}>{overview.gscConnected ? "연결됨" : "미연결"}</Badge></p></Card>
          </div>
          {expanded && overview.dashboard && (
            <div id="domain-analytics-dashboard">
              <AnalyticsOverviewDashboard dashboard={overview.dashboard} />
            </div>
          )}
        </>
      )}
      {error && <p role="alert" className="mt-5 text-sm text-rose-300">{error}</p>}
    </div>
  );
}
