"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, LoaderCircle, Play, Plus, Square, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/CrudPrimitives";
import { SemforgeGateBanner } from "@/components/SemforgeGateBanner";
import { SiteAuditBriefing, type SiteAuditBriefingData } from "@/components/SiteAuditBriefing";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui";
import { cn } from "@/lib/utils";

interface Campaign {
  id: number;
  name: string;
  domain: string;
  status: string;
  siteHealth: number | null;
  lastRunAt: string | null;
}

interface FirecrawlState {
  status: "live" | "mock" | "unavailable" | "error";
  source: string;
  configured: boolean;
  reason?: string;
}

type RenderMode = "native" | "rendered";
type Halt = "cancelled" | "rate_limited" | "credits_exhausted" | "auth_failed";

interface RunResult {
  status: string;
  crawledPages?: number;
  fetchedPages?: number;
  failedPages?: number;
  notRequested?: number;
  halted?: Halt | null;
  renderMode?: RenderMode;
  siteHealth?: number | null;
  source?: string;
}

const haltLabels: Record<Halt, string> = {
  cancelled: "취소됨",
  rate_limited: "요청 한도(429)로 중단",
  credits_exhausted: "Firecrawl 크레딧 부족으로 중단",
  auth_failed: "Firecrawl 인증 오류로 중단",
};

/** 렌더링 수집 시 한 번에 요청하는 최대 페이지 수 (서버 RENDER_PAGE_LIMIT와 같음) */
const RENDER_PAGE_LIMIT = 10;

async function parse<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "요청에 실패했습니다.");
  return body;
}

const statusTone = (status: string): "default" | "good" | "warn" | "bad" | "cyan" => {
  if (status === "completed") return "good";
  if (status === "partial") return "warn";
  if (status === "running") return "cyan";
  if (status === "failed") return "bad";
  if (status === "cancelled" || status === "interrupted") return "warn";
  return "default";
};

function statusLabel(status: string) {
  if (status === "running") return "크롤 중";
  if (status === "completed") return "완료";
  if (status === "partial") return "일부 실패";
  if (status === "failed") return "실패";
  if (status === "idle") return "대기";
  if (status === "cancelled") return "취소됨";
  if (status === "interrupted") return "중단됨(서버 재시작)";
  return status;
}

export function SiteAuditClient() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [firecrawl, setFirecrawl] = useState<FirecrawlState | null>(null);
  const [locked, setLocked] = useState(false);
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [runningId, setRunningId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [briefing, setBriefing] = useState<SiteAuditBriefingData | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [selectedMeta, setSelectedMeta] = useState<{ name: string; domain: string; lastRunAt: string | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Campaign | null>(null);
  const [renderMode, setRenderMode] = useState<RenderMode>("native");
  const [cancellingId, setCancellingId] = useState<number | null>(null);

  async function load() {
    const data = await parse<{ campaigns: Campaign[]; firecrawl: FirecrawlState }>(await fetch("/api/site-audit"));
    setCampaigns(data.campaigns);
    setFirecrawl(data.firecrawl);
    setLocked(false);
    return data.campaigns;
  }

  const loadBriefing = useCallback(async (id: number, meta?: Pick<Campaign, "name" | "domain" | "lastRunAt">) => {
    setBriefingLoading(true);
    try {
      const data = await parse<{ overview: { briefing: SiteAuditBriefingData; campaign: Campaign } }>(
        await fetch(`/api/site-audit?id=${id}`),
      );
      setBriefing(data.overview.briefing);
      setSelectedMeta({
        name: meta?.name ?? data.overview.campaign.name,
        domain: meta?.domain ?? data.overview.campaign.domain,
        lastRunAt: meta?.lastRunAt ?? data.overview.campaign.lastRunAt,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "브리핑을 불러오지 못했습니다.");
    } finally {
      setBriefingLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await load();
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

  function selectCampaign(campaign: Campaign) {
    if (selectedId === campaign.id) {
      setSelectedId(null);
      setBriefing(null);
      setSelectedMeta(null);
      return;
    }
    setSelectedId(campaign.id);
    void loadBriefing(campaign.id, campaign);
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      await parse(await fetch("/api/site-audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, domain }),
      }));
      setName(""); setDomain("");
      await load();
      setMessage("캠페인이 추가되었습니다.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "생성 실패");
    } finally {
      setBusy(false);
    }
  }

  async function run(id: number) {
    if (!firecrawl?.configured) {
      setError(firecrawl?.reason ?? "Firecrawl 연결이 필요합니다.");
      return;
    }
    setBusy(true);
    setRunningId(id);
    setError("");
    setMessage("");
    try {
      const mode = firecrawl.status === "live" ? renderMode : "native";
      const data = await parse<{ result: RunResult }>(await fetch(`/api/site-audit?id=${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ renderMode: mode }),
      }));
      const updated = await load();
      const result = data.result;
      if (result.status === "cancelled") {
        setMessage(`크롤을 취소했습니다 · 실측 ${result.fetchedPages ?? 0}개 저장 · 미요청 ${result.notRequested ?? 0}개`);
      } else if (result.status === "completed" || result.status === "partial") {
        const measuredText = result.fetchedPages
          ? ` · ${result.renderMode === "rendered" ? "렌더링 " : ""}실측 ${result.fetchedPages}개${result.failedPages ? ` (요청 실패 ${result.failedPages}개)` : ""}`
          : " · 페이지 미측정";
        const skippedText = result.notRequested ? ` · 미요청 ${result.notRequested}개` : "";
        const haltText = result.halted ? ` · ${haltLabels[result.halted]}` : "";
        setMessage(
          `URL 발견 ${result.crawledPages ?? 0}개${measuredText}${skippedText}${haltText} · 건강 점수 ${result.siteHealth ?? "미측정"}`
          + (result.source === "mock-dev" ? " (데모)" : ""),
        );
      }
      if (selectedId === id) {
        const campaign = updated.find((item) => item.id === id);
        if (campaign) void loadBriefing(id, campaign);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "실행 실패");
      await load();
    } finally {
      setBusy(false);
      setRunningId(null);
    }
  }

  async function cancel(id: number) {
    setCancellingId(id);
    setError("");
    try {
      await parse(await fetch(`/api/site-audit?id=${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      }));
      setMessage("취소를 요청했습니다. 진행 중인 요청이 끝나면 멈춥니다.");
      if (runningId !== id) await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "취소 실패");
      await load();
    } finally {
      setCancellingId(null);
    }
  }

  async function remove(id: number) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await parse(await fetch(`/api/site-audit?id=${id}`, { method: "DELETE" }));
      if (selectedId === id) {
        setSelectedId(null);
        setBriefing(null);
        setSelectedMeta(null);
      }
      setDeleteTarget(null);
      await load();
      setMessage("캠페인이 삭제되었습니다.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "삭제 실패");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="grid min-h-96 place-items-center"><LoaderCircle className="h-7 w-7 animate-spin text-cyan-400" /></div>;

  const crawlReady = firecrawl?.configured ?? false;
  const selectedCampaign = selectedId ? campaigns.find((c) => c.id === selectedId) : null;

  return (
    <div>
      <PageHeader eyebrow="SEMForge" title="사이트 진단" description="Firecrawl 기반 크롤 진단. 캠페인 이름을 클릭하면 건강 점수 산출 근거와 개선 브리핑을 확인할 수 있습니다." />
      {locked && <SemforgeGateBanner />}
      {!locked && firecrawl?.status === "error" && (
        <Card className="mb-5 border-rose-400/20 bg-rose-400/5">
          <p className="text-sm font-semibold text-rose-200">Firecrawl 키 복호화 오류</p>
          <p className="mt-2 text-sm leading-6 text-slate-400">{firecrawl.reason}</p>
          <p className="mt-2 text-xs text-slate-500"><a href="/settings" className="text-cyan-300 hover:underline">설정</a>에서 Firecrawl API 키를 다시 저장하세요.{firecrawl.configured ? " 데모 크롤은 계속 사용할 수 있습니다." : ""}</p>
        </Card>
      )}
      {!locked && firecrawl?.status === "unavailable" && (
        <Card className="mb-5 border-amber-400/20 bg-amber-400/5">
          <p className="text-sm font-semibold text-amber-200">Firecrawl 연결 필요</p>
          <p className="mt-2 text-sm leading-6 text-slate-400">{firecrawl.reason}</p>
          <p className="mt-2 text-xs text-slate-500"><a href="/settings" className="text-cyan-300 hover:underline">설정</a>에서 Firecrawl API 키를 저장하거나, `.env.local`에 <code className="text-slate-300">FIRECRAWL_API_KEY=...</code> 추가 후 서버를 재시작하세요.</p>
        </Card>
      )}
      {!locked && firecrawl?.status === "mock" && (
        <Card className="mb-5 border-cyan-400/20 bg-cyan-400/5">
          <p className="text-sm font-semibold text-cyan-200">데모 크롤 모드</p>
          <p className="mt-1 text-sm text-slate-400">실제 Firecrawl 대신 mock-dev 소스로 샘플 페이지를 수집합니다.</p>
        </Card>
      )}
      {!locked && (
        <>
          <Card className="mb-5">
            <form onSubmit={create} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="flex-1 text-sm text-slate-400">캠페인 이름<input className="mt-2" value={name} onChange={(e) => setName(e.target.value)} required /></label>
              <label className="flex-1 text-sm text-slate-400">도메인<input className="mt-2" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com" required /></label>
              <Button type="submit" disabled={busy}><Plus className="h-4 w-4" />캠페인 추가</Button>
            </form>
          </Card>
          <Card>
            {firecrawl?.status === "live" && (
              <fieldset className="mb-4 flex flex-col gap-2 rounded-xl border border-white/7 bg-slate-950/35 p-3 text-sm sm:flex-row sm:items-center sm:gap-5">
                <legend className="sr-only">페이지 수집 방식</legend>
                <span className="text-xs font-semibold text-slate-400">수집 방식</span>
                <label className="flex items-center gap-2 text-slate-300">
                  <input type="radio" name="render-mode" className="h-4 w-4" checked={renderMode === "native"} onChange={() => setRenderMode("native")} disabled={busy} />
                  일반 요청 <span className="text-xs text-slate-500">(크레딧 없음, 최대 25페이지)</span>
                </label>
                <label className="flex items-center gap-2 text-slate-300">
                  <input type="radio" name="render-mode" className="h-4 w-4" checked={renderMode === "rendered"} onChange={() => setRenderMode("rendered")} disabled={busy} />
                  렌더링 수집 <span className="text-xs text-slate-500">(Firecrawl 크레딧 페이지당 1, 최대 {RENDER_PAGE_LIMIT}페이지)</span>
                </label>
              </fieldset>
            )}
            {campaigns.length === 0 ? <EmptyState>사이트 진단 캠페인을 추가하세요.</EmptyState> : (
              <ul className="space-y-3">
                {campaigns.map((campaign) => {
                  const isRunning = runningId === campaign.id || campaign.status === "running";
                  const isSelected = selectedId === campaign.id;
                  return (
                    <li
                      key={campaign.id}
                      className={cn(
                        "flex flex-col gap-3 rounded-xl border p-4 transition sm:flex-row sm:items-center sm:justify-between",
                        isSelected ? "border-cyan-400/30 bg-cyan-400/5" : "border-white/7 bg-slate-950/35",
                      )}
                    >
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => selectCampaign(campaign)}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <strong className="text-white underline-offset-4 hover:underline">{campaign.name}</strong>
                          <ChevronDown className={cn("h-4 w-4 text-slate-500 transition", isSelected && "rotate-180 text-cyan-300")} />
                          <Badge>{campaign.domain}</Badge>
                          <Badge tone={statusTone(campaign.status)}>{statusLabel(campaign.status)}</Badge>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          건강 점수 {campaign.siteHealth ?? "미측정"} · {campaign.lastRunAt ? new Date(campaign.lastRunAt).toLocaleString("ko-KR") : "미실행"}
                          {isSelected ? " · 브리핑 펼침" : " · 클릭하여 분석 브리핑 보기"}
                        </p>
                      </button>
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        <Button
                          variant="secondary"
                          disabled={busy || !crawlReady || isRunning}
                          onClick={(e) => { e.stopPropagation(); void run(campaign.id); }}
                        >
                          {isRunning ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                          {isRunning ? "크롤 중" : "크롤 실행"}
                        </Button>
                        {isRunning && (
                          <Button
                            variant="danger"
                            disabled={cancellingId === campaign.id}
                            aria-label={`${campaign.name} 크롤 취소`}
                            onClick={(e) => { e.stopPropagation(); void cancel(campaign.id); }}
                          >
                            <Square className="h-4 w-4" />
                            {cancellingId === campaign.id ? "취소 요청 중" : "취소"}
                          </Button>
                        )}
                        {!isRunning && (
                          <Button
                            variant="danger"
                            disabled={busy}
                            aria-label={`${campaign.name} 캠페인 삭제`}
                            onClick={(e) => { e.stopPropagation(); setDeleteTarget(campaign); }}
                          >
                            <Trash2 className="h-4 w-4" />
                            삭제
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {selectedCampaign && selectedMeta && (
            <SiteAuditBriefing
              campaignName={selectedMeta.name}
              domain={selectedMeta.domain}
              lastRunAt={selectedMeta.lastRunAt}
              briefing={briefing}
              loading={briefingLoading}
            />
          )}
        </>
      )}
      {error && <p role="alert" className="mt-5 text-sm text-rose-300">{error}</p>}
      {message && (
        <p className="mt-5 flex items-center gap-2 text-sm text-emerald-300">
          <CheckCircle2 className="h-4 w-4" />{message}
        </p>
      )}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="사이트 진단 캠페인을 삭제할까요?"
        description={deleteTarget && (
          <>
            <strong className="text-white">{deleteTarget.name}</strong> ({deleteTarget.domain})의 크롤 결과·브리핑 데이터가 영구 삭제됩니다.
          </>
        )}
        confirmLabel="캠페인 삭제"
        destructive
        busy={busy}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => { if (deleteTarget) await remove(deleteTarget.id); }}
      />
    </div>
  );
}
