"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Bot, LoaderCircle, Play, Plus } from "lucide-react";
import { MeasureRunHistoryPanel, notifyMeasureRunChanged, type MeasureRunResource } from "@/components/MeasureRunHistoryPanel";
import { QuestionPoolManager } from "@/components/QuestionPoolManager";
import { Badge, Button, Card, EmptyState, PageHeader, Progress } from "@/components/ui";

type Provider = "openai" | "anthropic" | "gemini" | "grok";
interface SettingsInfo { brandName: string; category: string; repetitions: number; apiKeys: Record<Provider, { configured: boolean }> }
interface ModelMetric { total: number; mentions: number; share: number }
interface RunResult { id: number; title: string; notes: string; status: string; answerShare: number; positiveRate: number; genrank: number; funnelStage: string; total: number; mentions: number; perModel: Record<Provider, ModelMetric>; competitorComparison: { name: string; mentions: number; share: number }[]; createdAt: string; completedAt: string | null }
const labels: Record<Provider, string> = { openai: "GPT", anthropic: "Claude", gemini: "Gemini", grok: "Grok" };
const colors: Record<Provider, string> = { openai: "bg-emerald-400", anthropic: "bg-amber-400", gemini: "bg-violet-400", grok: "bg-rose-400" };

async function json<T>(response: Response): Promise<T> { const data = await response.json() as T & { error?: string }; if (!response.ok) throw new Error(data.error ?? "요청에 실패했습니다."); return data; }

function displayResult(run: MeasureRunResource): RunResult | null {
  if (run.status !== "completed") return null;
  const summary = run.summary;
  const storedMetrics = typeof summary.perModel === "object" && summary.perModel ? summary.perModel as Partial<Record<Provider, ModelMetric>> : {};
  const perModel = Object.fromEntries((Object.keys(labels) as Provider[]).map((provider) => [provider, storedMetrics[provider] ?? { total: 0, mentions: 0, share: 0 }])) as Record<Provider, ModelMetric>;
  const competitorComparison = Array.isArray(summary.competitorComparison)
    ? summary.competitorComparison.filter((item): item is { name: string; mentions: number; share: number } => {
        if (!item || typeof item !== "object") return false;
        const value = item as Record<string, unknown>;
        return typeof value.name === "string" && typeof value.mentions === "number" && typeof value.share === "number";
      })
    : [];
  return {
    id: run.id,
    title: run.title,
    notes: run.notes,
    status: run.status,
    answerShare: run.answerShare,
    positiveRate: typeof summary.positiveRate === "number" ? summary.positiveRate : 0,
    genrank: run.genrank,
    funnelStage: run.funnelStage,
    total: typeof summary.total === "number" ? summary.total : run.resultCount,
    mentions: typeof summary.mentions === "number" ? summary.mentions : 0,
    perModel,
    competitorComparison,
    createdAt: run.createdAt,
    completedAt: run.completedAt,
  };
}

export function ShareClient() {
  const [settings, setSettings] = useState<SettingsInfo | null>(null);
  const [templates, setTemplates] = useState<string[]>([]);
  const [questions, setQuestions] = useState("");
  const [runTitle, setRunTitle] = useState("");
  const requestId = useRef<string | null>(null);
  const [selected, setSelected] = useState<Record<Provider, boolean>>({ openai: false, anthropic: false, gemini: false, grok: false });
  const [repetitions, setRepetitions] = useState(3);
  const [result, setResult] = useState<RunResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { void (async () => { try {
    const [settingsData, shareData] = await Promise.all([json<{ settings: SettingsInfo }>(await fetch("/api/settings")), json<{ templates: string[] }>(await fetch("/api/share"))]);
    setSettings(settingsData.settings); setRepetitions(settingsData.settings.repetitions); setTemplates(shareData.templates);
    setSelected({ openai: settingsData.settings.apiKeys.openai.configured, anthropic: settingsData.settings.apiKeys.anthropic.configured, gemini: settingsData.settings.apiKeys.gemini.configured, grok: settingsData.settings.apiKeys.grok.configured });
  } catch (cause) { setError(cause instanceof Error ? cause.message : "데이터를 불러오지 못했습니다."); } finally { setLoading(false); } })(); }, []);

  const questionList = useMemo(() => questions.split("\n").map((item) => item.trim()).filter(Boolean), [questions]);
  const setMeasurementQuestions = useCallback((value: string) => { setQuestions(value); requestId.current = null; }, []);
  const selectHistoryRun = useCallback((run: MeasureRunResource | null) => {
    if (!run) { setResult(null); return; }
    const display = displayResult(run);
    setResult(display);
    if (!display) setError(`이 측정은 ${run.status} 상태이며 완료된 지표가 없습니다.`);
  }, []);
  function addTemplate(template: string) {
    const value = template.replaceAll("{카테고리}", settings?.category || "카테고리").replace("{문제}", "고객의 핵심 문제");
    setQuestions((current) => current ? `${current}\n${value}` : value);
    requestId.current = null;
  }

  async function run(event: FormEvent) {
    event.preventDefault();
    setRunning(true);
    setError("");
    try {
      const providers = (Object.keys(selected) as Provider[]).filter((provider) => selected[provider]);
      requestId.current ??= crypto.randomUUID();
      const data = await json<{ run: RunResult }>(await fetch("/api/share/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          questions: questionList,
          providers,
          repetitions,
          title: runTitle.trim(),
          clientRequestId: requestId.current,
        }),
      }));
      if (data.run.status === "completed") {
        setResult(data.run);
      } else {
        setResult(null);
        setError(`측정이 ${data.run.status} 상태로 저장되었습니다.`);
      }
      notifyMeasureRunChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "측정에 실패했습니다.");
    } finally {
      setRunning(false);
    }
  }

  if (loading) return <div className="grid min-h-96 place-items-center"><LoaderCircle className="h-7 w-7 animate-spin text-cyan-400" /></div>;
  return <div><PageHeader eyebrow="Answer share" title="응답 점유율 측정" description="브랜드명을 뺀 핵심 질문을 여러 AI에 반복 입력해 언급 빈도, 순위, 문맥과 경쟁사 차이를 기록합니다." action={<Badge tone="cyan">프로젝트 · {settings?.brandName || "미설정"}</Badge>} />
    {!settings?.brandName && <Card className="mb-5 border-amber-400/20 bg-amber-400/5"><p className="flex items-center gap-2 text-sm text-amber-300"><AlertTriangle className="h-4 w-4" />측정 전에 왼쪽 프로젝트 관리에서 브랜드 프로필을 저장하세요.</p></Card>}
    <QuestionPoolManager onUseQuestions={setMeasurementQuestions} />
    <form onSubmit={run} className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
      <Card><div className="mb-4 flex items-center justify-between"><div><h2 className="font-semibold text-white">핵심 질문 세트</h2><p className="mt-1 text-xs text-slate-500">한 줄에 하나 · 최대 30개 · 브랜드/경쟁사명 제외</p></div><Badge>{questionList.length}/30</Badge></div><label className="sr-only" htmlFor="questions">핵심 질문</label><textarea id="questions" required rows={11} value={questions} onChange={(e) => setMeasurementQuestions(e.target.value)} placeholder="국내에서 신뢰할 수 있는 GEO 분석 도구는 무엇인가요?" /><div className="mt-4 flex flex-wrap gap-2">{templates.map((template) => <button type="button" key={template} onClick={() => addTemplate(template)} className="inline-flex items-center gap-1 rounded-lg border border-white/8 bg-white/[0.03] px-2.5 py-1.5 text-left text-[11px] text-slate-400 hover:border-cyan-400/20 hover:text-cyan-300"><Plus className="h-3 w-3" />{template}</button>)}</div></Card>
      <Card><h2 className="font-semibold text-white">실행 설정</h2><label className="mt-4 block text-sm">저장 제목 <span className="text-xs text-slate-600">(선택)</span><input className="mt-2" maxLength={120} value={runTitle} onChange={(event) => { setRunTitle(event.target.value); requestId.current = null; }} placeholder="예: 3월 핵심 질문 측정" /></label><div className="mt-4 space-y-3">{(Object.keys(labels) as Provider[]).map((provider) => { const configured = settings?.apiKeys[provider].configured; return <label key={provider} className={`flex items-center justify-between rounded-xl border p-3 ${selected[provider] ? "border-cyan-400/25 bg-cyan-400/5" : "border-white/7 bg-slate-950/30"}`}><span className="flex items-center gap-3"><input type="checkbox" disabled={!configured} checked={selected[provider]} onChange={(e) => { setSelected((state) => ({ ...state, [provider]: e.target.checked })); requestId.current = null; }} /><Bot className="h-4 w-4 text-slate-500" /><span className="text-sm">{labels[provider]}</span></span><Badge tone={configured ? "good" : "default"}>{configured ? "준비됨" : "키 필요"}</Badge></label>; })}</div><label className="mt-5 block text-sm">질문당 반복<select className="mt-2" value={repetitions} onChange={(e) => { setRepetitions(Number(e.target.value)); requestId.current = null; }}>{[1,2,3,4,5].map((count) => <option value={count} key={count}>{count}회</option>)}</select></label><div className="mt-5 rounded-xl bg-slate-950/45 p-3 text-xs leading-5 text-slate-500">예상 답변 호출: <strong className="text-slate-300">{questionList.length * repetitions * Object.values(selected).filter(Boolean).length}회</strong><br />브랜드가 언급된 응답은 문맥 분류 호출이 추가됩니다.</div><Button className="mt-5 w-full" disabled={running || !questionList.length || questionList.length > 30 || !Object.values(selected).some(Boolean)}>{running ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}{running ? "AI 응답 측정 중…" : "측정 실행"}</Button></Card>
    </form>{error && <p role="alert" className="mt-5 rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-300">{error}</p>}

    {result && <section className="mt-6 space-y-5"><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Card><span className="text-xs text-slate-500">응답 점유율</span><strong className="mt-2 block text-3xl text-white">{result.answerShare}%</strong><Progress value={result.answerShare} className="mt-3" /></Card><Card><span className="text-xs text-slate-500">GenRank</span><strong className="mt-2 block text-3xl text-white">{result.genrank}</strong><p className="mt-2 text-xs text-slate-600">순위 로그 할인·모델 가중</p></Card><Card><span className="text-xs text-slate-500">긍정 문맥</span><strong className="mt-2 block text-3xl text-white">{result.positiveRate}%</strong><p className="mt-2 text-xs text-slate-600">언급된 응답 기준</p></Card><Card><span className="text-xs text-slate-500">퍼널 단계</span><strong className="mt-2 block text-3xl text-cyan-300">{result.funnelStage}</strong><p className="mt-2 text-xs text-slate-600">{result.mentions}/{result.total}회 언급</p></Card></div><div className="grid gap-5 lg:grid-cols-2"><Card><h2 className="mb-5 font-semibold text-white">모델별 차이</h2><div className="space-y-4">{(Object.keys(labels) as Provider[]).map((provider) => { const metric = result.perModel[provider]; return <div key={provider}><div className="mb-1.5 flex justify-between text-xs"><span className="text-slate-400">{labels[provider]} · {metric.mentions}/{metric.total}</span><strong className="text-slate-200">{metric.share.toFixed(1)}%</strong></div><div className="h-2 rounded-full bg-slate-800"><div className={`h-full rounded-full ${colors[provider]}`} style={{ width: `${metric.share}%` }} /></div></div>; })}</div></Card><Card><h2 className="mb-5 font-semibold text-white">경쟁사 비교</h2>{result.competitorComparison.length ? <div className="space-y-3">{result.competitorComparison.map((item) => <div key={item.name} className="flex items-center justify-between rounded-xl bg-slate-950/40 p-3"><span className="text-sm text-slate-300">{item.name}</span><span className="text-sm font-bold text-white">{item.share.toFixed(1)}% <small className="font-normal text-slate-600">({item.mentions}회)</small></span></div>)}</div> : <EmptyState>설정된 경쟁사가 없습니다.</EmptyState>}</Card></div></section>}

    <MeasureRunHistoryPanel onSelect={selectHistoryRun} />
  </div>;
}
