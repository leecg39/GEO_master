"use client";

import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { SemforgeGateBanner } from "@/components/SemforgeGateBanner";
import { Badge, Card, PageHeader } from "@/components/ui";

interface Overview {
  locked: boolean;
  domain: string;
  positionCampaigns: number;
  siteHealth: number | null;
  lastSiteAuditAt: string | null;
  gscConnected: boolean;
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

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const data = await parse<{ overview: Overview }>(await fetch("/api/analytics/overview"));
        if (!active) return;
        setOverview(data.overview);
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
      <PageHeader eyebrow="SEMForge" title="도메인 개요" description="포지션 추적·사이트 진단·GSC 연결 상태를 프로젝트 도메인 기준으로 요약합니다." />
      {overview?.locked && <SemforgeGateBanner />}
      {overview && !overview.locked && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card><p className="text-xs text-slate-500">도메인</p><p className="mt-2 text-lg font-semibold text-white">{overview.domain || "미설정"}</p></Card>
          <Card><p className="text-xs text-slate-500">포지션 캠페인</p><p className="mt-2 text-2xl font-semibold text-white">{overview.positionCampaigns}</p></Card>
          <Card><p className="text-xs text-slate-500">사이트 건강</p><p className="mt-2 text-2xl font-semibold text-white">{overview.siteHealth ?? "—"}</p></Card>
          <Card><p className="text-xs text-slate-500">GSC</p><p className="mt-2"><Badge tone={overview.gscConnected ? "good" : "default"}>{overview.gscConnected ? "연결됨" : "미연결"}</Badge></p></Card>
        </div>
      )}
      {error && <p role="alert" className="mt-5 text-sm text-rose-300">{error}</p>}
    </div>
  );
}
