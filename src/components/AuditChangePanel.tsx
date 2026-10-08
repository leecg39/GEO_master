"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge, Button, Card } from "@/components/ui";

interface Suggestion { field: string; url: string; currentValue: string; reasonCode: string; guidance: string }
const LABELS: Record<string, string> = { title: "제목", description: "설명", canonical: "대표 URL", og_image: "OG 이미지", robots_meta: "robots 메타" };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { error?: string }).error || "요청을 처리하지 못했습니다.");
  return body as T;
}

/** 진단이 실제로 읽은 필드를 바탕으로 수정안 초안을 만든다. 제안 문구는 직접 입력한다 (AI가 대신 쓰지 않음) */
export function AuditChangePanel({ auditId }: { auditId: number }) {
  const [items, setItems] = useState<Suggestion[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      request<{ suggestions: Suggestion[] }>(`/api/audits/${auditId}/change-items`)
        .then((data) => { setItems(data.suggestions); setError(""); })
        .catch((cause) => { setItems([]); setError(cause instanceof Error ? cause.message : "불러오지 못했습니다."); });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [auditId]);

  async function create(item: Suggestion) {
    setError("");
    try {
      await request(`/api/audits/${auditId}/change-items`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ field: item.field, proposedValue: drafts[item.reasonCode], rationale: `진단: ${item.guidance}` }),
      });
      setCreated((existing) => ({ ...existing, [item.reasonCode]: true }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "만들지 못했습니다."); }
  }

  if (!items) return null;
  if (!items.length && !error) return null;
  return (
    <Card className="mt-5 print:hidden">
      <h3 className="font-semibold text-white">진단 결과로 수정안 만들기</h3>
      <p className="mt-1 text-xs text-slate-500">진단이 읽은 현재 값을 그대로 &quot;현재 값&quot;으로 가져옵니다. 제안 문구는 직접 입력하세요. 기준은 공식 규격이 아니라 일반적인 권고입니다.</p>
      {error && <p role="alert" className="mt-3 text-sm text-amber-300">{error}</p>}
      <ul className="mt-3 space-y-3">
        {items.map((item) => (
          <li key={item.reasonCode} className="rounded-xl border border-white/8 p-3">
            <div className="flex flex-wrap items-center gap-2"><Badge tone="warn">{LABELS[item.field] ?? item.field}</Badge><span className="text-xs text-slate-400">{item.guidance}</span></div>
            <p className="mt-2 truncate text-xs text-slate-500">현재 값: {item.currentValue || "(비어 있음)"}</p>
            {created[item.reasonCode] ? (
              <p className="mt-2 text-xs text-emerald-300">수정안 초안을 만들었습니다. <Link className="underline" href="/changes">수정안 작업대에서 보기</Link></p>
            ) : (
              <div className="mt-2 flex gap-2">
                <input aria-label={`${LABELS[item.field] ?? item.field} 제안 문구`} className="flex-1" placeholder="제안 문구를 입력하세요" value={drafts[item.reasonCode] ?? ""} onChange={(event) => setDrafts({ ...drafts, [item.reasonCode]: event.target.value })} />
                <Button type="button" className="shrink-0 whitespace-nowrap" disabled={!(drafts[item.reasonCode] ?? "").trim()} onClick={() => void create(item)}>수정안 만들기</Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
