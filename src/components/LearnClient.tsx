"use client";

import { useEffect, useMemo, useState } from "react";
import { BookOpen, CheckCircle2, ChevronRight, GraduationCap, LoaderCircle } from "lucide-react";
import { Badge, Card, PageHeader, Progress } from "@/components/ui";
import { CASE_STUDIES, GEO_PRINCIPLES, GEO_TOOLS, LEARN_CHECKLIST, LEARN_CONCEPTS, PARADIGM_SHIFTS, TERM_MAP } from "@/lib/learn-content";

async function json<T>(response: Response): Promise<T> { const data = await response.json() as T & { error?: string }; if (!response.ok) throw new Error(data.error ?? "요청에 실패했습니다."); return data; }

export function LearnClient() {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = async () => {
    const data = await json<{ checklist: { items: { id: string; checked: boolean; note: string }[] } }>(await fetch("/api/checklist"));
    setChecked(Object.fromEntries(data.checklist.items.map((item) => [item.id, item.checked])));
    setNotes(Object.fromEntries(data.checklist.items.map((item) => [item.id, item.note ?? ""])));
  };
  useEffect(() => {
    void (async () => {
      try { await load(); }
      catch (cause) { setError(cause instanceof Error ? cause.message : "체크리스트를 불러오지 못했습니다."); }
      finally { setLoading(false); }
    })();
    const onProject = () => { void load().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "체크리스트를 불러오지 못했습니다.")); };
    window.addEventListener("geo-master:project-changed", onProject);
    return () => window.removeEventListener("geo-master:project-changed", onProject);
  }, []);
  const completed = Object.values(checked).filter(Boolean).length;
  const grouped = useMemo(() => Object.groupBy(LEARN_CHECKLIST, (item) => item.category), []);
  async function toggle(id: string, value: boolean) {
    const before = checked[id] ?? false;
    setChecked((state) => ({ ...state, [id]: value }));
    setError("");
    try { await json(await fetch("/api/checklist", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ itemKey: id, checked: value }) })); }
    catch (cause) { setChecked((state) => ({ ...state, [id]: before })); setError(cause instanceof Error ? cause.message : "저장하지 못했습니다."); }
  }
  async function saveNote(id: string, note: string) {
    try { await json(await fetch("/api/checklist", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ itemKey: id, note }) })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "메모를 저장하지 못했습니다."); }
  }
  async function reset(payload: { reset: "item" | "category" | "all"; itemKey?: string; category?: string }) {
    try {
      const data = await json<{ checklist: { items: { id: string; checked: boolean; note: string }[] } }>(await fetch("/api/checklist", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }));
      setChecked(Object.fromEntries(data.checklist.items.map((item) => [item.id, item.checked])));
      setNotes(Object.fromEntries(data.checklist.items.map((item) => [item.id, item.note ?? ""])));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "초기화하지 못했습니다."); }
  }
  return <div><PageHeader eyebrow="GEO playbook" title="학습 센터" description="제로클릭 시대의 핵심 개념을 빠르게 익히고, 지식을 실제 실행 체크리스트로 전환하세요." action={<Badge tone="cyan"><GraduationCap className="mr-1 h-3.5 w-3.5" />실행형 요약</Badge>} />
    <section className="grid gap-4 md:grid-cols-2">{LEARN_CONCEPTS.map((concept, index) => <Card key={concept.title} className="relative overflow-hidden"><span className="absolute right-4 top-3 text-5xl font-black text-white/[0.025]">0{index + 1}</span><BookOpen className="h-5 w-5 text-cyan-400" /><h2 className="mt-4 text-lg font-semibold text-white">{concept.title}</h2><p className="mt-2 text-sm leading-6 text-slate-400">{concept.summary}</p></Card>)}</section>
    <section className="mt-6 grid gap-5 xl:grid-cols-[1.2fr_0.8fr]"><Card><div className="mb-5"><p className="text-xs font-bold uppercase tracking-widest text-violet-300">Framework 1.0</p><h2 className="mt-1 text-xl font-semibold text-white">GEO 7가지 도구</h2></div><div className="grid gap-3 sm:grid-cols-2">{GEO_TOOLS.map(([name, description], index) => <div key={name} className="rounded-xl border border-white/7 bg-slate-950/35 p-4"><div className="flex items-center gap-2"><span className="grid h-6 w-6 place-items-center rounded-lg bg-violet-400/10 text-xs font-bold text-violet-300">{index + 1}</span><strong className="text-sm text-slate-200">{name}</strong></div><p className="mt-2 text-xs leading-5 text-slate-500">{description}</p></div>)}</div></Card><Card><h2 className="text-xl font-semibold text-white">실행 6원칙</h2><div className="mt-4 space-y-3">{GEO_PRINCIPLES.map((principle, index) => <div key={principle} className="flex gap-3"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" /><p className="text-sm leading-5 text-slate-400"><span className="mr-1 text-xs text-slate-600">{index + 1}.</span>{principle}</p></div>)}</div><h3 className="mt-7 font-semibold text-white">패러다임 시프트 7</h3><div className="mt-3 flex flex-wrap gap-2">{PARADIGM_SHIFTS.map((shift) => <Badge key={shift}>{shift}</Badge>)}</div></Card></section>
    <section className="mt-6 grid gap-5 lg:grid-cols-2"><Card><h2 className="mb-4 text-lg font-semibold text-white">SEO → GEO 용어 대조</h2><div className="divide-y divide-white/5">{TERM_MAP.map(([seo, geo]) => <div key={seo} className="grid grid-cols-[1fr_auto_1.3fr] items-center gap-3 py-3 text-sm"><span className="text-slate-500">{seo}</span><ChevronRight className="h-3.5 w-3.5 text-cyan-700" /><strong className="text-cyan-200">{geo}</strong></div>)}</div></Card><Card><h2 className="mb-4 text-lg font-semibold text-white">케이스 스터디</h2><div className="space-y-3">{CASE_STUDIES.map(([name, lesson]) => <div key={name} className="rounded-xl bg-slate-950/40 p-4"><strong className="text-sm text-slate-200">{name}</strong><p className="mt-1.5 text-xs leading-5 text-slate-500">{lesson}</p></div>)}</div></Card></section>
    <section className="mt-7"><Card className="border-cyan-400/10"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-widest text-cyan-400">Execution checklist</p><h2 className="mt-1 text-2xl font-semibold text-white">38항목 실행 체크리스트</h2><p className="mt-2 text-sm text-slate-500">완료 상태와 메모는 활성 프로젝트 SQLite에 저장됩니다.</p></div><div className="flex items-end gap-3"><div className="min-w-44 rounded-xl bg-slate-950/50 p-4"><div className="flex items-end justify-between"><strong className="text-2xl text-white">{completed}<span className="text-sm text-slate-600"> / 38</span></strong><span className="text-xs text-cyan-300">{Math.round((completed / 38) * 100)}%</span></div><Progress value={(completed / 38) * 100} className="mt-3" /></div><button type="button" className="mb-1 text-xs text-slate-500 hover:text-rose-300" onClick={() => void reset({ reset: "all" })}>전체 초기화</button></div></div>{loading ? <div className="grid h-48 place-items-center"><LoaderCircle className="animate-spin text-cyan-400" /></div> : <div className="mt-7 grid gap-5 lg:grid-cols-2">{Object.entries(grouped).map(([category, items]) => <div key={category} className="rounded-xl border border-white/7 bg-slate-950/30 p-4"><div className="mb-3 flex items-center justify-between gap-2"><h3 className="font-semibold text-slate-200">{category}</h3><div className="flex items-center gap-2"><Badge>{items?.filter((item) => checked[item.id]).length}/{items?.length}</Badge><button type="button" className="text-[10px] text-slate-600 hover:text-rose-300" onClick={() => void reset({ reset: "category", category })}>카테고리 초기화</button></div></div><div className="space-y-1">{items?.map((item) => <div key={item.id} className="rounded-lg p-2.5 hover:bg-white/[0.03]"><label className={`flex cursor-pointer items-start gap-3 text-sm ${checked[item.id] ? "text-slate-500 line-through" : "text-slate-300"}`}><input className="mt-0.5 shrink-0" type="checkbox" checked={Boolean(checked[item.id])} onChange={(e) => void toggle(item.id, e.target.checked)} />{item.label}</label><input className="mt-2 w-full rounded-lg border border-white/8 bg-slate-950/40 px-2 py-1 text-[11px] text-slate-400" value={notes[item.id] ?? ""} placeholder="실행 메모" onChange={(e) => setNotes((state) => ({ ...state, [item.id]: e.target.value }))} onBlur={(e) => void saveNote(item.id, e.target.value)} /></div>)}</div></div>)}</div>}{error && <p role="alert" className="mt-4 text-sm text-rose-300">{error}</p>}</Card></section>
  </div>;
}
