"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { Button } from "@/components/ui";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  busy?: boolean;
  destructive?: boolean;
  requiredText?: string;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}

export function ConfirmDialog({
  open, title, description, confirmLabel = "확인", busy = false, destructive = false,
  requiredText, onClose, onConfirm,
}: ConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [typed, setTyped] = useState("");

  const close = useCallback(() => {
    if (busy) return;
    setTyped("");
    onClose();
  }, [busy, onClose]);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("keydown", escape);
      previousFocus.current?.focus();
    };
  }, [close, open]);

  if (!open) return null;
  const confirmationMatches = !requiredText || typed === requiredText;
  return <div className="fixed inset-0 z-[70] grid place-items-center bg-black/70 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <section role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} className="w-full max-w-lg rounded-2xl border border-white/10 bg-slate-950 p-5 shadow-2xl">
      <div className="flex items-start justify-between gap-4"><div><h2 id={titleId} className="text-lg font-semibold text-white">{title}</h2><div id={descriptionId} className="mt-2 text-sm leading-6 text-slate-400">{description}</div></div><button type="button" aria-label="닫기" disabled={busy} onClick={close} className="rounded-lg p-1.5 text-slate-500 hover:bg-white/5 hover:text-white"><X className="h-4 w-4" /></button></div>
      {requiredText && <label className="mt-4 block text-xs text-slate-400">확인을 위해 <strong className="text-slate-200">{requiredText}</strong> 입력<input className="mt-2" value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" /></label>}
      <div className="mt-5 flex justify-end gap-2"><Button ref={cancelRef} type="button" variant="secondary" disabled={busy} onClick={close}>취소</Button><Button type="button" variant={destructive ? "danger" : "primary"} disabled={busy || !confirmationMatches} onClick={() => void onConfirm()}>{busy ? "처리 중…" : confirmLabel}</Button></div>
    </section>
  </div>;
}

interface DetailDrawerProps {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  busy?: boolean;
  onClose: () => void;
}

export function DetailDrawer({ open, title, description, children, footer, busy = false, onClose }: DetailDrawerProps) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onClose(); };
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("keydown", escape);
      previousFocus.current?.focus();
    };
  }, [busy, onClose, open]);

  if (!open) return null;
  return <div className="fixed inset-0 z-[60] bg-black/55" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <aside role="dialog" aria-modal="true" aria-labelledby={titleId} className="ml-auto flex h-full w-full max-w-2xl flex-col border-l border-white/10 bg-slate-950 shadow-2xl">
      <header className="flex items-start justify-between gap-4 border-b border-white/8 p-5"><div><h2 id={titleId} className="text-lg font-semibold text-white">{title}</h2>{description && <p className="mt-1 text-xs text-slate-500">{description}</p>}</div><button ref={closeRef} type="button" aria-label="상세 닫기" disabled={busy} onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-white/5 hover:text-white"><X className="h-5 w-5" /></button></header>
      <div className="flex-1 overflow-y-auto p-5">{children}</div>
      {footer && <footer className="border-t border-white/8 p-4">{footer}</footer>}
    </aside>
  </div>;
}

export function CrudListToolbar({
  query, onQueryChange, placeholder = "검색", children,
}: { query: string; onQueryChange: (value: string) => void; placeholder?: string; children?: ReactNode }) {
  return <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><label className="relative block flex-1"><span className="sr-only">{placeholder}</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" /><input className="pl-9" type="search" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder={placeholder} /></label>{children && <div className="flex flex-wrap gap-2">{children}</div>}</div>;
}

export function CursorPagination({
  canPrevious, hasMore, busy = false, onPrevious, onNext,
}: { canPrevious: boolean; hasMore: boolean; busy?: boolean; onPrevious: () => void; onNext: () => void }) {
  return <nav aria-label="목록 페이지" className="flex items-center justify-end gap-2"><Button type="button" variant="secondary" disabled={busy || !canPrevious} onClick={onPrevious}><ChevronLeft className="h-4 w-4" />이전</Button><Button type="button" variant="secondary" disabled={busy || !hasMore} onClick={onNext}>다음<ChevronRight className="h-4 w-4" /></Button></nav>;
}
