"use client";

import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { SemforgeGateBanner } from "@/components/SemforgeGateBanner";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";

interface Overview {
  locked: boolean;
  mapRankAvailable: boolean;
  connections: Array<{ id: number; locationName: string; status: string }>;
}

async function parse<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "요청에 실패했습니다.");
  return body;
}

export function LocalBusinessClient() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const data = await parse<{ overview: Overview }>(await fetch("/api/local-business"));
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
      <PageHeader eyebrow="SEMForge" title="지역 SEO" description="Google Business Profile 연결과 Map Rank 키워드 추적(준비). OAuth scope는 설정에서 관리합니다." />
      {overview?.locked && <SemforgeGateBanner />}
      {overview && !overview.locked && (
        <Card>
          <div className="mb-4 flex items-center gap-2">
            <h2 className="font-semibold text-white">GBP 연결</h2>
            <Badge tone={overview.mapRankAvailable ? "good" : "warn"}>{overview.mapRankAvailable ? "Map Rank API 준비" : "TalorData 미설정"}</Badge>
          </div>
          {overview.connections.length === 0 ? <EmptyState>GBP OAuth 연결 UI는 SEMForge Pro 구독 후 설정에서 연결할 수 있습니다.</EmptyState> : (
            <ul className="space-y-2 text-sm text-slate-300">
              {overview.connections.map((c) => <li key={c.id}>{c.locationName || "위치"} · {c.status}</li>)}
            </ul>
          )}
        </Card>
      )}
      {error && <p role="alert" className="mt-5 text-sm text-rose-300">{error}</p>}
    </div>
  );
}
