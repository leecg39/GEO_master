"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

const openDialogs = new Set<HTMLDialogElement>();
let previousOverflow = "";

/** Native modal dialogs provide inert backgrounds and a focus boundary, including nested dialogs. */
export function Modal({ open, labelledBy, describedBy, role = "dialog", busy = false, initialFocus, onClose, children }: {
  open: boolean;
  labelledBy: string;
  describedBy?: string;
  role?: "dialog" | "alertdialog";
  busy?: boolean;
  initialFocus?: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!openDialogs.size) previousOverflow = document.body.style.overflow;
    openDialogs.add(dialog);
    document.body.style.overflow = "hidden";
    dialog.showModal();
    initialFocus?.current?.focus();
    return () => {
      dialog.close();
      openDialogs.delete(dialog);
      if (!openDialogs.size) document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [open, initialFocus]);

  if (!open) return null;
  return createPortal(
    <dialog
      ref={dialogRef}
      role={role}
      aria-modal="true"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      className="m-0 h-dvh max-h-none w-screen max-w-none overflow-y-auto border-0 bg-transparent p-0 text-inherit outline-none backdrop:bg-black/60"
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
    >
      {children}
    </dialog>,
    document.body,
  );
}
