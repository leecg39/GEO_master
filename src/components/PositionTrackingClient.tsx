"use client";

import { FormEvent, useEffect, useState } from "react";
import { LoaderCircle, Play, Plus } from "lucide-react";
import { SemforgeGateBanner } from "@/components/SemforgeGateBanner";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui";

interface Campaign { id: number; name: string; domain: string; visibility: number }
interface Keyword { id: number; keyword: string; position: number | null; previousPosition: number | null }

async function parse<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "요청에 실패했습니다.");
  return body;
}

export function PositionTrackingClient() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [locked, setLocked] = useState(false);
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function loadCampaigns() {
    const data = await parse<{ campaigns: Campaign[] }>(await fetch("/api/position-tracking"));
    setCampaigns(data.campaigns as Campaign[]);
    setLocked(false);
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await loadCampaigns();
      } catch (cause) {
        if (!active) return;
        if (cause instanceof Error && cause.message.includes("구독")) setLocked(true);
        else setError(cause instanceof Error ? cause.message : "불러오기 실패");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  async function loadKeywords(campaignId: number) {
    const data = await parse<{ keywords: Keyword[] }>(await fetch(`/api/position-tracking?campaignId=${campaignId}`));
    setKeywords(data.keywords);
    setSelected(campaignId);
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      await parse(await fetch("/api/position-tracking", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, domain }) }));
      setName(""); setDomain("");
      await loadCampaigns();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "생성 실패"); }
    finally { setBusy(false); }
  }

  async function addKeyword(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true); setError("");
    try {
      await parse(await fetch("/api/position-tracking", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ campaignId: selected, keyword }) }));
      setKeyword("");
      await loadKeywords(selected);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "키워드 추가 실패"); }
    finally { setBusy(false); }
  }

  async function collect() {
    if (!selected) return;
    setBusy(true); setError("");
    try {
      await parse(await fetch(`/api/position-tracking?campaignId=${selected}`, { method: "PATCH" }));
      await loadKeywords(selected);
      await loadCampaigns();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "수집 실패"); }
    finally { setBusy(false); }
  }

  if (loading) return <div className="grid min-h-96 place-items-center"><LoaderCircle className="h-7 w-7 animate-spin text-cyan-400" /></div>;

  return (
    <div>
      <PageHeader eyebrow="SEMForge" title="포지션 추적" description="TalorData SERP 실측으로 키워드 순위를 추적합니다. 도메인 개요(/analytics/overview)와 함께 사용하세요." />
      {locked && <SemforgeGateBanner />}
      {!locked && (
        <>
          <Card className="mb-5">
            <form onSubmit={create} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="flex-1 text-sm text-slate-400">캠페인<input className="mt-2" value={name} onChange={(e) => setName(e.target.value)} /></label>
              <label className="flex-1 text-sm text-slate-400">도메인<input className="mt-2" value={domain} onChange={(e) => setDomain(e.target.value)} /></label>
              <Button type="submit" disabled={busy}><Plus className="h-4 w-4" />추가</Button>
            </form>
          </Card>
          <div className="grid gap-5 xl:grid-cols-2">
            <Card>
              <h2 className="mb-4 font-semibold text-white">캠페인</h2>
              {campaigns.length === 0 ? <EmptyState>캠페인을 추가하세요.</EmptyState> : (
                <ul className="space-y-2">
                  {campaigns.map((c) => (
                    <li key={c.id}>
                      <button type="button" onClick={() => void loadKeywords(c.id)} className={`w-full rounded-xl border px-4 py-3 text-left ${selected === c.id ? "border-cyan-400/30 bg-cyan-400/10" : "border-white/7 bg-slate-950/35"}`}>
                        <div className="flex items-center justify-between gap-2"><strong className="text-white">{c.name}</strong><Badge tone="cyan">가시성 {c.visibility}</Badge></div>
                        <p className="mt-1 text-xs text-slate-500">{c.domain}</p>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="font-semibold text-white">키워드</h2>
                {selected && <Button variant="secondary" disabled={busy} onClick={() => void collect()}><Play className="h-4 w-4" />순위 수집</Button>}
              </div>
              {selected ? (
                <>
                  <form onSubmit={addKeyword} className="mb-4 flex gap-2">
                    <input className="flex-1" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="키워드" />
                    <Button type="submit" disabled={busy}><Plus className="h-4 w-4" /></Button>
                  </form>
                  {keywords.length === 0 ? <EmptyState>키워드를 추가하세요.</EmptyState> : (
                    <ul className="space-y-2 text-sm text-slate-300">
                      {keywords.map((k) => <li key={k.id} className="flex justify-between rounded-lg bg-slate-950/40 px-3 py-2"><span>{k.keyword}</span><span>{k.position ?? "—"}</span></li>)}
                    </ul>
                  )}
                </>
              ) : <EmptyState>캠페인을 선택하세요.</EmptyState>}
            </Card>
          </div>
        </>
      )}
      {error && <p role="alert" className="mt-5 text-sm text-rose-300">{error}</p>}
    </div>
  );
}
