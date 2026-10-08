"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Clipboard, Link2, LoaderCircle } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui";
import { formatDate } from "@/lib/utils";

interface Share { id: number; expiresAt: string; revokedAt: string | null; viewCount: number; createdAt: string; active: boolean }

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { error?: string }).error || "요청을 처리하지 못했습니다.");
  return body as T;
}

/** 측정 리포트의 만료형 공개 링크 — 링크를 만든 시점의 리포트 스냅샷을 로그인 없이 보여 준다 */
export function ReportSharePanel({ runId }: { runId: number }) {
  const [shares, setShares] = useState<Share[]>([]);
  const [days, setDays] = useState(7);
  const [createdUrl, setCreatedUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setShares((await request<{ items: Share[] }>(`/api/report-shares?runId=${runId}`)).items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "공유 링크를 불러오지 못했습니다.");
    }
  }, [runId]);

  useEffect(() => {
    const initial = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(initial);
  }, [load]);

  async function create() {
    setBusy(true);
    setError("");
    try {
      const { url } = await request<{ url: string }>("/api/report-shares", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId, expiresInDays: days }),
      });
      setCreatedUrl(`${window.location.origin}${url}`);
      setCopied(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "공유 링크를 만들지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: number) {
    try {
      await request(`/api/report-shares/${id}`, { method: "DELETE" });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "링크를 폐기하지 못했습니다.");
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(createdUrl);
    setCopied(true);
  }

  return (
    <Card className="print:hidden">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-semibold text-white">공개 링크</h2>
          <p className="mt-1 text-xs text-slate-500">로그인 없이 볼 수 있는 만료형 링크입니다. 만든 시점의 리포트(답변 원문 최대 200개 포함)가 고정되어 공유됩니다.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
          <select aria-label="링크 유효기간" value={days} onChange={(event) => setDays(Number(event.target.value))}>
            {[1, 7, 14, 30].map((value) => <option key={value} value={value}>{value}일</option>)}
          </select>
          <Button type="button" disabled={busy} onClick={() => void create()}>{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}링크 만들기</Button>
        </div>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p>}
      {createdUrl && (
        <div className="mt-3 flex flex-col gap-2 rounded-xl border border-cyan-400/20 bg-cyan-400/5 p-3 sm:flex-row sm:items-center">
          <code className="min-w-0 flex-1 truncate text-xs text-cyan-200">{createdUrl}</code>
          <Button type="button" variant="secondary" onClick={() => void copy()}>{copied ? <Check className="h-4 w-4" /> : <Clipboard className="h-4 w-4" />}{copied ? "복사됨" : "복사"}</Button>
          <p className="text-[11px] text-amber-300 sm:basis-full">이 주소는 지금만 표시됩니다. 서버에는 링크를 알아낼 수 없는 해시만 저장됩니다.</p>
        </div>
      )}
      {shares.length > 0 && (
        <ul className="mt-3 divide-y divide-white/5 text-xs">
          {shares.map((share) => (
            <li key={share.id} className="flex items-center justify-between gap-2 py-2">
              <span className="text-slate-400">{formatDate(share.createdAt)} 생성 · 만료 {formatDate(share.expiresAt)} · 열람 {share.viewCount}회</span>
              {share.active ? <Button type="button" variant="danger" onClick={() => void revoke(share.id)}>폐기</Button> : <Badge>{share.revokedAt ? "폐기됨" : "만료됨"}</Badge>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
