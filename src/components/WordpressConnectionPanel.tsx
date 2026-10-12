"use client";

import { useCallback, useEffect, useState } from "react";
import { LoaderCircle, Plug, Trash2 } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui";
import type { WordpressConnectionView } from "@/lib/wordpress-connections";

/** WordPress 연결 (R07). 애플리케이션 비밀번호는 보내기만 하고 화면에 다시 표시하지 않는다. */
const PLUGIN_LABEL: Record<string, string> = { none: "SEO 플러그인 없음", yoast: "Yoast SEO", rankmath: "Rank Math", other: "기타" };
const empty = { siteUrl: "", username: "", applicationPassword: "", allowSeoPluginWrites: false };

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "요청을 처리하지 못했습니다.");
  return body;
}

export function WordpressConnectionPanel() {
  const [connection, setConnection] = useState<WordpressConnectionView | null | undefined>(undefined);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try { setConnection((await call<{ connection: WordpressConnectionView | null }>("/api/wordpress/connection")).connection); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "불러오지 못했습니다."); setConnection(null); }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    const reload = () => { void load(); };
    window.addEventListener("geo-master:project-changed", reload);
    return () => { window.clearTimeout(timer); window.removeEventListener("geo-master:project-changed", reload); };
  }, [load]);

  async function save() {
    setBusy(true); setError("");
    try {
      const result = await call<{ connection: WordpressConnectionView }>("/api/wordpress/connection", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(form) });
      setConnection(result.connection); setForm(empty); setEditing(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "연결하지 못했습니다."); }
    finally { setBusy(false); }
  }

  async function remove() {
    setBusy(true); setError("");
    try { await call("/api/wordpress/connection", { method: "DELETE" }); setConnection(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "삭제하지 못했습니다."); }
    finally { setBusy(false); }
  }

  if (connection === undefined) return null;
  return (
    <Card className="mb-5 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Plug className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-white">WordPress 연결</h2>
        {connection ? <><Badge tone="good">연결됨</Badge><Badge>{PLUGIN_LABEL[connection.seoPlugin] ?? connection.seoPlugin}</Badge>{connection.allowSeoPluginWrites && <Badge tone="warn">플러그인 메타 쓰기 허용</Badge>}</> : <Badge>연결 안 됨</Badge>}
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="secondary" disabled={busy} onClick={() => setEditing((value) => !value)}>{connection ? "다시 연결" : "연결하기"}</Button>
          {connection && <Button type="button" variant="danger" aria-label="WordPress 연결 삭제" disabled={busy} onClick={() => void remove()}><Trash2 className="h-4 w-4" /></Button>}
        </div>
      </div>
      {connection && <p className="mt-2 break-all text-xs text-slate-500">{connection.siteUrl} · {connection.username} · 확인 {connection.verifiedAt}</p>}
      {editing && (
        <form className="mt-3 grid gap-3 sm:grid-cols-3" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <label className="block text-xs">사이트 주소(https)<input className="mt-1" type="url" required placeholder="https://" value={form.siteUrl} onChange={(e) => setForm({ ...form, siteUrl: e.target.value })} /></label>
          <label className="block text-xs">사용자명<input className="mt-1" required autoComplete="off" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></label>
          <label className="block text-xs">애플리케이션 비밀번호<input className="mt-1" type="password" required autoComplete="new-password" value={form.applicationPassword} onChange={(e) => setForm({ ...form, applicationPassword: e.target.value })} /></label>
          <label className="flex items-start gap-2 text-xs text-slate-300 sm:col-span-3">
            <input type="checkbox" checked={form.allowSeoPluginWrites} onChange={(e) => setForm({ ...form, allowSeoPluginWrites: e.target.checked })} />
            <span>Yoast SEO의 제목·설명 메타를 승인된 수정안에 한해 직접 쓰도록 허용합니다. 다른 필드와 플러그인은 수동 적용 안내만 합니다.</span>
          </label>
          <p className="text-[11px] text-slate-500 sm:col-span-2">WordPress 사용자 프로필의 &quot;애플리케이션 비밀번호&quot;를 쓰세요. 로그인 비밀번호가 아닙니다. 저장 전에 연결과 글 편집 권한을 확인하며, 비밀번호는 암호화해 저장하고 다시 표시하지 않습니다.</p>
          <div className="flex justify-end"><Button type="submit" disabled={busy}>{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}연결 확인 후 저장</Button></div>
        </form>
      )}
      {error && <p role="alert" className="mt-3 rounded-lg bg-rose-400/10 p-2 text-xs text-rose-300">{error}</p>}
    </Card>
  );
}
