"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { CalendarDays, CheckCircle2, Circle, GitBranch, LayoutList, LoaderCircle, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { ConfirmDialog, DetailDrawer } from "@/components/CrudPrimitives";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui";
import { listGeoPrompts } from "@/lib/geo-prompt-catalog";

type ItemType = "question" | "pillar" | "cluster" | "supporting" | "calendar" | "cycle";
type Tab = "question" | "cluster" | "calendar" | "cycle";
interface StrategyItem {
  id: number; projectId: number; parentId: number | null; type: ItemType; title: string;
  status: "계획" | "진행" | "완료"; data: Record<string, string | number | boolean | null>;
  createdAt: string; updatedAt: string;
}
interface Guide { sources: string[]; intents: string[]; journeyStages: string[]; calendar: string[]; cycle: string[] }
const tabInfo: { id: Tab; label: string; icon: typeof LayoutList }[] = [
  { id: "question", label: "질문 매핑", icon: LayoutList },
  { id: "cluster", label: "토픽 클러스터", icon: GitBranch },
  { id: "calendar", label: "콘텐츠 캘린더", icon: CalendarDays },
  { id: "cycle", label: "4주 사이클", icon: RotateCcw },
];
const emptyGuide: Guide = { sources: [], intents: [], journeyStages: [], calendar: [], cycle: [] };
const projectChangedEvent = "geo-master:project-changed";
async function json<T>(response: Response): Promise<T> {
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "요청에 실패했습니다.");
  return data;
}

export function StrategyClient() {
  const [tab, setTab] = useState<Tab>("question");
  const [items, setItems] = useState<StrategyItem[]>([]);
  const [guide, setGuide] = useState(emptyGuide);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [subtype, setSubtype] = useState<ItemType>("pillar");
  const [source, setSource] = useState("");
  const [intent, setIntent] = useState("");
  const [segment, setSegment] = useState("");
  const [journey, setJourney] = useState("");
  const [parentId, setParentId] = useState<number | "">("");
  const [month, setMonth] = useState("");
  const [focus, setFocus] = useState("");
  const [week, setWeek] = useState(1);
  const [editing, setEditing] = useState<StrategyItem | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editStatus, setEditStatus] = useState<StrategyItem["status"]>("계획");
  const [editParentId, setEditParentId] = useState<number | "">("");
  const [editSource, setEditSource] = useState("");
  const [editIntent, setEditIntent] = useState("");
  const [editSegment, setEditSegment] = useState("");
  const [editJourney, setEditJourney] = useState("");
  const [editMonth, setEditMonth] = useState("");
  const [editFocus, setEditFocus] = useState("");
  const [editWeek, setEditWeek] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<StrategyItem | null>(null);

  const load = async () => {
    const data = await json<{ items: StrategyItem[]; page: { hasMore: boolean }; guide: Guide }>(await fetch("/api/strategy?limit=100"));
    setItems(data.items);
    setGuide(data.guide);
    setSource((current) => current || data.guide.sources[0] || "");
    setIntent((current) => current || data.guide.intents[0] || "");
    setJourney((current) => current || data.guide.journeyStages[0] || "");
    setFocus((current) => current || data.guide.calendar[0] || "");
  };

  useEffect(() => {
    void (async () => {
      try { await load(); }
      catch (cause) { setError(cause instanceof Error ? cause.message : "전략을 불러오지 못했습니다."); }
      finally { setLoading(false); }
    })();
    const onProject = () => { void load().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "전략을 불러오지 못했습니다.")); };
    window.addEventListener(projectChangedEvent, onProject);
    return () => window.removeEventListener(projectChangedEvent, onProject);
  }, []);

  const visible = useMemo(() => tab === "cluster" ? items.filter((item) => ["pillar", "cluster", "supporting"].includes(item.type)) : items.filter((item) => item.type === tab), [items, tab]);
  const parents = items.filter((item) => subtype === "cluster" ? item.type === "pillar" : item.type === "pillar" || item.type === "cluster");

  async function create(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      let type: ItemType = tab;
      let data: StrategyItem["data"] = {};
      let nextParent: number | null = null;
      if (tab === "question") data = { source, intent, segment: segment || "전체", journey };
      if (tab === "cluster") {
        type = subtype;
        nextParent = subtype === "pillar" || parentId === "" ? null : Number(parentId);
        data = { gap: subtype !== "pillar" && !nextParent };
      }
      if (tab === "calendar") data = { month, focus };
      if (tab === "cycle") data = { week, activity: guide.cycle[week - 1] ?? "" };
      const response = await json<{ item: StrategyItem }>(await fetch("/api/strategy", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type,
          title: title || (tab === "cycle" ? `${week}주차 · ${guide.cycle[week - 1]}` : ""),
          parentId: nextParent,
          data,
        }),
      }));
      setItems((current) => [response.item, ...current]);
      setTitle(""); setParentId("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "저장하지 못했습니다."); }
    finally { setSaving(false); }
  }

  async function cycleStatus(item: StrategyItem) {
    const next = item.status === "계획" ? "진행" : item.status === "진행" ? "완료" : "계획";
    try {
      const data = await json<{ item: StrategyItem }>(await fetch("/api/strategy", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: item.id, status: next, expectedUpdatedAt: item.updatedAt }),
      }));
      setItems((current) => current.map((entry) => entry.id === item.id ? data.item : entry));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "상태를 바꾸지 못했습니다."); }
  }

  function startEdit(item: StrategyItem) {
    setEditing(item);
    setEditTitle(item.title);
    setEditStatus(item.status);
    setEditParentId(item.parentId ?? "");
    setEditSource(String(item.data.source ?? guide.sources[0] ?? ""));
    setEditIntent(String(item.data.intent ?? guide.intents[0] ?? ""));
    setEditSegment(String(item.data.segment ?? "전체"));
    setEditJourney(String(item.data.journey ?? guide.journeyStages[0] ?? ""));
    setEditMonth(String(item.data.month ?? ""));
    setEditFocus(String(item.data.focus ?? guide.calendar[0] ?? ""));
    setEditWeek(Number(item.data.week ?? 1));
  }

  const editParents = editing
    ? items.filter((item) => {
      if (item.id === editing.id) return false;
      if (editing.type === "cluster") return item.type === "pillar";
      if (editing.type === "supporting") return item.type === "pillar" || item.type === "cluster";
      return false;
    })
    : [];

  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    try {
      let data: StrategyItem["data"] | undefined;
      let nextParent: number | null | undefined;
      if (editing.type === "question") data = { source: editSource, intent: editIntent, segment: editSegment || "전체", journey: editJourney };
      if (editing.type === "calendar") data = { month: editMonth, focus: editFocus };
      if (editing.type === "cycle") data = { week: editWeek, activity: guide.cycle[editWeek - 1] ?? String(editing.data.activity ?? "") };
      if (editing.type === "cluster" || editing.type === "supporting") {
        nextParent = editParentId === "" ? null : Number(editParentId);
        data = { gap: !nextParent };
      }
      if (editing.type === "pillar") nextParent = null;
      const response = await json<{ item: StrategyItem }>(await fetch("/api/strategy", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: editing.id, title: editTitle, status: editStatus, parentId: nextParent, data, expectedUpdatedAt: editing.updatedAt,
        }),
      }));
      setItems((current) => current.map((entry) => entry.id === response.item.id ? response.item : entry));
      setEditing(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "수정하지 못했습니다."); }
  }

  async function remove() {
    if (!deleteTarget) return;
    try {
      const response = await fetch(`/api/strategy?id=${deleteTarget.id}`, {
        method: "DELETE", headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedUpdatedAt: deleteTarget.updatedAt, cascadeConfirmed: true }),
      });
      if (!response.ok) throw new Error("삭제하지 못했습니다.");
      setItems((current) => current.filter((item) => item.id !== deleteTarget.id).map((item) => item.parentId === deleteTarget.id ? { ...item, parentId: null } : item));
      setDeleteTarget(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "삭제하지 못했습니다."); }
  }

  const parentTitle = (item: StrategyItem) => items.find((entry) => entry.id === item.parentId)?.title;
  const statusTone = (status: StrategyItem["status"]) => status === "완료" ? "good" : status === "진행" ? "cyan" : "default";
  if (loading) return <div className="grid min-h-96 place-items-center"><LoaderCircle className="h-7 w-7 animate-spin text-cyan-400" /></div>;
  return <div>
    <PageHeader eyebrow="Strategy system" title="전략 워크스페이스" description="질문을 의도·고객·여정으로 분류하고, 토픽 생태계와 월별 계획, 반복 개선 루프까지 연결합니다. RankSEO·Glippy 인사이트는 질문 소스·실행 메모에만 붙여 넣고, 인용 성과는 /share로 검증하세요." />
    <Card className="mb-5 border-cyan-400/10">
      <p className="text-xs font-bold uppercase tracking-widest text-cyan-400">Prompt playbook · 1클릭 시드</p>
      <p className="mt-1 text-xs text-slate-500">로컬 카탈로그입니다. 선택하면 제목·유형이 채워지며, 본문 스펙은 SEMForge GEO Blocks에서 생성하세요.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {listGeoPrompts("strategy").map((prompt) => (
          <button
            key={prompt.id}
            type="button"
            className="rounded-lg border border-white/8 bg-slate-950/40 px-2.5 py-1.5 text-left text-[11px] text-slate-400 hover:border-cyan-400/25 hover:text-cyan-200"
            onClick={() => {
              if (prompt.strategySeed?.type === "question") setTab("question");
              else setTab("cluster");
              if (prompt.strategySeed?.type === "pillar" || prompt.strategySeed?.type === "cluster") setSubtype(prompt.strategySeed.type);
              setTitle(prompt.strategySeed?.title ?? prompt.title);
            }}
          >
            {prompt.title}
          </button>
        ))}
        <a href="/geo-blocks" className="rounded-lg border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1.5 text-[11px] font-semibold text-cyan-200">GEO Blocks에서 초안 →</a>
      </div>
    </Card>
    <div className="mb-5 flex gap-2 overflow-x-auto pb-1">{tabInfo.map(({ id, label, icon: Icon }) => <button type="button" key={id} onClick={() => setTab(id)} className={`inline-flex shrink-0 items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold ${tab === id ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-300" : "border-white/7 bg-slate-900/50 text-slate-500"}`}><Icon className="h-4 w-4" />{label}</button>)}</div>
    <Card>
      <form onSubmit={create}>
        <div className="grid gap-3 lg:grid-cols-6">
          {tab !== "cycle" && <label className="lg:col-span-2 text-xs">{tab === "question" ? "고객 질문" : tab === "cluster" ? "콘텐츠 주제" : "콘텐츠 제목"}<input className="mt-1.5" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder={tab === "question" ? "고객이 실제로 묻는 질문" : "항목 제목"} /></label>}
          {tab === "question" && <>
            <label className="text-xs">질문 소스 <span className="text-slate-600">(외부 연구 포함)</span><select className="mt-1.5" value={source} onChange={(e) => setSource(e.target.value)}>{guide.sources.map((value) => <option key={value}>{value}</option>)}</select></label>
            <label className="text-xs">의도<select className="mt-1.5" value={intent} onChange={(e) => setIntent(e.target.value)}>{guide.intents.map((value) => <option key={value}>{value}</option>)}</select></label>
            <label className="text-xs">고객 세그먼트<input className="mt-1.5" value={segment} onChange={(e) => setSegment(e.target.value)} placeholder="예: B2B 마케터" /></label>
            <label className="text-xs">구매 단계<select className="mt-1.5" value={journey} onChange={(e) => setJourney(e.target.value)}>{guide.journeyStages.map((value) => <option key={value}>{value}</option>)}</select></label>
          </>}
          {tab === "cluster" && <>
            <label className="text-xs">유형<select className="mt-1.5" value={subtype} onChange={(e) => { setSubtype(e.target.value as ItemType); setParentId(""); }}><option value="pillar">Pillar</option><option value="cluster">Cluster</option><option value="supporting">Supporting</option></select></label>
            <label className="lg:col-span-2 text-xs">상위 주제 <span className="text-slate-600">(Pillar 제외)</span>
              <select className="mt-1.5" disabled={subtype === "pillar"} value={parentId} onChange={(e) => setParentId(e.target.value ? Number(e.target.value) : "")}>
                <option value="">상위 주제 선택</option>
                {parents.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
              </select>
            </label>
          </>}
          {tab === "calendar" && <>
            <label className="text-xs">발행 월<input className="mt-1.5" type="month" required value={month} onChange={(e) => setMonth(e.target.value)} /></label>
            <label className="lg:col-span-2 text-xs">월간 초점<select className="mt-1.5" value={focus} onChange={(e) => setFocus(e.target.value)}>{guide.calendar.map((value) => <option key={value}>{value}</option>)}</select></label>
          </>}
          {tab === "cycle" && <>
            <label className="lg:col-span-2 text-xs">주차<select className="mt-1.5" value={week} onChange={(e) => setWeek(Number(e.target.value))}>{guide.cycle.map((value, index) => <option key={value} value={index + 1}>{index + 1}주차 · {value}</option>)}</select></label>
            <label className="lg:col-span-3 text-xs">이번 실행 메모 <span className="text-slate-600">(외부 연구 인사이트 포함 가능)</span><input className="mt-1.5" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="이번 주에 완료할 작업 · RankSEO/Glippy 힌트 반영" /></label>
          </>}
          <div className="flex items-end"><Button className="w-full" disabled={saving}>{saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}추가</Button></div>
        </div>
      </form>
      {error && <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p>}
    </Card>
    <section className="mt-5">
      {tab === "question" && <Card className="overflow-hidden p-0"><div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm"><thead className="bg-slate-950/60 text-xs text-slate-500"><tr><th className="p-4">질문</th><th className="p-4">소스</th><th className="p-4">의도</th><th className="p-4">세그먼트</th><th className="p-4">여정</th><th className="p-4">상태</th><th /></tr></thead><tbody className="divide-y divide-white/5">{visible.map((item) => <tr key={item.id}><td className="p-4 font-medium text-slate-200">{item.title}</td><td className="p-4 text-slate-500">{String(item.data.source)}</td><td className="p-4"><Badge>{String(item.data.intent)}</Badge></td><td className="p-4 text-slate-500">{String(item.data.segment)}</td><td className="p-4 text-slate-500">{String(item.data.journey)}</td><td className="p-4"><button onClick={() => void cycleStatus(item)}><Badge tone={statusTone(item.status)}>{item.status}</Badge></button></td><td className="p-4"><div className="flex"><button onClick={() => startEdit(item)} aria-label="수정"><Pencil className="h-4 w-4 text-slate-600 hover:text-cyan-300" /></button><button onClick={() => setDeleteTarget(item)} aria-label="삭제"><Trash2 className="h-4 w-4 text-slate-700 hover:text-rose-400" /></button></div></td></tr>)}</tbody></table></div>{!visible.length && <EmptyState>20~30개의 실제 고객 질문을 수집해 분류하세요.</EmptyState>}</Card>}
      {tab === "cluster" && <div className="grid gap-4 lg:grid-cols-3">{(["pillar", "cluster", "supporting"] as ItemType[]).map((type) => <Card key={type}><div className="mb-4 flex items-center justify-between"><h2 className="font-semibold capitalize text-white">{type}</h2><Badge>{visible.filter((item) => item.type === type).length}</Badge></div><div className="space-y-3">{visible.filter((item) => item.type === type).map((item) => <div key={item.id} className="rounded-xl border border-white/7 bg-slate-950/40 p-3"><div className="flex items-start justify-between gap-2"><div><p className="text-sm font-medium text-slate-200">{item.title}</p>{parentTitle(item) && <p className="mt-1 text-[11px] text-slate-600">↳ {parentTitle(item)}</p>}{item.data.gap && <Badge tone="warn" className="mt-2">연결 공백</Badge>}</div><div className="flex"><button onClick={() => startEdit(item)} aria-label="수정"><Pencil className="h-3.5 w-3.5 text-slate-600" /></button><button onClick={() => setDeleteTarget(item)} aria-label="삭제"><Trash2 className="h-3.5 w-3.5 text-slate-700" /></button></div></div></div>)}</div>{!visible.some((item) => item.type === type) && <EmptyState>아직 항목이 없습니다.</EmptyState>}</Card>)}</div>}
      {tab === "calendar" && <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{visible.map((item) => <Card key={item.id}><div className="flex items-start justify-between"><div><Badge tone="cyan">{String(item.data.month)}</Badge><h2 className="mt-3 font-semibold text-white">{item.title}</h2><p className="mt-2 text-sm text-slate-500">{String(item.data.focus)}</p></div><div className="flex"><button onClick={() => startEdit(item)} aria-label="수정"><Pencil className="h-4 w-4 text-slate-600" /></button><button onClick={() => setDeleteTarget(item)} aria-label="삭제"><Trash2 className="h-4 w-4 text-slate-700" /></button></div></div><button onClick={() => void cycleStatus(item)} className="mt-5"><Badge tone={statusTone(item.status)}>{item.status} · 변경</Badge></button></Card>)}{!visible.length && <EmptyState>기반 구축→세그먼트 확장→문제 해결→지원 자료→업데이트→공백 보완 순환으로 계획하세요.</EmptyState>}</div>}
      {tab === "cycle" && <div className="grid gap-4 lg:grid-cols-4">{guide.cycle.map((activity, index) => { const weekItems = visible.filter((item) => Number(item.data.week) === index + 1); return <Card key={activity} className={weekItems.some((item) => item.status === "완료") ? "border-emerald-400/15" : ""}><div className="flex items-center gap-3"><span className="grid h-8 w-8 place-items-center rounded-full bg-cyan-400/10 text-xs font-bold text-cyan-300">{index + 1}</span><div><p className="text-[10px] text-slate-600">{index + 1}주차</p><h2 className="font-semibold text-white">{activity}</h2></div></div><div className="mt-4 space-y-2">{weekItems.map((item) => <div key={item.id} className="rounded-xl bg-slate-950/40 p-3"><button className="flex w-full items-start gap-2 text-left" onClick={() => void cycleStatus(item)}>{item.status === "완료" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-slate-600" />}<span className="text-xs leading-5 text-slate-400">{item.title}</span></button><div className="mt-2 flex gap-2"><button type="button" onClick={() => startEdit(item)} className="text-[10px] text-slate-600 hover:text-cyan-300">수정</button><button type="button" onClick={() => setDeleteTarget(item)} className="text-[10px] text-slate-700 hover:text-rose-400">삭제</button></div></div>)}</div>{!weekItems.length && <p className="mt-4 text-xs text-slate-600">실행 작업을 추가하세요.</p>}</Card>; })}</div>}
    </section>
    <DetailDrawer open={Boolean(editing)} title="전략 항목 수정" busy={saving} onClose={() => setEditing(null)} footer={editing && <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setEditing(null)}>취소</Button><Button type="submit" form="strategy-edit-form">저장</Button></div>}>
      {editing && <form id="strategy-edit-form" className="space-y-4" onSubmit={saveEdit}>
        <label className="block text-sm">제목<input className="mt-2" required value={editTitle} onChange={(e) => setEditTitle(e.target.value)} /></label>
        <label className="block text-sm">상태<select className="mt-2" value={editStatus} onChange={(e) => setEditStatus(e.target.value as StrategyItem["status"])}><option>계획</option><option>진행</option><option>완료</option></select></label>
        {editing.type === "question" && <>
          <label className="block text-sm">질문 소스<select className="mt-2" value={editSource} onChange={(e) => setEditSource(e.target.value)}>{guide.sources.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label className="block text-sm">의도<select className="mt-2" value={editIntent} onChange={(e) => setEditIntent(e.target.value)}>{guide.intents.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label className="block text-sm">고객 세그먼트<input className="mt-2" value={editSegment} onChange={(e) => setEditSegment(e.target.value)} /></label>
          <label className="block text-sm">구매 단계<select className="mt-2" value={editJourney} onChange={(e) => setEditJourney(e.target.value)}>{guide.journeyStages.map((value) => <option key={value}>{value}</option>)}</select></label>
        </>}
        {(editing.type === "cluster" || editing.type === "supporting") && <label className="block text-sm">상위 주제
          <select className="mt-2" required value={editParentId} onChange={(e) => setEditParentId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">상위 주제 선택</option>
            {editParents.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
          </select>
        </label>}
        {editing.type === "calendar" && <>
          <label className="block text-sm">발행 월<input className="mt-2" type="month" required value={editMonth} onChange={(e) => setEditMonth(e.target.value)} /></label>
          <label className="block text-sm">월간 초점<select className="mt-2" value={editFocus} onChange={(e) => setEditFocus(e.target.value)}>{guide.calendar.map((value) => <option key={value}>{value}</option>)}</select></label>
        </>}
        {editing.type === "cycle" && <label className="block text-sm">주차<select className="mt-2" value={editWeek} onChange={(e) => setEditWeek(Number(e.target.value))}>{guide.cycle.map((value, index) => <option key={value} value={index + 1}>{index + 1}주차 · {value}</option>)}</select></label>}
      </form>}
    </DetailDrawer>
    <ConfirmDialog open={Boolean(deleteTarget)} title="전략 항목을 삭제할까요?" description={deleteTarget && <>{deleteTarget.title} 항목과 하위 연결이 해제됩니다.</>} confirmLabel="삭제" destructive onClose={() => setDeleteTarget(null)} onConfirm={remove} />
  </div>;
}
