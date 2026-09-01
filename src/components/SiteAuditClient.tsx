"use client";

import { FormEvent, useEffect, useState } from "react";
import { LoaderCircle, Play, Plus } from "lucide-react";
import { SemforgeGateBanner } from "@/components/SemforgeGateBanner";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui";

interface Campaign { id: number; name: string; domain: string; status: string; siteHealth: number | null; lastRunAt: string | null }

async function parse<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "요청에 실패했습니다.");
  return body;
}

export function SiteAuditClient() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [locked, setLocked] = useState(false);
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    try {
      const data = await parse<{ campaigns: Campaign[] }>(await fetch("/api/site-audit"));
      setCampaigns(data.campaigns);
      setLocked(false);
    } catch (cause) {
      if (cause instanceof Error && cause.message.includes("구독")) setLocked(true);
      else setError(cause instanceof Error ? cause.message : "불러오기 실패");
    }
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await load();
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "불러오기 실패");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      await parse(await fetch("/api/site-audit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, domain }) }));
      setName(""); setDomain("");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "생성 실패"); }
    finally { setBusy(false); }
  }

  async function run(id: number) {
    setBusy(true); setError("");
    try {
      await parse(await fetch(`/api/site-audit?id=${id}`, { method: "PATCH" }));
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "실행 실패"); }
    finally { setBusy(false); }
  }

  if (loading) return <div className="grid min-h-96 place-items-center"><LoaderCircle className="h-7 w-7 animate-spin text-cyan-400" /></div>;

  return (
    <div>
      <PageHeader eyebrow="SEMForge" title="사이트 진단" description="Firecrawl 기반 크롤 진단. GEO Cheerio 진단(/audit)과 병렬로 기술 SEO·AI 검색 신호를 확장합니다." />
      {locked && <SemforgeGateBanner />}
      {!locked && (
        <>
          <Card className="mb-5">
            <form onSubmit={create} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="flex-1 text-sm text-slate-400">캠페인 이름<input className="mt-2" value={name} onChange={(e) => setName(e.target.value)} /></label>
              <label className="flex-1 text-sm text-slate-400">도메인<input className="mt-2" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com" /></label>
              <Button type="submit" disabled={busy}><Plus className="h-4 w-4" />캠페인 추가</Button>
            </form>
          </Card>
          <Card>
            {campaigns.length === 0 ? <EmptyState>사이트 진단 캠페인을 추가하세요.</EmptyState> : (
              <ul className="space-y-3">
                {campaigns.map((campaign) => (
                  <li key={campaign.id} className="flex flex-col gap-3 rounded-xl border border-white/7 bg-slate-950/35 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2"><strong className="text-white">{campaign.name}</strong><Badge>{campaign.domain}</Badge><Badge tone={campaign.status === "completed" ? "good" : "default"}>{campaign.status}</Badge></div>
                      <p className="mt-1 text-xs text-slate-500">건강 점수 {campaign.siteHealth ?? "—"} · {campaign.lastRunAt ? new Date(campaign.lastRunAt).toLocaleString("ko-KR") : "미실행"}</p>
                    </div>
                    <Button variant="secondary" disabled={busy} onClick={() => void run(campaign.id)}><Play className="h-4 w-4" />크롤 실행</Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
      {error && <p role="alert" className="mt-5 text-sm text-rose-300">{error}</p>}
    </div>
  );
}
