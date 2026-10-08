/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/components/AiFileBundlePanel", () => ({ AiFileBundlePanel: () => null }));
vi.mock("@/components/LlmsHistoryPanel", () => ({ LlmsHistoryPanel: () => null }));
import { LlmsTxtClient } from "@/components/LlmsTxtClient";

const local = "# Local draft\n\n> 내가 편집하고 있는 공개 사이트의 안내 문서입니다.\n";
const remote = "# Remote file\n\n> 서버에서 가져온 공개 사이트의 안내 문서입니다.\n";
const valid = { valid: true, score: 100, issues: [], stats: { bytes: 100, lines: 4, sections: 0, links: 0, errors: 0, warnings: 0 } };
type Handler = (body: Record<string, unknown>) => Promise<Response>;
let handler: Handler;
let root: Root;
let host: HTMLDivElement;
let pending: ((response: Response) => void) | undefined;
function field(selector: string) { const element = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector); expect(element, selector).not.toBeNull(); return element!; }
const editor = () => field('textarea[aria-label="llms.txt 내용"]');
const site = () => field('input[placeholder="https://example.com"]');
const scope = () => field('input[placeholder="/llms.txt"]');
function button(text: string) { return [...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent?.trim() === text); }
async function fill(element: HTMLInputElement | HTMLTextAreaElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); }); }
async function click(text: string) { const element = button(text); expect(element, text).toBeDefined(); await act(async () => element!.click()); }
function response(text = remote) { return Response.json({ result: { document: text, validation: valid, url: "https://example.com/llms.txt", contentType: "text/plain" } }); }
function defer(action: string) { const previousHandler = handler; handler = body => body.action === action ? new Promise(resolve => { pending = resolve; }) : previousHandler(body); }
async function resolvePending(value = response()) { expect(pending).toBeDefined(); await act(async () => pending!(value)); }
async function mountDraft() {
  root = createRoot(host);
  await act(async () => root.render(<LlmsTxtClient />));
  await fill(site(), "https://example.com");
  await fill(field('textarea[placeholder^="누구에게"]'), "공식 사이트의 사용 안내와 문서 목록을 제공합니다.");
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(editor().value).toBe(local);
}
const hasRemoteSuccess = () => host.textContent!.includes("확인: https://example.com/llms.txt");
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); pending = undefined;
  handler = async body => body.action === "generate" ? response(local) : response();
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/measurement-context")) return Response.json({ settings: { brandName: "Example", category: "" } });
    if (url === "/api/llms") return handler(JSON.parse(String(init?.body)) as Record<string, unknown>);
    if (url.startsWith("/api/llms-documents")) return Response.json({ items: [] });
    throw new Error(`Unexpected request: ${url}`);
  }));
});
afterEach(async () => { if (root) await act(async () => root.unmount()); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("preview", () => {
  it("checks the remote file without overwriting the editor", async () => { await mountDraft(); await click("원격 /llms.txt 확인"); expect(editor().value).toBe(local); expect(hasRemoteSuccess()).toBe(true); });
  it("requires an explicit import to replace the local draft", async () => { await mountDraft(); await click("원격 /llms.txt 확인"); await click("원격 내용 가져오기"); expect(editor().value).toBe(remote); });
  it("keeps the local document on HTTP failure", async () => { await mountDraft(); handler = async () => Response.json({ error: "인증이 필요합니다(HTTP 401)." }, { status: 422 }); await click("원격 /llms.txt 확인"); expect(editor().value).toBe(local); expect(host.querySelector('[role="alert"]')?.textContent).toContain("401"); expect(hasRemoteSuccess()).toBe(false); });
  it("does not present invalid remote Markdown as a successful deployment", async () => { await mountDraft(); handler = async () => Response.json({ result: { document: "Not Found", validation: { ...valid, valid: false }, url: "https://example.com/llms.txt", contentType: "text/plain" } }); await click("원격 /llms.txt 확인"); expect(editor().value).toBe(local); expect(hasRemoteSuccess()).toBe(false); });
});
describe("freshness", () => {
  it("clears remote evidence after the site URL changes", async () => { await mountDraft(); await click("원격 /llms.txt 확인"); await fill(site(), "https://other.example"); expect(hasRemoteSuccess()).toBe(false); });
  it("clears remote evidence after the scope changes", async () => { await mountDraft(); await click("원격 /llms.txt 확인"); await fill(scope(), "/docs/llms.txt"); expect(hasRemoteSuccess()).toBe(false); });
  it("ignores a remote response for an old URL", async () => { await mountDraft(); defer("remote"); await click("원격 /llms.txt 확인"); await fill(site(), "https://other.example"); await resolvePending(); expect(editor().value).toBe(local); expect(hasRemoteSuccess()).toBe(false); });
  it("ignores validation that finishes after the editor changes", async () => { await mountDraft(); defer("validate"); await click("검증"); await fill(editor(), "No H1 now"); await resolvePending(); expect(editor().value).toBe("No H1 now"); expect(button("다운로드")!.disabled).toBe(true); });
  it("ignores a generated draft that finishes after user editing", async () => { await mountDraft(); defer("generate"); await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); await fill(editor(), "# User edit\n"); await resolvePending(); expect(editor().value).toBe("# User edit\n"); });
});
describe("project", () => {
  it("clears the previous project's draft and verification on switching projects", async () => { await mountDraft(); await click("원격 /llms.txt 확인"); await act(async () => window.dispatchEvent(new Event("geo-master:project-changed"))); expect(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="llms.txt 내용"]')?.value ?? "").toBe(""); expect(site().value).toBe(""); expect(hasRemoteSuccess()).toBe(false); });
  it("ignores an old project's in-flight result", async () => { await mountDraft(); defer("remote"); await click("원격 /llms.txt 확인"); await act(async () => window.dispatchEvent(new Event("geo-master:project-changed"))); await resolvePending(); expect(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="llms.txt 내용"]')?.value ?? "").toBe(""); expect(hasRemoteSuccess()).toBe(false); });
});
