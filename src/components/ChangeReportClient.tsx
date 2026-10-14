"use client";

import { useEffect, useState } from "react";
import { FileJson2, FileText, LoaderCircle, TriangleAlert } from "lucide-react";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui";
import type { ChangeReport, ChangeReportItem } from "@/lib/change-report";

/** 수정 결과 보고서 화면 (R05). 값은 모두 React 텍스트로만 그린다. */
const FIELDS: Record<string, string> = { title: "제목", description: "설명", canonical: "대표 URL", og_image: "OG 이미지", robots_meta: "robots 메타", json_ld: "JSON-LD", body: "본문" };
const STATUS: Record<string, { label: string; tone: "default" | "good" | "warn" | "bad" | "cyan" }> = {
  draft: { label: "초안", tone: "default" }, approved: { label: "승인", tone: "cyan" }, delivered: { label: "전달됨", tone: "cyan" },
  verification_pending: { label: "확인 대기", tone: "warn" }, verified: { label: "반영 확인", tone: "good" }, conflict: { label: "충돌", tone: "bad" }, failed: { label: "실패", tone: "bad" },
};
const KPIS: Array<[keyof ChangeReport["kpi"], string]> = [["total", "전체"], ["verified", "반영 확인"], ["pending", "확인 대기"], ["conflict", "충돌"], ["failed", "실패"]];

const reportPath = (url: string) => `/api/change-items/report?url=${encodeURIComponent(url)}`;

function Value({ label, value, empty }: { label: string; value: string | null; empty: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className="mt-1 whitespace-pre-wrap break-all rounded-lg bg-slate-950/40 p-2 text-xs text-slate-300">{value || <span className="text-slate-600">{empty}</span>}</p>
    </div>
  );
}

function ItemCard({ item }: { item: ChangeReportItem }) {
  const status = STATUS[item.status] ?? { label: item.status, tone: "default" as const };
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={status.tone}>{status.label}</Badge>
        <Badge>{FIELDS[item.field] ?? item.field}</Badge>
        <span className="text-xs text-slate-500">#{item.id}</span>
        <span className="ml-auto text-[11px] text-slate-500">{item.lastCheckedAt ? `마지막 확인 ${item.lastCheckedAt}${item.lastHttpStatus === null ? "" : ` · HTTP ${item.lastHttpStatus}`}` : "확인 기록 없음"}</span>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Value label="원래 값" value={item.originalValue} empty="빈 값 또는 기록 없음" />
        <Value label="제안 값" value={item.proposedValue} empty="-" />
        <Value label="WordPress 저장값" value={item.wordpressValue} empty="WordPress 확인 기록 없음" />
        <Value label="공개 페이지 값" value={item.publicValue} empty="확인 기록 없음" />
      </div>
      {item.finalUrlMismatch && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-300"><TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />확인 주소가 수정안 주소와 다릅니다: <span className="break-all">{item.lastFinalUrl}</span></p>
      )}
      {(item.deliveries?.length ?? 0) > 0 && (
        <details className="mt-3 text-xs text-slate-400">
          <summary className="cursor-pointer">전달 이력 {item.deliveries!.length}건</summary>
          <ul className="mt-2 space-y-1">
            {item.deliveries!.map((entry) => <li key={entry.id}>{entry.finishedAt} · {entry.method} · {entry.result}{entry.httpStatus === null ? "" : ` · HTTP ${entry.httpStatus}`} · {entry.durationMs}ms{entry.errorCode ? ` · ${entry.errorCode}` : ""}{entry.previousValue ? ` · 이전 값: ${entry.previousValue}` : ""}</li>)}
          </ul>
        </details>
      )}
      {item.history.length > 0 && (
        <details className="mt-3 text-xs text-slate-400">
          <summary className="cursor-pointer">확인 이력 {item.history.length}건</summary>
          <ul className="mt-2 space-y-1">
            {item.history.map((entry) => <li key={entry.id}>{entry.checkedAt} · {entry.result}{entry.httpStatus === null ? "" : ` · HTTP ${entry.httpStatus}`} · {entry.durationMs}ms{entry.errorCode ? ` · ${entry.errorCode}` : ""}</li>)}
          </ul>
        </details>
      )}
    </Card>
  );
}

function ReportBody({ report, url }: { report: ChangeReport; url: string }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <a href={`${reportPath(url)}&format=md`} download className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-slate-200 hover:bg-white/10"><FileText className="h-4 w-4" />Markdown</a>
        <a href={`${reportPath(url)}&format=pdf`} download className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-sm font-bold text-cyan-200 hover:bg-cyan-400/15"><FileText className="h-4 w-4" />PDF</a>
        <a href={`${reportPath(url)}&format=json&download=1`} download className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-slate-200 hover:bg-white/10"><FileJson2 className="h-4 w-4" />JSON</a>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {KPIS.map(([key, label]) => <Card key={key} className="p-4"><p className="text-xs text-slate-500">{label}</p><strong className="text-2xl text-white">{report.kpi[key]}</strong></Card>)}
      </div>
      {report.actions.length > 0 && (
        <Card className="p-4">
          <h2 className="text-sm font-semibold text-white">조치 필요</h2>
          <ul className="mt-2 space-y-1.5 text-xs text-amber-200">{report.actions.map((action) => <li key={action.id}>#{action.id} {FIELDS[action.field] ?? action.field}: {action.message}</li>)}</ul>
        </Card>
      )}
      <Card className="p-4">
        <h2 className="text-sm font-semibold text-white">재진단 비교</h2>
        <ul className="mt-2 space-y-1.5 text-xs text-slate-300">
          {report.reaudits.length === 0 && <li>비교할 수정안이 없습니다.</li>}
          {report.reaudits.map((entry) => <li key={entry.url} className="break-all">{entry.after
            ? `${entry.before ? `진단 #${entry.before.id} ${entry.before.score}점` : "수정 전 진단 없음"} → 진단 #${entry.after.id} ${entry.after.score}점`
            : "수정 이후 진단이 없어 점수 변화를 표시하지 않습니다."}</li>)}
        </ul>
      </Card>
      {report.items.length === 0 ? <EmptyState>이 URL의 수정안이 없습니다.</EmptyState> : report.items.map((item) => <ItemCard key={item.id} item={item} />)}
    </div>
  );
}

export function ChangeReportClient({ initialUrl }: { initialUrl: string | null }) {
  const [url, setUrl] = useState(initialUrl ?? "");
  const [target, setTarget] = useState(initialUrl);
  const [report, setReport] = useState<ChangeReport | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(Boolean(initialUrl));
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const reload = () => setRevision((value) => value + 1);
    window.addEventListener("geo-master:project-changed", reload);
    return () => window.removeEventListener("geo-master:project-changed", reload);
  }, []);

  useEffect(() => {
    if (!target) return;
    let active = true;
    fetch(reportPath(target), { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json() as ChangeReport & { error?: string };
        if (!response.ok) throw new Error(body.error ?? "보고서를 만들지 못했습니다.");
        if (active) { setReport(body); setError(""); }
      })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "보고서를 만들지 못했습니다."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [target, revision]);

  function submit() {
    setLoading(true);
    setReport(null);
    setTarget(url.trim());
  }

  return (
    <div>
      <PageHeader eyebrow="Change report" title="수정 결과 보고서" description="수정안별로 원래 값, 제안 값, 공개 페이지에서 실제로 읽은 값을 나란히 보여 줍니다. 점수 변화는 실제로 다시 진단한 경우에만 표시합니다." />
      <Card className="mb-4 p-4">
        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(event) => { event.preventDefault(); submit(); }}>
          <input aria-label="보고서 URL" type="url" required className="flex-1" placeholder="https://" value={url} onChange={(event) => setUrl(event.target.value)} />
          <Button type="submit" disabled={loading || !url.trim()}>보고서 보기</Button>
        </form>
      </Card>
      {error && <p role="alert" className="mb-4 rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-300">{error}</p>}
      {!target ? <EmptyState>보고서를 볼 페이지 URL을 입력하세요.</EmptyState>
        : loading ? <div className="grid min-h-48 place-items-center"><LoaderCircle className="h-6 w-6 animate-spin text-cyan-400" /></div>
          : report ? <ReportBody report={report} url={target} /> : null}
    </div>
  );
}
