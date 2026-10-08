"use client";

import { useCallback, useEffect, useState } from "react";
import { LoaderCircle, Link2, RefreshCw, Unlink } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui";
import { requestJson as request } from "@/lib/client-upload";
import { formatCtr, formatPosition } from "@/lib/search-console/format";

type State = "not_configured" | "not_connected" | "connected" | "error";
interface Sync { siteUrl: string; startDate: string; endDate: string; status: "ok" | "no_rows" | "error"; rowCount: number; aggregation: string | null; timezone: string; dataState: string; fetchedAt: string; daily: Array<{ date: string; clicks: number; impressions: number; ctr: number | null; position: number | null }> }
interface StatusResponse { status: { configured: boolean; state: State; siteUrl: string | null; lastError: string | null; lastSyncedAt: string | null }; latest: Sync | null }

const STATE_LABEL: Record<State, [string, "good" | "warn" | "bad" | "default"]> = {
  not_configured: ["설정 안 됨", "default"], not_connected: ["연결 안 됨", "default"], connected: ["연결됨 · 읽기 전용", "good"], error: ["다시 연결 필요", "bad"],
};

function isoDaysAgo(days: number) {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

/** 날짜별 행을 합산한 기간 합계. CTR은 클릭÷노출, 순위는 노출 가중 평균(값이 없으면 N/A) */
function totals(daily: Sync["daily"]) {
  const clicks = daily.reduce((sum, row) => sum + row.clicks, 0);
  const impressions = daily.reduce((sum, row) => sum + row.impressions, 0);
  const weighted = daily.filter((row) => row.position !== null && row.impressions > 0);
  const weight = weighted.reduce((sum, row) => sum + row.impressions, 0);
  return { clicks, impressions, ctr: impressions > 0 ? clicks / impressions : null, position: weight > 0 ? weighted.reduce((sum, row) => sum + row.position! * row.impressions, 0) / weight : null };
}

export function GscApiPanel() {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [sites, setSites] = useState<{ state: "ok" | "no_properties"; sites: Array<{ siteUrl: string; permissionLevel: string }> } | null>(null);
  const [siteUrl, setSiteUrl] = useState("");
  // Search Console의 확정(final) 데이터는 2~3일 늦게 들어오므로 기본 기간을 3일 전까지 28일로 둔다
  const [range, setRange] = useState({ startDate: isoDaysAgo(30), endDate: isoDaysAgo(3) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try { const next = await request<StatusResponse>("/api/integrations/gsc"); setData(next); setSiteUrl(next.status.siteUrl ?? ""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "연결 상태를 불러오지 못했습니다."); }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const timer = window.setTimeout(() => {
      if (params.get("gsc") === "connected") setNotice("Search Console에 읽기 전용으로 연결했습니다. 속성을 선택하세요.");
      if (params.get("gsc") === "error") setError(`연결하지 못했습니다(${params.get("reason") ?? "알 수 없음"}).`);
      void load();
    }, 0);
    const reload = () => { setSites(null); void load(); };
    window.addEventListener("geo-master:project-changed", reload);
    return () => { window.clearTimeout(timer); window.removeEventListener("geo-master:project-changed", reload); };
  }, [load]);

  async function act(action: () => Promise<unknown>, success?: string) {
    setBusy(true); setError(""); setNotice("");
    try { await action(); if (success) setNotice(success); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "처리하지 못했습니다."); await load(); }
    finally { setBusy(false); }
  }

  if (!data) return <Card className="mt-5"><LoaderCircle className="h-5 w-5 animate-spin text-cyan-400" /></Card>;
  const { status, latest } = data;
  const [label, tone] = STATE_LABEL[status.state];
  const sum = latest?.status === "ok" ? totals(latest.daily) : null;

  return (
    <Card className="mt-5 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold text-white">Search Console API 연결</h2>
        <Badge tone={tone}>{label}</Badge>
        {status.lastError && <Badge tone="warn">최근 오류 {status.lastError}</Badge>}
      </div>
      <p className="text-xs text-slate-500">사이트 속성(URL·도메인)의 검색 성과를 읽기 전용으로 가져옵니다. SNS 플랫폼 속성은 공개 API가 제공하지 않으므로 위의 콘솔 내보내기를 쓰세요. API 데이터는 콘솔 내보내기와 따로 보관합니다.</p>

      {status.state === "not_configured" && <p className="text-sm text-slate-400">서버에 GOOGLE_CLIENT_ID · GOOGLE_CLIENT_SECRET · GSC_REDIRECT_URI 환경 변수가 있어야 연결할 수 있습니다.</p>}
      {(status.state === "not_connected" || status.state === "error") && (
        // Google 동의 화면으로 가는 최상위 이동(서버가 302로 보낸다)
        <form action="/api/integrations/gsc/start" method="get">
          <Button type="submit"><Link2 className="h-4 w-4" />{status.state === "error" ? "다시 연결" : "Google 계정 연결(읽기 전용)"}</Button>
        </form>
      )}

      {status.state === "connected" && (
        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
            <label className="block text-xs">속성
              {sites ? (
                sites.state === "no_properties" ? <p className="mt-1.5 text-sm text-amber-300">이 계정에 확인된 사이트 속성이 없습니다(오류가 아니라 속성 0개).</p> : (
                  <select className="mt-1.5" value={siteUrl} onChange={(event) => setSiteUrl(event.target.value)}>
                    <option value="">속성 선택</option>
                    {sites.sites.map((site) => <option key={site.siteUrl} value={site.siteUrl}>{site.siteUrl} ({site.permissionLevel})</option>)}
                  </select>
                )
              ) : <p className="mt-1.5 text-sm text-slate-300">{status.siteUrl ?? "선택 안 됨"}</p>}
            </label>
            {!sites
              ? <Button type="button" variant="secondary" disabled={busy} onClick={() => void act(async () => setSites(await request("/api/integrations/gsc/sites")))}>속성 불러오기</Button>
              : <Button type="button" variant="secondary" disabled={busy || !siteUrl || siteUrl === status.siteUrl} onClick={() => void act(() => request("/api/integrations/gsc/site", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ siteUrl }) }), "속성을 선택했습니다.")}>선택 저장</Button>}
            <Button type="button" variant="danger" disabled={busy} onClick={() => void act(() => request("/api/integrations/gsc", { method: "DELETE" }), "연결을 해제하고 Google 승인을 취소했습니다.")}><Unlink className="h-4 w-4" />연결 해제</Button>
          </div>
          {status.siteUrl && (
            <div className="grid gap-2 sm:grid-cols-[auto_auto_auto] sm:items-end sm:justify-start">
              <label className="block text-xs">시작일<input type="date" className="mt-1.5" value={range.startDate} onChange={(event) => setRange({ ...range, startDate: event.target.value })} /></label>
              <label className="block text-xs">종료일<input type="date" className="mt-1.5" value={range.endDate} onChange={(event) => setRange({ ...range, endDate: event.target.value })} /></label>
              <Button type="button" disabled={busy} onClick={() => void act(() => request("/api/integrations/gsc/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(range) }), "가져왔습니다.")}>{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}성과 가져오기</Button>
            </div>
          )}
        </div>
      )}

      {latest && (
        <div className="rounded-lg border border-white/10 p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <Badge>API</Badge>
            <span>{latest.siteUrl} · {latest.startDate} ~ {latest.endDate} ({latest.timezone}) · 데이터 상태 {latest.dataState} · 집계 {latest.aggregation ?? "미표시"} · {latest.fetchedAt.slice(0, 16).replace("T", " ")}</span>
          </div>
          {latest.status === "no_rows" ? <p className="mt-2 text-amber-300">행 없음 — 성과 0이 아니라 이 기간에 API가 돌려준 데이터가 없습니다.</p> : sum && (
            <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-5">
              <div><dt className="text-xs text-slate-500">클릭수</dt><dd className="text-white">{sum.clicks}</dd></div>
              <div><dt className="text-xs text-slate-500">노출</dt><dd className="text-white">{sum.impressions}</dd></div>
              <div><dt className="text-xs text-slate-500">CTR</dt><dd className="text-white">{formatCtr(sum.ctr)}</dd></div>
              <div><dt className="text-xs text-slate-500">평균 게재 순위</dt><dd className="text-white">{formatPosition(sum.position)}</dd></div>
              <div><dt className="text-xs text-slate-500">날짜 행</dt><dd className="text-white">{latest.rowCount}</dd></div>
            </dl>
          )}
        </div>
      )}
      {notice && <p role="status" className="text-sm text-emerald-300">{notice}</p>}
      {error && <p role="alert" className="text-sm text-amber-300">{error}</p>}
    </Card>
  );
}
