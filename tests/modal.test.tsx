/** @vitest-environment jsdom */
import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Modal } from "@/components/Modal";

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } });
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  document.body.replaceChildren(); document.body.style.overflow = "";
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
async function mount(node: React.ReactNode) {
  const container = document.createElement("div"); document.body.append(container);
  root = createRoot(container); await act(async () => root.render(node));
}
function Stack() {
  const [drawer, setDrawer] = useState(false); const [confirm, setConfirm] = useState(false);
  const drawerFocus = useRef<HTMLButtonElement>(null); const cancelFocus = useRef<HTMLButtonElement>(null);
  return <><button id="launch" onClick={() => setDrawer(true)}>열기</button>
    <Modal open={drawer} labelledBy="drawer-title" initialFocus={drawerFocus} onClose={() => setDrawer(false)}>
      <h2 id="drawer-title">관리</h2><button ref={drawerFocus} id="nested" onClick={(event) => { event.currentTarget.blur(); setConfirm(true); }}>삭제</button>
      <Modal open={confirm} labelledBy="confirm-title" initialFocus={cancelFocus} onClose={() => setConfirm(false)}>
        <h2 id="confirm-title">확인</h2><button ref={cancelFocus}>취소</button>
      </Modal>
    </Modal></>;
}
async function click(id: string) { await act(async () => { const e = document.getElementById(id)!; e.focus(); e.click(); }); }
async function escapeTop() { await act(async () => document.querySelectorAll("dialog")[document.querySelectorAll("dialog").length - 1].dispatchEvent(new Event("cancel", { cancelable: true }))); }
it("keeps the parent open and scrolling locked when a nested dialog closes", async () => {
  document.body.style.overflow = "auto";
  await mount(<Stack />); await click("launch"); await click("nested");
  expect(document.querySelectorAll("dialog")).toHaveLength(2);
  expect(document.activeElement?.textContent).toBe("취소");
  await escapeTop();
  expect(document.querySelectorAll("dialog")).toHaveLength(1);
  expect(document.body.style.overflow).toBe("hidden");
  expect(document.activeElement?.id).toBe("nested");
  await escapeTop();
  expect(document.querySelector("dialog")).toBeNull();
  expect(document.body.style.overflow).toBe("auto");
  expect(document.activeElement?.id).toBe("launch");
});
it("prevents native Escape from dismissing a busy action", async () => {
  const onClose = vi.fn();
  await mount(<Modal open labelledBy="title" busy onClose={onClose}><h2 id="title">저장 중</h2></Modal>);
  const event = new Event("cancel", { cancelable: true });
  await act(async () => document.querySelector("dialog")!.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true); expect(onClose).not.toHaveBeenCalled();
});

it("requires fresh confirmation text after a successful close and reopen", async () => {
  const { ConfirmDialog } = await import("@/components/CrudPrimitives");
  function ConfirmationFlow() {
    const [open, setOpen] = useState(true);
    return <><button id="reopen" onClick={() => setOpen(true)}>다시 열기</button><ConfirmDialog open={open} title="삭제 확인" description="다시 확인하세요" requiredText="확인" confirmLabel="삭제 실행" onClose={() => setOpen(false)} onConfirm={() => setOpen(false)} /></>;
  }
  await mount(<ConfirmationFlow />);
  const input = document.querySelector("dialog input") as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "확인");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const confirm = [...document.querySelectorAll<HTMLButtonElement>("dialog button")].find(b => b.textContent === "삭제 실행")!;
  expect(confirm.disabled).toBe(false);
  await act(async () => confirm.click());
  await click("reopen");
  expect((document.querySelector("dialog input") as HTMLInputElement).value).toBe("");
  expect([...document.querySelectorAll<HTMLButtonElement>("dialog button")].find(b => b.textContent === "삭제 실행")?.disabled).toBe(true);
});
