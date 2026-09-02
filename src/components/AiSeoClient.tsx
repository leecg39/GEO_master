"use client";

import { FormEvent, useEffect, useState } from "react";
import { LoaderCircle, Play, Plus, Trash2 } from "lucide-react";
import { SemforgeGateBanner } from "@/components/SemforgeGateBanner";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui";

interface Overview {
  locked: boolean;
  message?: string;
  domain: string;
  talordata?: { status: string; source: string; reason?: string };
  stats: { queryCount: number; collectedCount: number; aioCount: number; citedCount: number; lastCollectedAt: string | null };
  queries: Array<{ id: number; query: string; aioPresent: boolean | null; cited: boolean | null; organicPosition: number | null }>;
}

async function parse<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "요청에 실패했습니다.");
  return body;
}

export function AiSeoClient() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [domain, setDomain] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load(nextDomain?: string) {
    const q = nextDomain ?? domain;
    const data = await parse<{ overview: Overview }>(await fetch(`/api/ai-seo/overview?domain=${encodeURIComponent(q)}`));
    setOverview(data.overview);
    setDomain(data.overview.domain);
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const data = await parse<{ overview: Overview }>(await fetch("/api/ai-seo/overview"));
        if (!active) return;
        setOverview(data.overview);
        setDomain(data.overview.domain);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "불러오기 실패");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  async function addQuery(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      await parse(await fetch("/api/ai-seo/queries", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ domain, query }) }));
      setQuery("");
      await load(domain);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "추가 실패"); }
    finally { setBusy(false); }
  }

  async function collect() {
    setBusy(true); setError("");
    try {
      await parse(await fetch("/api/ai-seo/collect", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ domain }) }));
      await load(domain);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "수집 실패"); }
    finally { setBusy(false); }
  }

  async function remove(id: number) {
    setBusy(true); setError("");
    try {
      await parse(await fetch(`/api/ai-seo/queries?id=${id}`, { method: "DELETE" }));
      await load(domain);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "삭제 실패"); }
    finally { setBusy(false); }
  }

  const talordataReady = overview?.talordata?.status === "live" || overview?.talordata?.source === "mock-dev";

  if (loading) return <div className="grid min-h-96 place-items-center"><LoaderCircle className="h-7 w-7 animate-spin text-cyan-400" /></div>;

  return (
    <div>
      <PageHeader eyebrow="SEMForge" title="AI SEO (SERP)" description="Google AI Overview 출현·자사 도메인 인용을 TalorData 실측 SERP로 추적합니다. GEO LLM Answer Share와 상보적인 SERP 신호입니다." action={overview && !overview.locked && <Button disabled={busy || !talordataReady} onClick={() => void collect()}><Play className="h-4 w-4" />실측 수집</Button>} />
      {overview?.locked && <SemforgeGateBanner message={overview.message} />}
      {overview && !overview.locked && overview.talordata?.status === "unavailable" && (
        <Card className="mb-5 border-amber-400/20 bg-amber-400/5">
          <p className="text-sm font-semibold text-amber-200">TalorData 연결 필요</p>
          <p className="mt-2 text-sm leading-6 text-slate-400">{overview.talordata.reason ?? "TALORDATA_API_TOKEN 이 서버에 설정되지 않았습니다."}</p>
          <p className="mt-2 text-xs text-slate-500"><a href="/settings" className="text-cyan-300 hover:underline">설정</a>에서 TalorData API 토큰을 저장하거나, `.env.local`에 <code className="text-slate-300">TALORDATA_API_TOKEN=...</code> 추가 후 서버를 재시작하세요. 로컬 데모용 <code className="text-slate-300">SEMFORGE_MOCK_TALORDATA=1</code> 도 사용할 수 있습니다.</p>
        </Card>
      )}
      {overview && !overview.locked && overview.talordata?.source === "mock-dev" && (
        <Card className="mb-5 border-cyan-400/20 bg-cyan-400/5">
          <p className="text-sm font-semibold text-cyan-200">데모 SERP 모드</p>
          <p className="mt-1 text-sm text-slate-400">실제 TalorData 대신 mock-dev 소스로 수집합니다. 운영 전 토큰을 연결하세요.</p>
        </Card>
      )}
      {overview && !overview.locked && (
        <>
          <div className="mb-5 grid gap-4 sm:grid-cols-4">
            {[
              ["추적 쿼리", overview.stats.queryCount],
              ["수집 완료", overview.stats.collectedCount],
              ["AIO 출현", overview.stats.aioCount],
              ["자사 인용", overview.stats.citedCount],
            ].map(([label, value]) => (
              <Card key={String(label)}><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-2xl font-semibold text-white">{value}</p></Card>
            ))}
          </div>
          <Card className="mb-5">
            <form onSubmit={addQuery} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="flex-1 text-sm text-slate-400">도메인<input className="mt-2" value={domain} onChange={(e) => setDomain(e.target.value)} /></label>
              <label className="flex-[2] text-sm text-slate-400">추적 쿼리<input className="mt-2" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="브랜드명, 제품 관련 질문" /></label>
              <Button type="submit" disabled={busy}><Plus className="h-4 w-4" />추가</Button>
            </form>
          </Card>
          <Card>
            <h2 className="mb-4 font-semibold text-white">쿼리 현황 · {overview.domain}</h2>
            {overview.queries.length === 0 ? <EmptyState>추적 쿼리를 추가한 뒤 실측 수집을 실행하세요.</EmptyState> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-slate-500"><tr><th className="pb-3">쿼리</th><th className="pb-3">AIO</th><th className="pb-3">인용</th><th className="pb-3">오가닉</th><th className="pb-3" /></tr></thead>
                  <tbody className="text-slate-300">
                    {overview.queries.map((row) => (
                      <tr key={row.id} className="border-t border-white/5">
                        <td className="py-3 pr-4">{row.query}</td>
                        <td className="py-3">{row.aioPresent === null ? "—" : row.aioPresent ? <Badge tone="good">출현</Badge> : <Badge>없음</Badge>}</td>
                        <td className="py-3">{row.cited === null ? "판정불가" : row.cited ? <Badge tone="good">인용</Badge> : <Badge tone="warn">미인용</Badge>}</td>
                        <td className="py-3">{row.organicPosition ?? "—"}</td>
                        <td className="py-3 text-right"><button type="button" disabled={busy} onClick={() => void remove(row.id)} className="text-rose-300"><Trash2 className="h-4 w-4" /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
      {error && <p role="alert" className="mt-5 text-sm text-rose-300">{error}</p>}
    </div>
  );
}
