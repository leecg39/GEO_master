"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FlaskConical, Globe, LoaderCircle, Plus, Square, Trash2, X } from "lucide-react";
import { OptimizerResult } from "@/components/OptimizerResult";
import { Badge, Button, Card, EmptyState, PageHeader, Progress } from "@/components/ui";
import { estimateOptimizationCalls, type OptimizationResult } from "@/lib/featgeo";

type Provider = "openai" | "anthropic" | "gemini" | "grok";
type Status = "running" | "completed" | "failed" | "canceled";
interface Source { label: string; url: string; text: string }
interface Run { id: number; title: string; query: string; status: Status; progress: { evaluated?: number; total?: number; callsUsed?: number }; result: OptimizationResult | null; errorCode: string | null; createdAt: string }
interface Suggestions { runId: number | null; pages: { url: string; domain: string; category: string; count: number }[] }
interface SettingsInfo { apiKeys: Record<Provider, { configured: boolean }> }

const providerLabels: Record<Provider, string> = { openai: "GPT", anthropic: "Claude", gemini: "Gemini", grok: "Grok" };
const statusLabels: Record<Status, { label: string; tone: "cyan" | "good" | "bad" | "default" }> = {
  running: { label: "실행 중", tone: "cyan" }, completed: { label: "완료", tone: "good" }, failed: { label: "실패", tone: "bad" }, canceled: { label: "취소", tone: "default" },
};
const POLL_MS = 3_000;
const lines = (value: string) => value.split("\n").map((item) => item.trim()).filter(Boolean);

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { error?: string }).error || "요청을 처리하지 못했습니다.");
  return body as T;
}

const postJson = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export function OptimizerClient() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestions>({ runId: null, pages: [] });
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [form, setForm] = useState({ title: "", query: "", original: "", allowedSources: "", quotes: "", provider: "" as Provider | "", popsize: 4, generations: 2, completions: 2 });
  const [sources, setSources] = useState<Source[]>([{ label: "", url: "", text: "" }]);
  const [fetching, setFetching] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const estimate = useMemo(() => estimateOptimizationCalls(form), [form]);
  const selected = runs.find((run) => run.id === selectedId) ?? null;

  const load = useCallback(async () => {
    try {
      const data = await request<{ items: Run[]; suggestions: Suggestions }>("/api/optimizer");
      setRuns(data.items);
      setSuggestions(data.suggestions);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "실행 이력을 불러오지 못했습니다.");
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => {
      void load();
      void request<{ settings: SettingsInfo }>("/api/measurement-context").then(({ settings }) => {
        const configured = (Object.keys(providerLabels) as Provider[]).filter((provider) => settings.apiKeys[provider]?.configured);
        setProviders(configured);
        setForm((current) => ({ ...current, provider: current.provider || configured[0] || "" }));
      }).catch(() => setProviders([]));
    }, 0);
    return () => window.clearTimeout(initial);
  }, [load]);

  useEffect(() => {
    if (!runs.some((run) => run.status === "running")) return;
    const timer = window.setTimeout(() => { void load(); }, POLL_MS);
    return () => window.clearTimeout(timer);
  }, [runs, load]);

  async function fetchInto(url: string, apply: (source: { url: string; title: string; text: string }) => void) {
    setFetching(url);
    setError("");
    try {
      apply((await request<{ source: { url: string; title: string; text: string } }>("/api/optimizer/source", postJson({ url }))).source);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "페이지를 가져오지 못했습니다.");
    } finally {
      setFetching(null);
    }
  }

  function updateSource(index: number, patch: Partial<Source>) {
    setSources((current) => current.map((source, position) => (position === index ? { ...source, ...patch } : source)));
  }

  function addSuggested(url: string, domain: string) {
    if (sources.length >= 5 && sources.every((source) => source.text.trim())) return;
    void fetchInto(url, (fetched) => setSources((current) => {
      const filled = current.filter((source) => source.text.trim());
      return [...filled, { label: domain, url: fetched.url, text: fetched.text }].slice(0, 5);
    }));
  }

  async function start() {
    if (busy || !form.provider) return;
    setBusy(true);
    setError("");
    try {
      const { run } = await request<{ run: Run }>("/api/optimizer", postJson({
        title: form.title, query: form.query, original: form.original, provider: form.provider,
        competitorSources: sources.filter((source) => source.text.trim()).map((source) => ({ label: source.label, url: source.url.trim() || null, text: source.text })),
        allowedSources: lines(form.allowedSources), quotes: lines(form.quotes),
        popsize: form.popsize, generations: form.generations, completions: form.completions, confirmedCalls: estimate,
      }));
      setSelectedId(run.id);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "최적화를 시작하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: number) {
    try { await request(`/api/optimizer/${id}/cancel`, postJson({})); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "취소하지 못했습니다."); }
  }

  async function remove(id: number) {
    try { await request(`/api/optimizer/${id}`, { method: "DELETE" }); if (selectedId === id) setSelectedId(null); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "삭제하지 못했습니다."); }
  }

  const numberField = (key: "popsize" | "generations" | "completions", label: string, min: number, max: number) => (
    <label className="block text-xs">{label}<input type="number" className="mt-1.5" min={min} max={max} value={form[key]} onChange={(event) => setForm({ ...form, [key]: Math.min(max, Math.max(min, Number(event.target.value) || min)) })} /></label>
  );

  return (
    <div>
      <PageHeader eyebrow="FeatGEO lab" title="콘텐츠 최적화 랩" description="경쟁 출처와 함께 가상의 생성형 검색 답변을 만들어 내 콘텐츠가 얼마나 인용되는지 추정하고, 13개 해석 가능한 피처(구조·내용·언어)를 다목적 유전 알고리즘으로 조정해 인용 비중과 품질의 균형점을 찾습니다. 새 수치는 사실 메모에 있는 값만 허용합니다." />
      {error && <p role="alert" className="mb-4 rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-300">{error}</p>}
      <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="space-y-4">
          <label className="block text-xs">실행 이름 (선택)<input className="mt-1.5" maxLength={120} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
          <label className="block text-xs">목표 질문<input className="mt-1.5" maxLength={500} value={form.query} onChange={(event) => setForm({ ...form, query: event.target.value })} placeholder="예: 중소기업용 분석 도구를 추천해 주세요" /></label>
          <label className="block text-xs">내 콘텐츠 (현재 페이지 본문)<textarea className="mt-1.5 min-h-40" maxLength={20000} value={form.original} onChange={(event) => setForm({ ...form, original: event.target.value })} /></label>
          <fieldset className="space-y-3">
            <legend className="text-xs text-slate-300">경쟁 출처 (1~5개)</legend>
            {suggestions.pages.length > 0 && (
              <div className="rounded-xl bg-slate-950/40 p-3 text-xs">
                <p className="text-slate-400">최근 웹검색 측정에서 우리 대신 인용된 페이지</p>
                <div className="mt-2 flex flex-wrap gap-2">{suggestions.pages.slice(0, 6).map((page) => <Button key={page.url} type="button" variant="secondary" disabled={Boolean(fetching)} onClick={() => addSuggested(page.url, page.domain)}><Globe className="h-3.5 w-3.5" />{page.domain}</Button>)}</div>
              </div>
            )}
            {sources.map((source, index) => (
              <div key={index} className="space-y-2 rounded-xl border border-white/8 p-3">
                <div className="flex gap-2">
                  <input aria-label={`출처 ${index + 1} 이름`} placeholder="이름" maxLength={120} value={source.label} onChange={(event) => updateSource(index, { label: event.target.value })} />
                  <input aria-label={`출처 ${index + 1} URL`} placeholder="https://" maxLength={2048} value={source.url} onChange={(event) => updateSource(index, { url: event.target.value })} />
                  <Button type="button" variant="secondary" aria-label={`출처 ${index + 1} 본문 가져오기`} disabled={!source.url.trim() || Boolean(fetching)} onClick={() => void fetchInto(source.url.trim(), (fetched) => updateSource(index, { url: fetched.url, text: fetched.text, label: source.label || fetched.title }))}>{fetching === source.url.trim() ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}</Button>
                  {sources.length > 1 && <Button type="button" variant="secondary" aria-label={`출처 ${index + 1} 삭제`} onClick={() => setSources(sources.filter((_, position) => position !== index))}><X className="h-4 w-4" /></Button>}
                </div>
                <textarea aria-label={`출처 ${index + 1} 본문`} className="min-h-24" maxLength={12000} value={source.text} onChange={(event) => updateSource(index, { text: event.target.value })} placeholder="경쟁 페이지 본문 (URL로 가져오거나 붙여넣기)" />
              </div>
            ))}
            {sources.length < 5 && <Button type="button" variant="secondary" onClick={() => setSources([...sources, { label: "", url: "", text: "" }])}><Plus className="h-4 w-4" />출처 추가</Button>}
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs">언급해도 되는 실제 출처 (줄마다 하나, 선택)<textarea className="mt-1.5 min-h-20" value={form.allowedSources} onChange={(event) => setForm({ ...form, allowedSources: event.target.value })} placeholder="예: 한국소비자원 2026 조사" /></label>
            <label className="block text-xs">써도 되는 실제 인용문 (줄마다 하나, 선택)<textarea className="mt-1.5 min-h-20" value={form.quotes} onChange={(event) => setForm({ ...form, quotes: event.target.value })} /></label>
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="block text-xs">모델<select className="mt-1.5" value={form.provider} onChange={(event) => setForm({ ...form, provider: event.target.value as Provider })} disabled={!providers.length}>{providers.length ? providers.map((provider) => <option key={provider} value={provider}>{providerLabels[provider]}</option>) : <option value="">API 키 없음</option>}</select></label>
            {numberField("popsize", "개체 수", 2, 8)}
            {numberField("generations", "세대 수", 0, 4)}
            {numberField("completions", "시뮬 반복", 1, 3)}
          </div>
          <div className="rounded-xl bg-slate-950/45 p-3 text-xs leading-5 text-slate-400">최대 <strong className="text-slate-200">{estimate}회</strong> LLM 호출 (기준 평가 + 후보 {form.popsize * (1 + form.generations)}개 × 생성·시뮬레이션·품질 평가). 근거 없는 수치가 나온 후보는 평가 호출을 건너뛰어 실제 호출은 더 적을 수 있습니다.</div>
          <Button type="button" className="w-full" disabled={busy || !form.provider || form.query.trim().length < 5 || form.original.trim().length < 30 || !sources.some((source) => source.text.trim().length >= 30)} onClick={() => void start()}>
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}시뮬레이션 실행 (최대 {estimate}회 호출)
          </Button>
        </Card>
        <Card>
          <h2 className="font-semibold text-white">실행 이력</h2>
          {runs.length === 0 ? <div className="mt-3"><EmptyState>아직 실행한 최적화가 없습니다.</EmptyState></div> : (
            <ul className="mt-3 space-y-2">
              {runs.map((run) => {
                const total = run.progress.total ?? 0;
                const evaluated = run.progress.evaluated ?? 0;
                return (
                  <li key={run.id} className={`rounded-xl border p-3 ${run.id === selectedId ? "border-cyan-400/40" : "border-white/8"}`}>
                    <div className="flex items-start justify-between gap-2">
                      <button type="button" className="min-w-0 text-left" onClick={() => setSelectedId(run.id)}>
                        <p className="truncate text-sm text-slate-200">{run.title}</p>
                        <p className="truncate text-xs text-slate-500">{run.query}</p>
                      </button>
                      <div className="flex shrink-0 items-center gap-1">
                        <Badge tone={statusLabels[run.status].tone}>{statusLabels[run.status].label}</Badge>
                        {run.status === "running"
                          ? <Button type="button" variant="secondary" aria-label="실행 취소" onClick={() => void cancel(run.id)}><Square className="h-3.5 w-3.5" /></Button>
                          : <Button type="button" variant="danger" aria-label="실행 삭제" onClick={() => void remove(run.id)}><Trash2 className="h-3.5 w-3.5" /></Button>}
                      </div>
                    </div>
                    {run.status === "running" && <Progress value={total ? (evaluated / total) * 100 : 0} className="mt-2" ariaLabel={`후보 ${evaluated}/${total} 평가`} />}
                    {run.errorCode && <p className="mt-1 text-xs text-slate-500">{run.errorCode === "BUDGET_REACHED" ? "호출 예산에 도달해 일부 후보만 평가했습니다." : `오류: ${run.errorCode}`}</p>}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
      {selected?.result && <section className="mt-6"><OptimizerResult key={selected.id} result={selected.result} /></section>}
    </div>
  );
}
