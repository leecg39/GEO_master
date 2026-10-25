import { useState } from "react";
import { LoaderCircle, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui";

/** 클라이언트 컴포넌트(ChangeItemsClient) 안에서만 쓴다. 승인된 수정안 1건을 WordPress에 쓰기 전에 대상과 값을 보여 주고, 확인 후에만 쓴다 (R08). */
interface Preview {
  site: string; postId: number; postType: string; metaKey: string; storedValue: string; publicValue: string | null; proposedValue: string; previewToken: string;
}

async function post<T>(id: number, body: unknown): Promise<T> {
  const response = await fetch(`/api/change-items/${id}/wordpress`, { method: "POST", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "WordPress 요청을 처리하지 못했습니다.");
  return data;
}

export function WordpressDeliveryPanel({ changeId, onDone }: { changeId: number; onDone: () => void }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(action: () => Promise<void>) {
    setBusy(true); setError("");
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : "처리하지 못했습니다."); } finally { setBusy(false); }
  }

  return (
    <div className="w-full">
      {!preview && <Button type="button" variant="secondary" disabled={busy} onClick={() => void run(async () => setPreview((await post<{ preview: Preview }>(changeId, { action: "preview" })).preview))}>
        {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}WordPress에 쓰기 미리보기
      </Button>}
      {preview && (
        <div className="mt-2 rounded-xl border border-amber-400/20 bg-amber-400/[0.05] p-3 text-xs text-slate-300">
          <p className="font-semibold text-amber-200">이 값을 WordPress에 씁니다</p>
          <dl className="mt-2 grid gap-1 sm:grid-cols-[8rem_1fr]">
            <dt className="text-slate-500">대상</dt><dd className="break-all">{preview.site} · {preview.postType} #{preview.postId} · {preview.metaKey}</dd>
            <dt className="text-slate-500">지금 저장값</dt><dd className="whitespace-pre-wrap break-all">{preview.storedValue || "(비어 있음 — 플러그인 기본 템플릿 사용)"}</dd>
            <dt className="text-slate-500">지금 공개 값</dt><dd className="whitespace-pre-wrap break-all">{preview.publicValue ?? "(없음)"}</dd>
            <dt className="text-slate-500">쓸 값</dt><dd className="whitespace-pre-wrap break-all text-cyan-200">{preview.proposedValue}</dd>
          </dl>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" disabled={busy} onClick={() => void run(async () => { await post(changeId, { action: "execute", previewToken: preview.previewToken }); setPreview(null); onDone(); })}>쓰기 실행</Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setPreview(null)}>취소</Button>
          </div>
          <p className="mt-2 text-xs text-slate-500">쓴 뒤에는 &apos;반영 확인&apos;으로 공개 페이지를 다시 읽어야 반영으로 표시됩니다. 이전 저장값은 전달 이력에 남습니다.</p>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-rose-300">{error}</p>}
    </div>
  );
}
