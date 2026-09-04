"use client";

import { FormEvent, useEffect, useState } from "react";
import { Blocks, CheckCircle2, Copy, LoaderCircle, ShieldAlert, Sparkles } from "lucide-react";
import { SemforgeGateBanner } from "@/components/SemforgeGateBanner";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui";
import type { GeoPageSpec } from "@/lib/geo-page-spec";

interface PromptItem { id: string; title: string; summary: string; studioHint: string }
interface StrategyOption { id: number; type: string; title: string }
interface ContentRow {
  id: number; title: string; status: string; notes: string; updatedAt: string;
  output?: GeoPageSpec; metadata?: Record<string, unknown>;
}
interface Overview {
  locked: boolean;
  message?: string;
  brandName?: string;
  researchNotes?: string;
  competitorNotes?: string;
  prompts: PromptItem[];
  strategyOptions: StrategyOption[];
  recent: ContentRow[];
}

async function parse<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "요청에 실패했습니다.");
  return body;
}

function riskTone(level: string | undefined) {
  if (level === "destructive") return "bad" as const;
  if (level === "write") return "warn" as const;
  return "cyan" as const;
}

export function GeoBlocksClient() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [topic, setTopic] = useState("");
  const [audience, setAudience] = useState("");
  const [researchNotes, setResearchNotes] = useState("");
  const [promptId, setPromptId] = useState("");
  const [strategyIds, setStrategyIds] = useState<number[]>([]);
  const [useLlm, setUseLlm] = useState(false);
  const [preview, setPreview] = useState<{ content: ContentRow; spec: GeoPageSpec } | null>(null);

  async function load() {
    const data = await parse<{ overview: Overview }>(await fetch("/api/geo-blocks"));
    setOverview(data.overview);
    if (!researchNotes && (data.overview.researchNotes || data.overview.competitorNotes)) {
      setResearchNotes([data.overview.competitorNotes, data.overview.researchNotes].filter(Boolean).join("\n\n"));
    }
    return data.overview;
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const data = await parse<{ overview: Overview }>(await fetch("/api/geo-blocks"));
        if (!active) return;
        setOverview(data.overview);
        setResearchNotes((current) => current || [data.overview.competitorNotes, data.overview.researchNotes].filter(Boolean).join("\n\n"));
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "불러오기 실패");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  async function generate(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      const data = await parse<{ content: ContentRow; spec: GeoPageSpec }>(await fetch("/api/geo-blocks", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "generate",
          topic,
          targetAudience: audience,
          researchNotes,
          promptId: promptId || null,
          strategyItemIds: strategyIds,
          useLlm,
          clientRequestId: crypto.randomUUID(),
        }),
      }));
      setPreview(data);
      setMessage("GEO 블록 스펙이 저장되었습니다. dry-run 후 승인하세요.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "생성 실패"); }
    finally { setBusy(false); }
  }

  async function advance(status: "dry_run_preview" | "approved") {
    if (!preview) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const data = await parse<{ content: ContentRow }>(await fetch("/api/geo-blocks", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "advanceStatus",
          contentId: preview.content.id,
          status,
          expectedUpdatedAt: preview.content.updatedAt,
          dryRunConfirmed: status === "approved",
        }),
      }));
      setPreview((current) => current ? { ...current, content: { ...current.content, ...data.content } } : current);
      setMessage(status === "dry_run_preview" ? "dry-run 미리보기 완료 (로컬만, 원격 게시 없음)." : "승인됨. 원격 CMS 적용은 아직 지원하지 않습니다.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "상태 변경 실패"); }
    finally { setBusy(false); }
  }

  async function duplicate(id: number) {
    setBusy(true); setError("");
    try {
      await parse(await fetch("/api/geo-blocks", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "duplicate", contentId: id }),
      }));
      setMessage("스펙을 복제했습니다.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "복제 실패"); }
    finally { setBusy(false); }
  }

  async function fromShare() {
    setBusy(true); setError(""); setMessage("");
    try {
      const data = await parse<{ created: Array<{ content: ContentRow; spec: GeoPageSpec }>; unanswered: string[]; runId: number }>(
        await fetch("/api/geo-blocks", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "suggestFromShare", limit: 5, useLlm: false, clientRequestId: crypto.randomUUID() }),
        }),
      );
      setMessage(`미인용 질문 ${data.unanswered.length}개 → 초안 ${data.created.length}개 (run #${data.runId})`);
      if (data.created[0]) setPreview(data.created[0]);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "share 제안 실패"); }
    finally { setBusy(false); }
  }

  async function fromAudit() {
    setBusy(true); setError(""); setMessage("");
    try {
      const data = await parse<{ content: ContentRow; spec: GeoPageSpec; failedCount: number }>(await fetch("/api/geo-blocks", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "suggestFromAudit", useLlm: false, clientRequestId: crypto.randomUUID() }),
      }));
      setPreview({ content: data.content, spec: data.spec });
      setMessage(`감사 실패 ${data.failedCount}건을 블록 스펙으로 반영했습니다.`);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "audit 제안 실패"); }
    finally { setBusy(false); }
  }

  if (loading) return <div className="grid min-h-96 place-items-center"><LoaderCircle className="h-7 w-7 animate-spin text-cyan-400" /></div>;
  if (overview?.locked) {
    return <div><PageHeader eyebrow="SEMForge" title="GEO Blocks" description="인용용 페이지/포스트 블록 스펙을 초안·승인합니다." /><SemforgeGateBanner message={overview.message} /></div>;
  }

  return <div>
    <PageHeader
      eyebrow="SEMForge · GEO Blocks"
      title="GEO 블록 스펙"
      description="WP 빌더가 아닌 HeroAnswer·TL;DR·FAQ·Speakable·CTA 공통 스펙입니다. markdown + JSON-LD로 저장하며 원격 CMS 게시는 하지 않습니다."
      action={<Badge tone="cyan"><Blocks className="mr-1 h-3.5 w-3.5" />write · dry-run</Badge>}
    />

    <div className="mb-5 flex flex-wrap gap-2">
      <Button type="button" variant="secondary" disabled={busy} onClick={() => void fromShare()}><Sparkles className="h-4 w-4" />미인용 질문 → 초안</Button>
      <Button type="button" variant="secondary" disabled={busy} onClick={() => void fromAudit()}><ShieldAlert className="h-4 w-4" />감사 실패 → 스펙</Button>
    </div>

    <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
      <Card>
        <form className="space-y-4" onSubmit={generate}>
          <label className="block text-sm">주제 / 고객 질문<input className="mt-2" required maxLength={300} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="예: GEO 도구를 고르는 기준" /></label>
          <label className="block text-sm">대상 세그먼트<input className="mt-2" maxLength={200} value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="B2B 마케터" /></label>
          <label className="block text-sm">외부 연구 메모<textarea className="mt-2 min-h-28" maxLength={10000} value={researchNotes} onChange={(e) => setResearchNotes(e.target.value)} placeholder="settings 경쟁/연구 메모, RankSEO Easy-Win 등" /></label>
          <label className="block text-sm">프롬프트 플레이북
            <select className="mt-2" value={promptId} onChange={(e) => setPromptId(e.target.value)}>
              <option value="">선택 안 함</option>
              {overview?.prompts.map((prompt) => <option key={prompt.id} value={prompt.id}>{prompt.title}</option>)}
            </select>
          </label>
          {promptId && <p className="text-xs text-slate-500">{overview?.prompts.find((p) => p.id === promptId)?.studioHint}</p>}
          <fieldset>
            <legend className="text-sm text-slate-300">strategy pillar/cluster 연결</legend>
            <div className="mt-2 max-h-36 space-y-1 overflow-y-auto rounded-xl border border-white/8 p-3">
              {!overview?.strategyOptions.length && <p className="text-xs text-slate-600">전략 항목이 없습니다.</p>}
              {overview?.strategyOptions.map((item) => (
                <label key={item.id} className="flex items-start gap-2 text-xs text-slate-400">
                  <input type="checkbox" checked={strategyIds.includes(item.id)} onChange={(e) => setStrategyIds((ids) => e.target.checked ? [...ids, item.id] : ids.filter((id) => id !== item.id))} />
                  <span><Badge className="mr-1">{item.type}</Badge>{item.title}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex items-center gap-2 text-xs text-slate-400"><input type="checkbox" checked={useLlm} onChange={(e) => setUseLlm(e.target.checked)} />LLM으로 본문 보강 (API 키 필요)</label>
          <Button disabled={busy || !topic.trim()}>{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Blocks className="h-4 w-4" />}스펙 생성·저장</Button>
        </form>
      </Card>

      <Card>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="font-semibold text-white">미리보기 · 승인</h2>
          {preview && <Badge tone={riskTone(String(preview.spec.riskLevel))}>{preview.spec.riskLevel}</Badge>}
        </div>
        {!preview && <EmptyState>생성하거나 최근 항목을 선택하세요.</EmptyState>}
        {preview && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{preview.content.status}</Badge>
              <span className="text-xs text-slate-500">#{preview.content.id}</span>
            </div>
            <pre className="max-h-72 overflow-auto rounded-xl bg-slate-950/60 p-3 text-[11px] leading-5 text-slate-300 whitespace-pre-wrap">{preview.spec.markdown}</pre>
            <details className="text-xs text-slate-500"><summary className="cursor-pointer">JSON-LD</summary><pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap">{JSON.stringify(preview.spec.jsonLd, null, 2)}</pre></details>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" disabled={busy || preview.content.status === "dry_run_preview" || preview.content.status === "approved"} onClick={() => void advance("dry_run_preview")}>dry-run 미리보기</Button>
              <Button type="button" disabled={busy || preview.content.status !== "dry_run_preview"} onClick={() => void advance("approved")}><CheckCircle2 className="h-4 w-4" />승인 (로컬)</Button>
              <Button type="button" variant="secondary" disabled={busy} onClick={() => void duplicate(preview.content.id)}><Copy className="h-4 w-4" />복제</Button>
            </div>
            <p className="text-[11px] text-slate-600">파괴적 원격 적용은 없습니다. 승인 = 로컬 contents 상태만 변경합니다.</p>
          </div>
        )}
      </Card>
    </div>

    <section className="mt-6">
      <Card>
        <h2 className="mb-4 font-semibold text-white">최근 GEO Blocks</h2>
        {!overview?.recent.length && <EmptyState>저장된 스펙이 없습니다.</EmptyState>}
        <div className="space-y-2">
          {overview?.recent.map((item) => (
            <button
              key={item.id}
              type="button"
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/7 bg-slate-950/40 px-3 py-2.5 text-left hover:border-cyan-400/20"
              onClick={async () => {
                const full = await parse<{ content: ContentRow & { output: GeoPageSpec } }>(await fetch(`/api/contents/${item.id}`));
                setPreview({ content: full.content, spec: full.content.output });
              }}
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-slate-200">{item.title}</p>
                <p className="mt-0.5 text-[11px] text-slate-600">{item.updatedAt}</p>
              </div>
              <Badge tone={item.status === "approved" ? "good" : item.status === "dry_run_preview" ? "warn" : "default"}>{item.status}</Badge>
            </button>
          ))}
        </div>
      </Card>
    </section>

    {error && <p role="alert" className="mt-4 rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-300">{error}</p>}
    {message && <p className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-300"><CheckCircle2 className="h-4 w-4" />{message}</p>}
  </div>;
}
