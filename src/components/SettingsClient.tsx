"use client";

import { FormEvent, useEffect, useState } from "react";
import { CheckCircle2, KeyRound, LoaderCircle, Save, ShieldCheck } from "lucide-react";
import { Badge, Button, Card, PageHeader } from "@/components/ui";

const providerInfo = {
  openai: { label: "OpenAI", hint: "sk-...", color: "text-emerald-300" },
  anthropic: { label: "Anthropic", hint: "sk-ant-...", color: "text-amber-300" },
  gemini: { label: "Google Gemini", hint: "AIza...", color: "text-violet-300" },
} as const;
type Provider = keyof typeof providerInfo;
interface KeyState { configured: boolean; preview: string | null; error: boolean }
interface SettingsState {
  brandName: string; category: string; competitors: string[];
  models: Record<Provider, string>; repetitions: number; modelWeights: Record<Provider, number>;
  apiKeys: Record<Provider, KeyState>; updatedAt?: string;
}
const initial: SettingsState = { brandName: "", category: "", competitors: [], models: { openai: "gpt-4.1-mini", anthropic: "claude-sonnet-4-5", gemini: "gemini-2.5-flash" }, repetitions: 3, modelWeights: { openai: .4, anthropic: .35, gemini: .25 }, apiKeys: { openai: { configured: false, preview: null, error: false }, anthropic: { configured: false, preview: null, error: false }, gemini: { configured: false, preview: null, error: false } } };

async function parseResponse<T>(response: Response): Promise<T> { const body = await response.json() as T & { error?: string }; if (!response.ok) throw new Error(body.error ?? "요청에 실패했습니다."); return body; }

export function SettingsClient() {
  const [settings, setSettings] = useState(initial);
  const [competitors, setCompetitors] = useState("");
  const [keys, setKeys] = useState<Record<Provider, string>>({ openai: "", anthropic: "", gemini: "" });
  const [clearKeys, setClearKeys] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => { void (async () => { try { const data = await parseResponse<{ settings: SettingsState }>(await fetch("/api/settings")); setSettings(data.settings); setCompetitors(data.settings.competitors.join(", ")); } catch (cause) { setError(cause instanceof Error ? cause.message : "설정을 불러오지 못했습니다."); } finally { setLoading(false); } })(); }, []);

  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError(""); setMessage("");
    try {
      const apiKeys = Object.fromEntries(Object.entries(keys).filter(([, value]) => value.trim())) as Partial<Record<Provider, string>>;
      const response = await fetch("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({
        brandName: settings.brandName, category: settings.category,
        competitors: competitors.split(",").map((item) => item.trim()).filter(Boolean),
        models: settings.models, repetitions: settings.repetitions, modelWeights: settings.modelWeights,
        apiKeys, clearApiKeys: clearKeys,
      }) });
      const data = await parseResponse<{ settings: SettingsState }>(response);
      setSettings(data.settings); setCompetitors(data.settings.competitors.join(", ")); setKeys({ openai: "", anthropic: "", gemini: "" }); setClearKeys([]); setMessage("설정이 안전하게 저장되었습니다.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "저장에 실패했습니다."); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="grid min-h-96 place-items-center"><LoaderCircle className="h-7 w-7 animate-spin text-cyan-400" /></div>;
  return <div><PageHeader eyebrow="Workspace config" title="설정" description="브랜드 프로필과 측정 기본값을 관리합니다. API 키는 서버에서 AES-256-GCM으로 암호화되어 로컬 SQLite에만 저장됩니다." />
    <form onSubmit={submit} className="space-y-5">
      <Card><div className="mb-5 flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-cyan-400/10"><ShieldCheck className="h-4 w-4 text-cyan-300" /></span><div><h2 className="font-semibold text-white">브랜드 프로필</h2><p className="text-xs text-slate-500">측정 질문에는 브랜드명을 넣지 않습니다.</p></div></div><div className="grid gap-4 md:grid-cols-2"><label className="text-sm">브랜드명<input className="mt-2" required value={settings.brandName} onChange={(e) => setSettings((s) => ({ ...s, brandName: e.target.value }))} placeholder="예: GEO Master" /></label><label className="text-sm">카테고리<input className="mt-2" required value={settings.category} onChange={(e) => setSettings((s) => ({ ...s, category: e.target.value }))} placeholder="예: GEO 분석 SaaS" /></label><label className="text-sm md:col-span-2">경쟁사 <span className="text-xs text-slate-600">(쉼표로 구분)</span><input className="mt-2" value={competitors} onChange={(e) => setCompetitors(e.target.value)} placeholder="경쟁사 A, 경쟁사 B" /></label></div></Card>
      <Card><div className="mb-5 flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-violet-400/10"><KeyRound className="h-4 w-4 text-violet-300" /></span><div><h2 className="font-semibold text-white">LLM API 키</h2><p className="text-xs text-slate-500">빈 입력은 기존 키를 유지합니다. 공개 API는 평문을 반환하지 않습니다.</p></div></div><div className="grid gap-4 xl:grid-cols-3">{(Object.keys(providerInfo) as Provider[]).map((provider) => { const info = providerInfo[provider]; const state = settings.apiKeys[provider]; return <div key={provider} className="rounded-xl border border-white/7 bg-slate-950/35 p-4"><div className="mb-3 flex items-center justify-between"><span className={`text-sm font-bold ${info.color}`}>{info.label}</span>{state.error ? <Badge tone="bad">복호화 오류</Badge> : state.configured ? <Badge tone="good">{state.preview ?? "저장됨"}</Badge> : <Badge>미설정</Badge>}</div><label className="text-xs text-slate-500">새 API 키<input className="mt-2" type="password" autoComplete="off" value={keys[provider]} onChange={(e) => setKeys((current) => ({ ...current, [provider]: e.target.value }))} placeholder={info.hint} /></label>{state.configured && <label className="mt-3 flex items-center gap-2 text-xs text-rose-300"><input type="checkbox" checked={clearKeys.includes(provider)} onChange={(e) => setClearKeys((items) => e.target.checked ? [...items, provider] : items.filter((item) => item !== provider))} />저장된 키 삭제</label>}</div>; })}</div></Card>
      <Card><h2 className="mb-5 font-semibold text-white">모델과 측정 기본값</h2><div className="grid gap-4 xl:grid-cols-3">{(Object.keys(providerInfo) as Provider[]).map((provider) => <div key={provider}><label className="text-sm">{providerInfo[provider].label} 모델<input className="mt-2" value={settings.models[provider]} onChange={(e) => setSettings((s) => ({ ...s, models: { ...s.models, [provider]: e.target.value } }))} /></label><label className="mt-3 block text-xs text-slate-500">가중치 ({Math.round(settings.modelWeights[provider] * 100)}%)<input className="mt-2" type="range" min="0" max="1" step="0.05" value={settings.modelWeights[provider]} onChange={(e) => setSettings((s) => ({ ...s, modelWeights: { ...s.modelWeights, [provider]: Number(e.target.value) } }))} /></label></div>)}</div><label className="mt-5 block max-w-xs text-sm">질문당 반복 횟수<select className="mt-2" value={settings.repetitions} onChange={(e) => setSettings((s) => ({ ...s, repetitions: Number(e.target.value) }))}>{[1,2,3,4,5].map((value) => <option key={value} value={value}>{value}회</option>)}</select></label></Card>
      {error && <p role="alert" className="rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-300">{error}</p>}{message && <p className="flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-300"><CheckCircle2 className="h-4 w-4" />{message}</p>}
      <div className="flex justify-end"><Button disabled={saving} className="min-w-36">{saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{saving ? "저장 중" : "설정 저장"}</Button></div>
    </form>
  </div>;
}
