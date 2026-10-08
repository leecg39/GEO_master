"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui";
import type { MonitoringData, MonitoringQuestion } from "@/lib/monitoring-types";

export const fieldClass = "w-full min-w-0 rounded-lg border border-[color:var(--app-input-border)] bg-[color:var(--app-input-bg)] px-3 py-2.5 text-sm text-[color:var(--app-input-text)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-ring-focus)]";

async function write<T>(url: string, method: string, body: unknown, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  const result = await response.json();
  signal.throwIfAborted();
  if (!response.ok) throw new Error(result.error ?? "질문을 저장하지 못했습니다.");
  return result as T;
}

export function MonitoringQuestionEditor({ data, question, onClose, onSaved }: {
  data: MonitoringData; question?: MonitoringQuestion; onClose: () => void; onSaved: () => void;
}) {
  const [text, setText] = useState(question?.text ?? "");
  const [registrationId, setRegistrationId] = useState(question?.registrations[0]?.id ?? 0);
  const [setId, setSetId] = useState(data.questionSets[0]?.id ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const initialFocus = useRef<HTMLTextAreaElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => () => requestRef.current?.abort(), []);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setBusy(true); setError("");
    try {
      if (question) {
        const registration = question.registrations.find((item) => item.id === registrationId)!;
        await write(`/api/questions/${registration.id}`, "PATCH", { text: text.trim(), expectedUpdatedAt: registration.updatedAt }, controller.signal);
      } else {
        let target = setId;
        if (!target) {
          const created = await write<{ questionSet: { id: number } }>("/api/question-sets", "POST", { name: "모니터링 질문", projectId: data.project.id }, controller.signal);
          target = created.questionSet.id;
          // Keep the created set on retry if saving the question fails.
          setSetId(target);
        }
        await write(`/api/question-sets/${target}/questions`, "POST", { text: text.trim() }, controller.signal);
      }
      onSaved();
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "질문을 저장하지 못했습니다.");
    } finally {
      requestRef.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return <Modal open labelledBy="monitoring-editor-title" describedBy="monitoring-editor-help" busy={busy} onClose={onClose} initialFocus={initialFocus}>
    <div className="flex min-h-full items-center justify-center p-4">
      <form onSubmit={save} className="w-full max-w-lg rounded-[18px] border border-[color:var(--app-card-border)] bg-[color:var(--app-card-bg)] p-6 text-[color:var(--app-text)] shadow-xl">
        <div className="flex items-center justify-between gap-4"><h2 id="monitoring-editor-title" className="text-lg font-semibold">{question ? "질문 수정" : "새 질문 추가"}</h2><button type="button" aria-label="질문 편집 닫기" disabled={busy} onClick={onClose} className="rounded-lg p-2 focus-visible:outline-2"><X className="h-5 w-5" /></button></div>
        <p id="monitoring-editor-help" className="my-4 text-sm leading-6 text-[color:var(--app-text-muted)]">{question ? "수정 전 질문의 측정 이력은 보존됩니다. 바뀐 문장은 다음 측정부터 별도 질문으로 집계합니다." : "질문을 저장한 뒤 응답 점유율 또는 예약 측정에서 실행하면 결과가 표시됩니다."}</p>
        <label className="block text-sm">질문 내용<textarea ref={initialFocus} value={text} onChange={(event) => setText(event.target.value)} required minLength={5} maxLength={500} rows={4} disabled={busy} className={`${fieldClass} mt-2 resize-y`} /></label>
        <p className="mt-1 text-right text-xs text-[color:var(--app-text-muted)]">{text.length} / 500</p>
        {question && question.registrations.length > 1 ? <label className="mt-3 block text-sm">수정할 질문 세트<select className={`${fieldClass} mt-2`} value={registrationId} onChange={(event) => setRegistrationId(Number(event.target.value))} disabled={busy}>{question.registrations.map((item) => <option key={item.id} value={item.id}>{item.setName} · #{item.id}</option>)}</select></label> : !question && data.questionSets.length > 0 ? <label className="mt-3 block text-sm">질문 세트<select className={`${fieldClass} mt-2`} value={setId} onChange={(event) => setSetId(Number(event.target.value))} disabled={busy}>{data.questionSets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : null}
        {error && <p role="alert" className="mt-4 text-sm text-[color:var(--app-status-danger)]">{error}</p>}
        <div className="mt-6 flex justify-end gap-3"><Button type="button" variant="secondary" onClick={onClose} disabled={busy}>취소</Button><Button type="submit" disabled={busy || text.trim().length < 5 || text.trim() === question?.text}>{busy ? "저장 중…" : "저장"}</Button></div>
      </form>
    </div>
  </Modal>;
}
