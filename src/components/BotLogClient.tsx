"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, LoaderCircle, Trash2, Upload } from "lucide-react";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui";
import { requestJson as request, toBase64 } from "@/lib/client-upload";

type Purpose = "search" | "training" | "user";
interface Item {
  id: number; fileName: string; format: "combined" | "common"; periodStart: string; periodEnd: string; offsets: string[]; dnsChecked: boolean; importedAt: string;
  totals: { lines: number; parsed: number; skipped: number; aiBot: number; self: number; other: number };
}
interface BotRow { botToken: string; operator: string; purpose: Purpose; dnsVerifiable: boolean; hits: number; verifiedHits: number; failedHits: number; uncheckedHits: number; statusClasses: Record<string, number> }
interface Detail extends Item { bots: BotRow[]; paths: Array<{ botToken: string; path: string; hits: number }> }

const MAX_BYTES = 10 * 1024 * 1024;
const PURPOSES: Array<[Purpose, string, string]> = [
  ["search", "검색 색인", "검색 답변·결과에 쓰일 수 있는 수집"],
  ["user", "사용자 요청 방문", "사용자가 대화 중 요청해 가져간 방문"],
  ["training", "모델 학습", "학습용 수집 — 검색 노출과 별개"],
];

function Trust({ bot, dnsChecked }: { bot: BotRow; dnsChecked: boolean }) {
  return (
    <span className="flex flex-wrap gap-1">
      {bot.verifiedHits > 0 && <Badge tone="good">DNS 확인 {bot.verifiedHits}</Badge>}
      {bot.failedHits > 0 && <Badge tone="bad">DNS 불일치 {bot.failedHits} · 위장 의심</Badge>}
      {bot.uncheckedHits > 0 && <Badge tone="warn">{dnsChecked && bot.dnsVerifiable ? "DNS 미확인" : "UA 자기 신고"} {bot.uncheckedHits}</Badge>}
    </span>
  );
}

function DetailView({ detail }: { detail: Detail }) {
  return (
    <div className="mt-4 space-y-4">
      {PURPOSES.map(([purpose, label, hint]) => {
        const bots = detail.bots.filter((bot) => bot.purpose === purpose);
        return (
          <div key={purpose}>
            <h3 className="text-xs font-semibold text-slate-300">{label} <span className="font-normal text-slate-500">· {hint}</span></h3>
            {bots.length === 0 ? <p className="mt-1 text-xs text-slate-500">이 로그에서 관측되지 않았습니다.</p> : (
              <table className="mt-2 w-full table-fixed text-left text-xs">
                <thead className="text-slate-500"><tr><th className="w-[34%] py-1">봇</th><th className="w-[12%]">방문</th><th className="w-[26%]">응답</th><th>신뢰도</th></tr></thead>
                <tbody>
                  {bots.map((bot) => (
                    <tr key={bot.botToken} className="border-t border-white/5 align-top">
                      <td className="py-1.5 text-white">{bot.botToken} <span className="text-slate-500">({bot.operator})</span></td>
                      <td>{bot.hits.toLocaleString("ko-KR")}</td>
                      <td className="text-slate-400">{Object.entries(bot.statusClasses).sort(([a], [b]) => a.localeCompare(b)).map(([cls, count]) => `${cls} ${count}`).join(" · ")}</td>
                      <td><Trust bot={bot} dnsChecked={detail.dnsChecked} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
      {detail.paths.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-slate-400">봇별 상위 경로</summary>
          <ul className="mt-2 space-y-0.5 text-slate-400">
            {detail.paths.map((row) => <li key={`${row.botToken}${row.path}`}><span className="text-slate-500">{row.botToken}</span> {row.path} · {row.hits}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

export function BotLogClient() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [details, setDetails] = useState<Record<number, Detail>>({});
  const [open, setOpen] = useState<number | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [verifyDns, setVerifyDns] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try { setItems((await request<{ items: Item[] }>("/api/bot-logs")).items); setDetails({}); setOpen(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "불러오지 못했습니다."); setItems([]); }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    const reload = () => { void load(); };
    window.addEventListener("geo-master:project-changed", reload);
    return () => { window.clearTimeout(timer); window.removeEventListener("geo-master:project-changed", reload); };
  }, [load]);

  function choose(selected: File | null) {
    setError(""); setNotice("");
    if (selected && selected.size > MAX_BYTES) { setError("파일이 너무 큽니다(10MB 이하, gzip 가능)."); return; }
    setFile(selected);
  }

  async function upload() {
    if (!file) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await request<{ duplicate: boolean; import: Item }>("/api/bot-logs", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileName: file.name, contentBase64: toBase64(await file.arrayBuffer()), verifyDns }),
      });
      setNotice(result.duplicate ? "이미 가져온 로그입니다." : `가져왔습니다 — ${result.import.totals.parsed.toLocaleString("ko-KR")}줄 해석, ${result.import.totals.skipped.toLocaleString("ko-KR")}줄 건너뜀.`);
      setFile(null); if (input.current) input.current.value = "";
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "가져오지 못했습니다."); } finally { setBusy(false); }
  }

  async function toggle(id: number) {
    if (open === id) { setOpen(null); return; }
    setOpen(id);
    if (details[id]) return;
    try {
      const { import: detail } = await request<{ import: Detail }>(`/api/bot-logs/${id}`);
      setDetails((current) => ({ ...current, [id]: detail }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "불러오지 못했습니다."); }
  }

  async function remove(id: number) {
    try { await request(`/api/bot-logs/${id}`, { method: "DELETE" }); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "삭제하지 못했습니다."); }
  }

  if (!items) return <div className="grid min-h-96 place-items-center"><LoaderCircle className="h-7 w-7 animate-spin text-cyan-400" /></div>;
  return (
    <div>
      <PageHeader eyebrow="Bot observation" title="AI 봇 방문 로그" description="서버나 CDN의 접근 로그(Nginx/Apache combined 형식, gzip 가능)를 올리면 AI 크롤러 방문을 검색·사용자 요청·학습 목적별로 나눠 집계합니다. IP와 쿼리스트링은 저장하지 않고 일자·봇·응답 대역 집계와 상위 경로만 남깁니다." />
      <Card className="mb-5 space-y-4">
        <label className="block text-xs">접근 로그 파일 (10MB 이하, .log·.txt·.gz)
          <input ref={input} className="mt-1.5" type="file" accept=".log,.txt,.gz,text/plain,application/gzip" onChange={(event) => choose(event.target.files?.[0] ?? null)} />
        </label>
        <label className="flex items-start gap-2 text-xs text-slate-400">
          <input type="checkbox" className="mt-0.5" checked={verifyDns} onChange={(event) => setVerifyDns(event.target.checked)} />
          <span>Googlebot·Bingbot을 역방향·정방향 DNS로 확인합니다(봇당 최대 20개 IP, 외부 DNS 질의 발생). 다른 봇은 User-Agent 자기 신고로만 분류됩니다.</span>
        </label>
        <Button type="button" disabled={busy || !file} onClick={() => void upload()}>{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}가져오기</Button>
        {notice && <p role="status" className="text-sm text-emerald-300">{notice}</p>}
        {error && <p role="alert" className="text-sm text-amber-300">{error}</p>}
      </Card>
      {items.length === 0 ? (
        <EmptyState>연결 안 됨 — 로그를 올리기 전에는 방문 0회가 아니라 관측 정보가 없는 상태입니다.</EmptyState>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <Card key={item.id}>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="flex items-center gap-1 text-left" aria-expanded={open === item.id} onClick={() => void toggle(item.id)}>
                  {open === item.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  <strong className="text-white">{item.fileName}</strong>
                </button>
                <Badge>접근 로그</Badge>
                {item.format === "common" && <Badge tone="warn">User-Agent 없음 · 봇 분류 불가</Badge>}
                <Badge tone={item.dnsChecked ? "good" : "default"}>{item.dnsChecked ? "DNS 확인 실행" : "DNS 확인 안 함"}</Badge>
                <span className="text-xs text-slate-500">{item.periodStart} ~ {item.periodEnd} (로그 시간대 {item.offsets.join(", ")})</span>
                <Button type="button" variant="danger" className="ml-auto" aria-label={`${item.fileName} 삭제`} onClick={() => void remove(item.id)}><Trash2 className="h-4 w-4" /></Button>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div><dt className="text-xs text-slate-500">AI 봇 방문</dt><dd className="text-white">{item.totals.aiBot.toLocaleString("ko-KR")}</dd></div>
                <div><dt className="text-xs text-slate-500">GEO Master 자체 진단</dt><dd className="text-white">{item.totals.self.toLocaleString("ko-KR")}</dd></div>
                <div><dt className="text-xs text-slate-500">그 밖의 요청</dt><dd className="text-white">{item.totals.other.toLocaleString("ko-KR")}</dd></div>
                <div><dt className="text-xs text-slate-500">해석 / 건너뜀</dt><dd className="text-white">{item.totals.parsed.toLocaleString("ko-KR")} / {item.totals.skipped.toLocaleString("ko-KR")}</dd></div>
              </dl>
              {open === item.id && (details[item.id] ? <DetailView detail={details[item.id]!} /> : <LoaderCircle className="mt-4 h-5 w-5 animate-spin text-cyan-400" />)}
            </Card>
          ))}
          <p className="text-xs text-slate-500">User-Agent는 누구나 꾸밀 수 있어 자기 신고만으로 진위를 확정하지 않습니다. Firecrawl 등 외부 수집 서비스를 거친 GEO Master 요청은 해당 서비스의 User-Agent로 기록되어 자체 진단으로 구분되지 않습니다. 봇 방문 증가가 인용·매출 증가를 뜻하지는 않습니다.</p>
        </div>
      )}
    </div>
  );
}
