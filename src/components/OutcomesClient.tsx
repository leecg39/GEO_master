"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircle, Save, Trash2, Upload } from "lucide-react";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui";
import { requestJson as request, toBase64 } from "@/lib/client-upload";

type Kind = "cta_click" | "form_submit" | "conversion";
interface Metric { kind: Kind; count: number; events: Array<{ eventName: string; definition: string; count: number }> }
interface Source { sourceLabel: string; periodStart: string; periodEnd: string; importCount: number; lastImportedAt: string; metrics: Metric[]; unmapped: Array<{ eventName: string; count: number }> }
interface Summary {
  sources: Source[];
  imports: Array<{ id: number; sourceLabel: string; fileName: string; periodStart: string; periodEnd: string; rowsUsed: number; rowsSkipped: number; importedAt: string }>;
  definitions: Array<{ eventName: string; kind: Kind; definition: string; updatedAt: string }>;
}

const MAX_BYTES = 5 * 1024 * 1024;
const KIND_LABELS: Record<Kind, string> = { cta_click: "CTA 클릭", form_submit: "폼 제출", conversion: "전환(구매·가입 등)" };
const fmt = (value: number) => value.toLocaleString("ko-KR");

function DefineForm({ eventName, onSaved }: { eventName: string; onSaved: (eventName: string, kind: Kind, definition: string) => Promise<void> }) {
  const [kind, setKind] = useState<Kind>("cta_click");
  const [definition, setDefinition] = useState("");
  return (
    <div className="grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-center">
      <select aria-label={`${eventName} 지표 종류`} value={kind} onChange={(event) => setKind(event.target.value as Kind)}>
        {(Object.keys(KIND_LABELS) as Kind[]).map((key) => <option key={key} value={key}>{KIND_LABELS[key]}</option>)}
      </select>
      <input aria-label={`${eventName} 정의`} maxLength={300} placeholder="정의 (예: 상담 폼 제출 완료)" value={definition} onChange={(event) => setDefinition(event.target.value)} />
      <Button type="button" variant="secondary" disabled={!definition.trim()} onClick={() => void onSaved(eventName, kind, definition.trim())}><Save className="h-4 w-4" />정의</Button>
    </div>
  );
}

function SourceCard({ source, onDefine }: { source: Source; onDefine: (eventName: string, kind: Kind, definition: string) => Promise<void> }) {
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-white">{source.sourceLabel}</strong>
        <Badge>원천별 집계</Badge>
        <span className="text-xs text-slate-500">기준 기간 {source.periodStart} ~ {source.periodEnd} · 가져오기 {source.importCount}회 · 최근 {source.lastImportedAt.slice(0, 10)}</span>
      </div>
      {source.metrics.length === 0 ? <p className="mt-3 text-xs text-amber-300">정의된 지표가 없습니다. 아래 미분류 이벤트에 의미를 정해 주세요.</p> : (
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {source.metrics.map((metric) => (
            <div key={metric.kind} className="rounded-lg border border-white/10 p-3">
              <p className="text-xs text-slate-500">{KIND_LABELS[metric.kind]}</p>
              <p className="text-2xl font-bold text-white">{fmt(metric.count)}</p>
              <ul className="mt-2 space-y-1 text-xs text-slate-400">
                {metric.events.map((event) => <li key={event.eventName}><code className="text-slate-300">{event.eventName}</code> {fmt(event.count)} — {event.definition}</li>)}
              </ul>
            </div>
          ))}
        </div>
      )}
      {source.unmapped.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-xs font-semibold text-slate-300">미분류 이벤트 <span className="font-normal text-slate-500">· 의미를 정하기 전에는 어떤 지표에도 넣지 않습니다</span></p>
          {source.unmapped.map((event) => (
            <div key={event.eventName} className="grid gap-2 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:items-center">
              <span className="truncate text-xs"><code className="text-slate-300">{event.eventName}</code> <span className="text-slate-500">{fmt(event.count)}회</span></span>
              <DefineForm eventName={event.eventName} onSaved={onDefine} />
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export function OutcomesClient() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [sourceLabel, setSourceLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try { setSummary(await request<Summary>("/api/outcomes")); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "불러오지 못했습니다."); setSummary({ sources: [], imports: [], definitions: [] }); }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    const reload = () => { void load(); };
    window.addEventListener("geo-master:project-changed", reload);
    return () => { window.clearTimeout(timer); window.removeEventListener("geo-master:project-changed", reload); };
  }, [load]);

  const act = useCallback(async (action: () => Promise<unknown>, success?: string) => {
    setError(""); setNotice("");
    try { await action(); if (success) setNotice(success); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "처리하지 못했습니다."); }
  }, [load]);

  function choose(selected: File | null) {
    setError(""); setNotice("");
    if (selected && selected.size > MAX_BYTES) { setError("파일이 너무 큽니다(5MB 이하)."); return; }
    setFile(selected);
  }

  async function upload() {
    if (!file || !sourceLabel.trim()) return;
    setBusy(true);
    await act(async () => {
      await request<{ duplicate: boolean }>("/api/outcomes", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileName: file.name, sourceLabel: sourceLabel.trim(), contentBase64: toBase64(await file.arrayBuffer()) }),
      });
      setFile(null); if (input.current) input.current.value = "";
    }, "가져왔습니다.");
    setBusy(false);
  }

  const define = (eventName: string, kind: Kind, definition: string) => act(() => request("/api/outcomes/definitions", {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ eventName, kind, definition }),
  }), `${eventName}을(를) ${KIND_LABELS[kind]}로 정의했습니다.`);

  if (!summary) return <div className="grid min-h-96 place-items-center"><LoaderCircle className="h-7 w-7 animate-spin text-cyan-400" /></div>;
  return (
    <div>
      <PageHeader eyebrow="Business outcomes" title="사업 성과" description="GA4 등에서 내보낸 일자별 이벤트 집계(CSV)를 원천별로 올리고, 각 이벤트가 CTA 클릭·폼 제출·전환 중 무엇인지 정의합니다. 세 지표는 서로 합치지 않고, 분모를 알 수 없는 비율(전환율 등)은 계산하지 않습니다." />
      <Card className="mb-5 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-xs">이벤트 집계 CSV (5MB 이하 · 날짜·이벤트 이름·이벤트 수 열, 페이지 경로 선택)
            <input ref={input} className="mt-1.5" type="file" accept=".csv,text/csv" onChange={(event) => choose(event.target.files?.[0] ?? null)} />
          </label>
          <label className="block text-xs">원천 이름 <span className="text-slate-600">(필수 · 예: GA4 · 공식몰)</span>
            <input className="mt-1.5" maxLength={80} value={sourceLabel} onChange={(event) => setSourceLabel(event.target.value)} />
          </label>
        </div>
        <Button type="button" disabled={busy || !file || !sourceLabel.trim()} onClick={() => void upload()}>{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}가져오기</Button>
        {notice && <p role="status" className="text-sm text-emerald-300">{notice}</p>}
        {error && <p role="alert" className="text-sm text-amber-300">{error}</p>}
      </Card>

      {summary.sources.length === 0 ? <EmptyState>연결 안 됨 — 이벤트 집계를 올리기 전에는 성과 0이 아니라 측정 정보가 없는 상태입니다.</EmptyState> : (
        <div className="space-y-3">
          {summary.sources.map((source) => <SourceCard key={source.sourceLabel} source={source} onDefine={define} />)}
          <p className="text-xs text-slate-500">같은 원천에서 기간이 겹치면 그 날짜를 포함한 가장 최근 파일의 값을 씁니다. 수치는 원천이 집계한 값이며 GEO Master가 개별 이벤트를 검증하지 않습니다. 성과 변화가 GEO 작업의 효과라는 인과관계를 뜻하지 않습니다.</p>
        </div>
      )}

      {summary.definitions.length > 0 && (
        <Card className="mt-5">
          <h2 className="font-semibold text-white">지표 정의</h2>
          <ul className="mt-3 divide-y divide-white/5 text-sm">
            {summary.definitions.map((item) => (
              <li key={item.eventName} className="flex items-center gap-3 py-2">
                <code className="text-slate-300">{item.eventName}</code><Badge tone="cyan">{KIND_LABELS[item.kind]}</Badge>
                <span className="min-w-0 flex-1 truncate text-xs text-slate-400">{item.definition}</span>
                <Button type="button" variant="danger" aria-label={`${item.eventName} 정의 삭제`} onClick={() => void act(() => request("/api/outcomes/definitions", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ eventName: item.eventName }) }))}><Trash2 className="h-4 w-4" /></Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {summary.imports.length > 0 && (
        <Card className="mt-5">
          <h2 className="font-semibold text-white">가져온 파일</h2>
          <ul className="mt-3 divide-y divide-white/5 text-sm">
            {summary.imports.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-3 py-2">
                <span className="text-slate-200">{item.fileName}</span>
                <span className="text-xs text-slate-500">{item.sourceLabel} · {item.periodStart} ~ {item.periodEnd} · {fmt(item.rowsUsed)}행{item.rowsSkipped ? ` (총계 등 ${item.rowsSkipped}행 제외)` : ""}</span>
                <Button type="button" variant="danger" className="ml-auto" aria-label={`${item.fileName} 삭제`} onClick={() => void act(() => request(`/api/outcomes/${item.id}`, { method: "DELETE" }))}><Trash2 className="h-4 w-4" /></Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
