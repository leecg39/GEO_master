"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

const openDialogs = new Set<HTMLDialogElement>();
const lastDialogFocus = new WeakMap<HTMLDialogElement, HTMLElement>();
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
    const parentDialog = [...openDialogs].at(-1);
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Async launchers may temporarily disable themselves and move focus to body.
    const previousFocus = parentDialog && (!activeElement || !parentDialog.contains(activeElement))
      ? lastDialogFocus.get(parentDialog) ?? parentDialog
      : activeElement;
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
      onFocusCapture={(event) => {
        if (event.target instanceof HTMLElement && event.currentTarget.contains(event.target)) {
          lastDialogFocus.set(event.currentTarget, event.target);
        }
      }}
      onCancel={(event) => { event.preventDefault(); event.stopPropagation(); if (!busy) onClose(); }}
      onKeyDown={(event) => {
        if (event.key !== "Tab" || [...openDialogs].at(-1) !== event.currentTarget) return;
        const items = [...event.currentTarget.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]',
        )].filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0 && !element.closest("[inert]") && getComputedStyle(element).visibility !== "hidden");
        const first = items[0]; const last = items.at(-1);
        if (!first) { event.preventDefault(); return; }
        if ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last) || !items.includes(document.activeElement as HTMLElement)) {
          event.preventDefault(); event.stopPropagation();
          (event.shiftKey ? last : first)?.focus();
        }
      }}
    >
      {children}
    </dialog>,
    document.body,
  );
}
