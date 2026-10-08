"use client";

import { useState } from "react";
import { FolderSearch, LoaderCircle } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui";

interface File { path: string; tier: "standard" | "optional"; purpose: string; state: "present" | "missing" | "unknown"; detail: string; contentType: string | null; warnings: string[] }
const STATE = { present: { label: "있음", tone: "good" }, missing: { label: "없음", tone: "bad" }, unknown: { label: "확인 불가", tone: "warn" } } as const;

/** 공개 사이트의 AI 파일 묶음을 실제로 요청해 상태를 보여 준다 (선택 파일은 보편 규격이 아님) */
export function AiFileBundlePanel({ website }: { website: string }) {
  const [files, setFiles] = useState<File[] | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function check() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/llms-documents/bundle", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ website }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "확인하지 못했습니다.");
      setFiles(body.bundle.files); setNote(body.bundle.note);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "확인하지 못했습니다."); } finally { setBusy(false); }
  }

  return (
    <Card className="mt-5 print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="font-semibold text-white">AI 파일 묶음 확인</h2><p className="mt-1 text-xs text-slate-500">llms.txt, llms-ko.txt, ai.txt, ai-ko.txt를 공개 사이트에서 실제로 요청해 확인합니다.</p></div>
        <Button type="button" variant="secondary" disabled={!website || busy} onClick={() => void check()}>{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FolderSearch className="h-4 w-4" />}묶음 확인</Button>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p>}
      {files && (
        <>
          <ul className="mt-3 divide-y divide-white/5 text-sm">
            {files.map((file) => (
              <li key={file.path} className="flex flex-wrap items-center gap-2 py-2">
                <code className="text-slate-200">{file.path}</code>
                <Badge tone={STATE[file.state].tone}>{STATE[file.state].label}</Badge>
                {file.tier === "optional" && <Badge>선택</Badge>}
                <span className="text-xs text-slate-500">{file.purpose} · {file.detail}{file.contentType ? ` · ${file.contentType}` : ""}</span>
                {file.warnings.map((warning) => <span key={warning} className="basis-full text-xs text-amber-300">{warning}</span>)}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-slate-500">{note}</p>
        </>
      )}
    </Card>
  );
}
