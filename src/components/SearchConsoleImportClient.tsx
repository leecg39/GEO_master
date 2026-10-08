"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircle, Trash2, Upload } from "lucide-react";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui";

interface Item {
  id: number; propertyLabel: string; fileName: string; periodStart: string | null; periodEnd: string | null; hasData: boolean; importedAt: string;
  totals: { clicks: number; impressions: number; ctr: number | null; position: number | null };
}

const MAX_BYTES = 2 * 1024 * 1024;
const PLATFORMS: Array<[string, string]> = [["instagram", "Instagram"], ["x", "X"], ["tiktok", "TikTok"]];

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { error?: string }).error || "요청을 처리하지 못했습니다.");
  return body as T;
}

function toBase64(buffer: ArrayBuffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

const pct = (value: number | null) => (value === null ? "N/A" : `${(value * 100).toFixed(1)}%`);
const num = (value: number | null) => (value === null ? "N/A" : value.toFixed(1));

/** 파일명에서 플랫폼을 추정해 이름 입력란의 기본값으로만 제안한다 (확정은 사용자가) */
function suggestLabel(fileName: string) {
  const lower = fileName.toLowerCase();
  const hit = PLATFORMS.find(([key]) => lower.includes(key));
  return hit ? hit[1] : "";
}

export function SearchConsoleImportClient() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try { setItems((await request<{ items: Item[] }>("/api/search-console/imports")).items); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "불러오지 못했습니다."); setItems([]); }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    const reload = () => { void load(); };
    window.addEventListener("geo-master:project-changed", reload);
    return () => { window.clearTimeout(timer); window.removeEventListener("geo-master:project-changed", reload); };
  }, [load]);

  function choose(selected: File | null) {
    setError(""); setNotice("");
    if (selected && selected.size > MAX_BYTES) { setError("파일이 너무 큽니다(2MB 이하)."); return; }
    setFile(selected);
    if (selected && !label.trim()) setLabel(suggestLabel(selected.name));
  }

  async function upload() {
    if (!file || !label.trim()) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await request<{ duplicate: boolean; warning: string | null }>("/api/search-console/imports", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileName: file.name, propertyLabel: label.trim(), contentBase64: toBase64(await file.arrayBuffer()) }),
      });
      setNotice(result.duplicate ? "이미 같은 속성으로 가져온 파일입니다." : "가져왔습니다.");
      if (result.warning) setError(result.warning);
      setFile(null); if (input.current) input.current.value = "";
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "가져오지 못했습니다."); } finally { setBusy(false); }
  }

  async function remove(id: number) {
    try { await request(`/api/search-console/imports/${id}`, { method: "DELETE" }); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "삭제하지 못했습니다."); }
  }

  if (!items) return <div className="grid min-h-96 place-items-center"><LoaderCircle className="h-7 w-7 animate-spin text-cyan-400" /></div>;
  return (
    <div>
      <PageHeader eyebrow="Search Console" title="검색 성과 가져오기" description="공개 API가 노출하지 않는 속성(예: SNS 플랫폼 속성)은 Search Console에서 내려받은 성과 보고서(Excel)를 올려 사용합니다. 파일에는 속성 이름이 들어 있지 않으므로 어느 속성의 파일인지 직접 지정해 주세요. 이 데이터는 API로 읽은 값과 섞지 않고 '콘솔 내보내기'로 구분해 보관합니다." />
      <Card className="mb-5 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-xs">Excel 파일 (.xlsx, 2MB 이하)
            <input ref={input} className="mt-1.5" type="file" accept=".xlsx" onChange={(event) => choose(event.target.files?.[0] ?? null)} />
          </label>
          <label className="block text-xs">속성 이름 <span className="text-slate-600">(필수 · 예: TikTok @계정)</span>
            <input className="mt-1.5" maxLength={120} value={label} onChange={(event) => setLabel(event.target.value)} />
          </label>
        </div>
        <Button type="button" disabled={busy || !file || !label.trim()} onClick={() => void upload()}>{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}가져오기</Button>
        {notice && <p role="status" className="text-sm text-emerald-300">{notice}</p>}
        {error && <p role="alert" className="text-sm text-amber-300">{error}</p>}
      </Card>
      {items.length === 0 ? <EmptyState>가져온 보고서가 없습니다.</EmptyState> : (
        <div className="space-y-3">
          {items.map((item) => (
            <Card key={item.id}>
              <div className="flex flex-wrap items-center gap-2">
                <strong className="text-white">{item.propertyLabel}</strong>
                <Badge>콘솔 내보내기</Badge>
                {item.hasData ? <Badge tone="good">데이터 있음</Badge> : <Badge tone="warn">노출 0 · 데이터 없음</Badge>}
                <span className="text-xs text-slate-500">{item.periodStart} ~ {item.periodEnd} · {item.fileName}</span>
                <Button type="button" variant="danger" className="ml-auto" aria-label={`${item.propertyLabel} 삭제`} onClick={() => void remove(item.id)}><Trash2 className="h-4 w-4" /></Button>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div><dt className="text-xs text-slate-500">클릭수</dt><dd className="text-white">{item.totals.clicks}</dd></div>
                <div><dt className="text-xs text-slate-500">노출</dt><dd className="text-white">{item.totals.impressions}</dd></div>
                <div><dt className="text-xs text-slate-500">CTR</dt><dd className="text-white">{pct(item.totals.ctr)}</dd></div>
                <div><dt className="text-xs text-slate-500">평균 게재 순위</dt><dd className="text-white">{num(item.totals.position)}</dd></div>
              </dl>
              {!item.hasData && <p className="mt-2 text-xs text-slate-500">노출이 0이면 성과가 0인지 아직 데이터가 쌓이지 않은 것인지 파일만으로는 구분할 수 없습니다. 며칠 뒤 다시 내려받아 가져오세요.</p>}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
