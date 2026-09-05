"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { LoaderCircle, MapPin, Play, Plus, Trash2 } from "lucide-react";
import { LocalBusinessBriefing } from "@/components/LocalBusinessBriefing";
import { SemforgeGateBanner } from "@/components/SemforgeGateBanner";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui";
import { buildLocalBusinessBriefing } from "@/lib/semforge/local-business/briefing";

interface GbpConnection {
  id: number;
  locationName: string;
  address: string;
  status: string;
  updatedAt: string;
}

interface MapRankCampaign {
  id: number;
  gbpConnectionId: number | null;
  name: string;
  businessName: string;
  locationLabel: string;
  visibility: number;
  updatedAt: string;
}

interface MapRankKeyword {
  id: number;
  keyword: string;
  mapPosition: number | null;
  previousMapPosition: number | null;
  inLocalPack: boolean;
}

interface Overview {
  locked: boolean;
  mapRankAvailable: boolean;
  googleOAuthConfigured: boolean;
  talordata?: { status: string; source: string; reason?: string };
  connections: GbpConnection[];
  campaigns: MapRankCampaign[];
}

async function parse<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "요청에 실패했습니다.");
  return body;
}

function statusLabel(status: string) {
  if (status === "connected") return "연결됨";
  if (status === "pending_oauth") return "OAuth 대기";
  return status;
}

function statusTone(status: string): "default" | "good" | "warn" | "bad" | "cyan" {
  if (status === "connected") return "good";
  if (status === "pending_oauth") return "warn";
  return "default";
}

export function LocalBusinessClient() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [selectedCampaign, setSelectedCampaign] = useState<MapRankCampaign | null>(null);
  const [keywords, setKeywords] = useState<MapRankKeyword[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [locationName, setLocationName] = useState("");
  const [address, setAddress] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [locationLabel, setLocationLabel] = useState("");
  const [keyword, setKeyword] = useState("");

  async function loadOverview() {
    const data = await parse<{ overview: Overview }>(await fetch("/api/local-business"));
    setOverview(data.overview);
    return data.overview;
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await loadOverview();
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "불러오기 실패");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  async function loadKeywords(campaign: MapRankCampaign) {
    const data = await parse<{ keywords: MapRankKeyword[] }>(await fetch(`/api/local-business?campaignId=${campaign.id}`));
    setKeywords(data.keywords);
    setSelectedCampaign(campaign);
  }

  async function connectGbp(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      const data = await parse<{ connection: GbpConnection & { oauthUrl?: string | null } }>(
        await fetch("/api/local-business", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ locationName, address }),
        }),
      );
      setLocationName(""); setAddress("");
      await loadOverview();
      setMessage(data.connection.status === "pending_oauth"
        ? "GBP 연결이 등록되었습니다. Google OAuth 설정 후 인증을 완료하세요."
        : "GBP 위치가 등록되었습니다.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "GBP 연결 실패");
    } finally {
      setBusy(false);
    }
  }

  async function removeGbp(id: number) {
    setBusy(true); setError("");
    try {
      await parse(await fetch(`/api/local-business?gbpId=${id}`, { method: "DELETE" }));
      await loadOverview();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "GBP 삭제 실패");
    } finally {
      setBusy(false);
    }
  }

  async function createCampaign(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      await parse(await fetch("/api/local-business", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: campaignName, businessName, locationLabel }),
      }));
      setCampaignName(""); setBusinessName(""); setLocationLabel("");
      await loadOverview();
      setMessage("Map Rank 캠페인이 추가되었습니다.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "캠페인 생성 실패");
    } finally {
      setBusy(false);
    }
  }

  async function addKeyword(event: FormEvent) {
    event.preventDefault();
    if (!selectedCampaign) return;
    setBusy(true); setError("");
    try {
      await parse(await fetch("/api/local-business", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ campaignId: selectedCampaign.id, keyword }),
      }));
      setKeyword("");
      await loadKeywords(selectedCampaign);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "키워드 추가 실패");
    } finally {
      setBusy(false);
    }
  }

  async function collect() {
    if (!selectedCampaign) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await parse(await fetch(`/api/local-business?campaignId=${selectedCampaign.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: "{}",
      }));
      const refreshed = await loadOverview();
      const updated = refreshed.campaigns.find((item) => item.id === selectedCampaign.id) ?? selectedCampaign;
      await loadKeywords(updated);
      setMessage("Map Rank 수집이 완료되었습니다.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "수집 실패");
    } finally {
      setBusy(false);
    }
  }

  const briefing = useMemo(
    () => buildLocalBusinessBriefing(keywords, selectedCampaign?.visibility ?? 0),
    [keywords, selectedCampaign?.visibility],
  );

  if (loading) return <div className="grid min-h-96 place-items-center"><LoaderCircle className="h-7 w-7 animate-spin text-cyan-400" /></div>;

  const mapRankReady = overview?.mapRankAvailable ?? false;

  return (
    <div>
      <PageHeader
        eyebrow="SEMForge"
        title="지역 SEO"
        description="Google Business Profile 위치 등록과 TalorData Local Pack Map Rank 추적. 모바일 SERP에서 지역 키워드 노출을 실측합니다."
      />
      {overview?.locked && <SemforgeGateBanner />}
      {overview && !overview.locked && overview.talordata?.status === "unavailable" && (
        <Card className="mb-5 border-amber-400/20 bg-amber-400/5">
          <p className="text-sm font-semibold text-amber-200">TalorData 연결 필요</p>
          <p className="mt-2 text-sm leading-6 text-slate-400">{overview.talordata.reason}</p>
          <p className="mt-2 text-xs text-slate-500"><a href="/settings" className="text-cyan-300 hover:underline">설정</a>에서 TalorData API 토큰을 저장하거나 `.env.local`에 <code className="text-slate-300">SEMFORGE_MOCK_TALORDATA=1</code> 데모 모드를 사용하세요.</p>
        </Card>
      )}
      {overview && !overview.locked && overview.talordata?.source === "mock-dev" && (
        <Card className="mb-5 border-cyan-400/20 bg-cyan-400/5">
          <p className="text-sm font-semibold text-cyan-200">데모 Local Pack 모드</p>
          <p className="mt-1 text-sm text-slate-400">mock-dev SERP로 Local Pack 순위를 시뮬레이션합니다.</p>
        </Card>
      )}
      {overview && !overview.locked && (
        <>
          <Card className="mb-5">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <MapPin className="h-4 w-4 text-violet-300" />
              <h2 className="font-semibold text-white">GBP 위치</h2>
              <Badge tone={overview.googleOAuthConfigured ? "cyan" : "default"}>
                {overview.googleOAuthConfigured ? "Google OAuth 설정됨" : "수동 등록 모드"}
              </Badge>
            </div>
            <form onSubmit={connectGbp} className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="flex-1 text-sm text-slate-400">매장/지점명<input className="mt-2" value={locationName} onChange={(e) => setLocationName(e.target.value)} required /></label>
              <label className="flex-[2] text-sm text-slate-400">주소<input className="mt-2" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="서울 강남구 ..." /></label>
              <Button type="submit" disabled={busy}><Plus className="h-4 w-4" />GBP 등록</Button>
            </form>
            {overview.connections.length === 0 ? (
              <EmptyState>GBP 위치를 등록하면 Map Rank 캠페인과 연결할 수 있습니다.</EmptyState>
            ) : (
              <ul className="space-y-2">
                {overview.connections.map((connection) => (
                  <li key={connection.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/7 bg-slate-950/35 px-4 py-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="text-white">{connection.locationName}</strong>
                        <Badge tone={statusTone(connection.status)}>{statusLabel(connection.status)}</Badge>
                      </div>
                      {connection.address && <p className="mt-1 text-xs text-slate-500">{connection.address}</p>}
                    </div>
                    <button type="button" disabled={busy} onClick={() => void removeGbp(connection.id)} className="text-rose-300" aria-label={`${connection.locationName} 삭제`}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="mb-5">
            <form onSubmit={createCampaign} className="flex flex-col gap-3 lg:flex-row lg:items-end">
              <label className="flex-1 text-sm text-slate-400">캠페인<input className="mt-2" value={campaignName} onChange={(e) => setCampaignName(e.target.value)} required /></label>
              <label className="flex-1 text-sm text-slate-400">사업장명<input className="mt-2" value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Local Pack 매칭용" required /></label>
              <label className="flex-1 text-sm text-slate-400">지역<input className="mt-2" value={locationLabel} onChange={(e) => setLocationLabel(e.target.value)} placeholder="강남, 서울" required /></label>
              <Button type="submit" disabled={busy}><Plus className="h-4 w-4" />캠페인 추가</Button>
            </form>
          </Card>

          <div className="grid gap-5 xl:grid-cols-2">
            <Card>
              <h2 className="mb-4 font-semibold text-white">Map Rank 캠페인</h2>
              {overview.campaigns.length === 0 ? <EmptyState>Map Rank 캠페인을 추가하세요.</EmptyState> : (
                <ul className="space-y-2">
                  {overview.campaigns.map((campaign) => (
                    <li key={campaign.id}>
                      <button
                        type="button"
                        onClick={() => void loadKeywords(campaign)}
                        className={`w-full rounded-xl border px-4 py-3 text-left ${selectedCampaign?.id === campaign.id ? "border-violet-400/30 bg-violet-400/10" : "border-white/7 bg-slate-950/35"}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <strong className="text-white">{campaign.name}</strong>
                          <Badge tone="cyan">가시성 {campaign.visibility}%</Badge>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">{campaign.businessName} · {campaign.locationLabel}</p>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="font-semibold text-white">지역 키워드</h2>
                {selectedCampaign && (
                  <Button variant="secondary" disabled={busy || !mapRankReady} onClick={() => void collect()}>
                    <Play className="h-4 w-4" />Map Rank 수집
                  </Button>
                )}
              </div>
              {selectedCampaign ? (
                <>
                  <form onSubmit={addKeyword} className="mb-4 flex gap-2">
                    <input className="flex-1" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="예: 강남 미용실" required />
                    <Button type="submit" disabled={busy}><Plus className="h-4 w-4" /></Button>
                  </form>
                  {keywords.length === 0 ? <EmptyState>지역 키워드를 추가하세요.</EmptyState> : (
                    <ul className="space-y-2 text-sm text-slate-300">
                      {keywords.map((item) => (
                        <li key={item.id} className="flex items-center justify-between rounded-lg bg-slate-950/40 px-3 py-2">
                          <span>{item.keyword}</span>
                          <span className="flex items-center gap-2">
                            {item.inLocalPack && <Badge tone="good">Pack</Badge>}
                            <span className="font-semibold text-violet-300">{item.mapPosition ?? "—"}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <EmptyState>Map Rank 캠페인을 선택하세요.</EmptyState>
              )}
            </Card>
          </div>

          {selectedCampaign && (
            <LocalBusinessBriefing
              campaignName={selectedCampaign.name}
              locationLabel={selectedCampaign.locationLabel}
              updatedAt={selectedCampaign.updatedAt}
              briefing={briefing}
            />
          )}
        </>
      )}
      {error && <p role="alert" className="mt-5 text-sm text-rose-300">{error}</p>}
      {message && <p className="mt-5 text-sm text-emerald-300">{message}</p>}
    </div>
  );
}
