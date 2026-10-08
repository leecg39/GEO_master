"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileSpreadsheet, LoaderCircle, Trash2, Upload } from "lucide-react";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui";
import { MAX_GSC_FILE_BYTES, type SearchPerformanceImport, type SearchPerformanceList, type SearchPerformanceReport } from "@/lib/search-performance/types";

type Detail = SearchPerformanceImport & { report: SearchPerformanceReport };
const count = (value: number) => value.toLocaleString("ko-KR");
const ratio = (value: number | null) => value === null ? "—" : `${(value * 100).toFixed(2)}%`;
const rank = (value: number | null) => value === null ? "—" : value.toFixed(1);
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = response.status === 204 ? {} : await response.json();
  if (!response.ok) throw new Error(body.error || "요청을 처리하지 못했습니다.");
  return body as T;
}

export function SearchPerformanceClient() {
  const [data, setData] = useState<SearchPerformanceList | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [table, setTable] = useState("일");
  const [page, setPage] = useState(0);
  const generation = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const invalidate = useCallback(() => { generation.current += 1; }, []);
  const load = useCallback(async (preferred?: number) => {
    const version = ++generation.current;
    try {
      const next = await request<SearchPerformanceList>("/api/search-performance");
      if (version !== generation.current) return;
      setData(next);
      setSelected(next.imports.some((item) => item.id === preferred) ? preferred! : next.imports[0]?.id ?? null);
      setError("");
    } catch (cause) {
      if (version === generation.current) setError(cause instanceof Error ? cause.message : "불러오기 실패");
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    const changed = () => {
      setData(null); setSelected(null); setDetail(null); setMessage(""); setUrl(""); setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      void load();
    };
    window.addEventListener("geo-master:project-changed", changed);
    return () => { invalidate(); window.clearTimeout(timer); window.removeEventListener("geo-master:project-changed", changed); };
  }, [load, invalidate]);
  useEffect(() => {
    let active = true;
    void (async () => {
      setDetail(null); setTable("일"); setPage(0);
      if (selected === null) return;
      try {
        const result = await request<{ imported: Detail }>(`/api/search-performance?id=${selected}`);
        if (active) setDetail(result.imported);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "보고서 조회 실패");
      }
    })();
    return () => { active = false; };
  }, [selected, data?.project.id]);

  async function importFile() {
    if (!file || !data || busy) return;
    const version = generation.current;
    setError(""); setMessage(""); setBusy(true);
    try {
      if (!file.name.toLowerCase().endsWith(".xlsx") || file.size > MAX_GSC_FILE_BYTES || !file.size) throw new Error("5MB 이하의 Search Console .xlsx 원본을 선택해 주세요.");
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("파일을 읽지 못했습니다."));
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.readAsDataURL(file);
      });
      if (version !== generation.current) return;
      const result = await request<{ duplicate: boolean; imported: SearchPerformanceImport }>("/api/search-performance", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: data.project.id, propertyUrl: url, filename: file.name, base64 }),
      });
      if (version !== generation.current) return;
      setMessage(result.duplicate ? "이미 가져온 파일입니다. 기존 보고서를 표시합니다." : `${result.imported.platform} 보고서를 저장했습니다.`);
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      await load(result.imported.id);
    } catch (cause) {
      if (version === generation.current) setError(cause instanceof Error ? cause.message : "가져오기 실패");
    } finally { setBusy(false); }
  }

  async function remove() {
    if (!detail || busy || !window.confirm(`${detail.platform}의 ${detail.periodStart}~${detail.periodEnd} 보고서를 삭제할까요? 원본 Excel 파일로 다시 가져올 수 있습니다.`)) return;
    const version = generation.current;
    setBusy(true); setError(""); setMessage("");
    try {
      await request(`/api/search-performance?id=${detail.id}`, { method: "DELETE" });
      if (version !== generation.current) return;
      setMessage("보고서를 삭제했습니다."); await load();
    } catch (cause) {
      if (version === generation.current) setError(cause instanceof Error ? cause.message : "삭제 실패");
    } finally { setBusy(false); }
  }

  const report = detail?.report;
  const rows = report ? table === "일" ? report.daily : report.tables.find((item) => item.name === table)?.rows ?? [] : [];
  const accounts = new Set(data?.imports.map((item) => item.propertyUrl)).size;
  return (
    <div>
      <PageHeader eyebrow="P10 · Google Search Console" title="검색 성과" description="SNS 콘텐츠가 Google 검색에서 받은 클릭·노출을 Search Console 보고서로 확인합니다." />
      <Card className="mb-5">
        <div className="flex flex-wrap items-center gap-3"><FileSpreadsheet className="h-5 w-5 text-violet-400" /><h2 className="text-lg font-semibold">Excel 보고서 가져오기</h2><Badge tone="cyan">파일 기반 연동</Badge></div>
        <p className="mt-3 text-sm text-slate-400">Search Console에서 SNS 속성 → 실적 → 내보내기 → Excel 다운로드 후 가져오세요. 새 성과를 반영하려면 최신 파일을 다시 가져와야 합니다.</p>
        <form className="mt-5 grid gap-4 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void importFile(); }}>
          <label className="text-sm">SNS 계정 URL<input type="url" required disabled={busy || !data} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://instagram.com/계정명" className="mt-2" /></label>
          <label className="text-sm">Search Console Excel 파일<input ref={fileInput} type="file" accept=".xlsx" required disabled={busy || !data} onChange={(event) => setFile(event.target.files?.[0] ?? null)} className="mt-2" /></label>
          <p className="text-xs leading-6 text-slate-400 md:col-span-2">Instagram·X·TikTok 지원 · 파일당 최대 5MB · 현재 프로젝트: {data?.project.name ?? "불러오는 중"}<br />파일에는 계정 주소가 없으므로 해당 파일을 내보낸 SNS 계정 URL을 직접 확인해 입력해 주세요.</p>
          <div className="md:col-span-2"><Button type="submit" disabled={busy || !data || !file || !url}>{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}보고서 가져오기</Button></div>
        </form>
      </Card>
      {error && <p role="alert" className="mb-5 rounded-xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-300">{error}</p>}
      {message && <p role="status" className="mb-5 text-sm text-emerald-400">{message}</p>}
      {!data ? <p className="py-8 text-slate-400">{error ? "검색 성과를 불러오지 못했습니다." : "검색 성과를 불러오는 중입니다."}</p> : <>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">가져온 보고서 <span className="text-slate-400">{data.imports.length}개 · SNS 계정 {accounts}개</span></h2><Badge>자동 동기화 미연결</Badge></div>
        {!data.imports.length ? <EmptyState>아직 가져온 보고서가 없습니다. SNS 계정 URL과 Excel 파일을 등록하세요.</EmptyState> : <>
          <label className="block text-sm">보고서 선택<select className="mb-5 mt-2" disabled={busy} value={selected ?? ""} onChange={(event) => setSelected(Number(event.target.value))}>{data.imports.map((item) => <option key={item.id} value={item.id}>{item.platform} · {item.propertyUrl} · {item.periodStart}~{item.periodEnd} · #{item.id}</option>)}</select></label>
          {!report || !detail ? <p className="py-8 text-slate-400">보고서를 불러오는 중입니다.</p> : <>
            <Card className="mb-5">
              <div className="flex flex-wrap items-center justify-between gap-3"><div><Badge tone="cyan">Search Console Excel</Badge><h3 className="mt-3 text-lg font-semibold">{detail.platform} · <a className="break-all underline decoration-slate-600" href={detail.propertyUrl} target="_blank" rel="noreferrer">{detail.propertyUrl}</a></h3></div><Button type="button" variant="secondary" disabled={busy} onClick={() => void remove()}><Trash2 className="h-4 w-4" />보고서 삭제</Button></div>
              <p className="mt-3 text-sm leading-7 text-slate-400">조회 기간 {report.periodStart} ~ {report.periodEnd} · 원본 날짜 기준 {report.timezone}<br />검색 유형 {report.searchType} · 가져온 시각 {new Date(detail.importedAt).toLocaleString("ko-KR")}<br />원본 파일 {detail.filename}</p>
              <details className="mt-3 text-sm text-slate-400"><summary className="cursor-pointer">원본 필터 보기</summary><ul className="mt-2 space-y-1">{report.filters.map(([name, value], index) => <li key={index}>{name}: {value}</li>)}</ul></details>
            </Card>
            <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">{[["총 클릭수", count(report.totals.clicks)], ["총 노출수", count(report.totals.impressions)], ["평균 CTR", ratio(report.totals.ctr)], ["평균 게재순위", rank(report.totals.position)]].map(([label, value]) => <Card key={label}><p className="text-xs text-slate-400">{label}</p><p className="mt-3 text-3xl font-semibold">{value}</p></Card>)}</div>
            {report.dataState === "no_activity" && <p className="mb-5 rounded-xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-amber-300">파일 가져오기 완료 · 이 기간에는 집계된 검색 노출이 없습니다. CTR·게재순위는 값 없음으로 표시합니다.</p>}
            <Card>
              <label className="mb-4 block max-w-xs text-sm">조회 항목<select className="mt-2" value={table} onChange={(event) => { setTable(event.target.value); setPage(0); }}><option>일</option>{report.tables.map((item) => <option key={item.name}>{item.name}</option>)}</select></label>
              {rows.length === 0 ? <EmptyState>이 항목에 집계된 데이터가 없습니다.</EmptyState> : <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-left text-sm"><thead className="border-b border-white/10 text-slate-400"><tr>{[table, "클릭수", "노출수", "CTR", "게재순위"].map((head) => <th key={head} scope="col" className="px-3 py-3">{head}</th>)}</tr></thead><tbody>{rows.slice(page * 25, (page + 1) * 25).map((row) => <tr key={row.key} className="border-b border-white/5"><td className="max-w-lg break-all px-3 py-3">{row.key}</td><td className="px-3 py-3">{count(row.clicks)}</td><td className="px-3 py-3">{count(row.impressions)}</td><td className="px-3 py-3">{ratio(row.ctr)}</td><td className="px-3 py-3">{rank(row.position)}</td></tr>)}</tbody></table></div>}
              {rows.length > 25 && <div className="mt-4 flex items-center justify-end gap-3"><Button variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>이전</Button><span className="text-sm">{page + 1} / {Math.ceil(rows.length / 25)}</span><Button variant="secondary" disabled={(page + 1) * 25 >= rows.length} onClick={() => setPage(page + 1)}>다음</Button></div>}
              <p className="mt-4 text-xs leading-6 text-slate-400">합계는 날짜별 표에서 계산하며, 계정·기간이 다른 보고서를 합산하지 않습니다. 평균 게재순위는 원본의 반올림된 일별 값에 노출수를 가중해 계산합니다. 검색어·게시물 표에는 내보낸 파일에 포함된 행만 표시됩니다.</p>
            </Card>
          </>}
        </>}
      </>}
    </div>
  );
}
