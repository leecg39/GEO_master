"use client";

import { useCallback, useEffect, useState } from "react";
import { History, RotateCcw } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui";

interface Revision { revision: number; origin: "created" | "edited" | "remote" | "restored"; createdAt: string; bytes: number }
interface DiffLine { type: "same" | "added" | "removed"; text: string }

const ORIGIN = { created: "생성", edited: "편집", remote: "원격 확인", restored: "되돌림" } as const;

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { error?: string }).error || "요청을 처리하지 못했습니다.");
  return body as T;
}

/** 저장된 llms 문서의 버전 이력 — 두 리비전을 줄 단위로 비교하고, 예전 리비전으로 되돌릴 수 있다 */
export function LlmsHistoryPanel({ documentId, updatedAt, onRestored }: { documentId: number; updatedAt: string; onRestored: () => void }) {
  const [items, setItems] = useState<Revision[]>([]);
  const [diff, setDiff] = useState<{ from: number; to: number; lines: DiffLine[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try { setItems((await request<{ items: Revision[] }>(`/api/llms-documents/${documentId}/revisions`)).items); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "이력을 불러오지 못했습니다."); }
  }, [documentId]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load, updatedAt]);

  async function compare(from: number, to: number) {
    setError("");
    try { setDiff({ from, to, lines: (await request<{ diff: DiffLine[] }>(`/api/llms-documents/${documentId}/revisions?from=${from}&to=${to}`)).diff }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "비교하지 못했습니다."); }
  }

  async function restore(revision: number) {
    setBusy(true); setError("");
    try {
      await request(`/api/llms-documents/${documentId}/revisions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ revision, expectedUpdatedAt: updatedAt }) });
      setDiff(null);
      onRestored();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "되돌리지 못했습니다."); } finally { setBusy(false); }
  }

  return (
    <Card className="mt-5">
      <div className="flex items-center gap-2"><History className="h-4 w-4 text-cyan-400" /><h2 className="font-semibold text-white">버전 이력</h2></div>
      <p className="mt-1 text-xs text-slate-500">문서 내용이 바뀔 때마다 기록됩니다. 원격 확인으로 덮어써도 이전 내용은 남습니다.</p>
      {error && <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p>}
      <ul className="mt-3 divide-y divide-white/5 text-sm">
        {items.map((item, index) => (
          <li key={item.revision} className="flex flex-wrap items-center gap-2 py-2">
            <span className="text-slate-200">v{item.revision}</span><Badge>{ORIGIN[item.origin]}</Badge>
            <span className="text-xs text-slate-500">{new Date(item.createdAt).toLocaleString("ko-KR")} · {item.bytes} bytes</span>
            <span className="ml-auto flex gap-2">
              {index < items.length - 1 && <Button type="button" variant="secondary" onClick={() => void compare(items[index + 1]!.revision, item.revision)}>이전 버전과 비교</Button>}
              {index > 0 && <Button type="button" variant="secondary" disabled={busy} onClick={() => void restore(item.revision)}><RotateCcw className="h-4 w-4" />이 버전으로 되돌리기</Button>}
            </span>
          </li>
        ))}
      </ul>
      {diff && (
        <div className="mt-4">
          <p className="mb-2 text-xs text-slate-400">v{diff.from} → v{diff.to}</p>
          <pre className="max-h-80 overflow-auto rounded-xl bg-slate-950/50 p-3 text-xs leading-5">
            {diff.lines.map((line, index) => (
              <span key={index} className={`block ${line.type === "added" ? "bg-emerald-400/10 text-emerald-300" : line.type === "removed" ? "bg-rose-400/10 text-rose-300" : "text-slate-500"}`}>
                {line.type === "added" ? "+ " : line.type === "removed" ? "- " : "  "}{line.text}
              </span>
            ))}
          </pre>
        </div>
      )}
    </Card>
  );
}
