import { useEffect, useState } from "react";
import { Gauge, LoaderCircle } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui";

/** PageSpeed Insights (A7). 진단 화면(클라이언트) 안에서만 쓴다. 실험실 측정과 실사용자 측정을 따로 보여 주고 진단 점수에 넣지 않는다. */
interface Result {
  url: string; strategy: "mobile" | "desktop"; measuredAt: string;
  lab: { performanceScore: number | null; lcpMs: number | null; cls: number | null; tbtMs: number | null; fcpMs: number | null } | null;
  field: { scope: "page" | "origin"; overall: string | null; metrics: Array<{ key: string; label: string; p75: string; category: string | null }> } | null;
}
const CATEGORY: Record<string, { label: string; tone: "good" | "warn" | "bad" }> = { FAST: { label: "좋음", tone: "good" }, AVERAGE: { label: "개선 필요", tone: "warn" }, SLOW: { label: "나쁨", tone: "bad" } };

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "요청을 처리하지 못했습니다.");
  return body;
}

function Lab({ lab }: { lab: NonNullable<Result["lab"]> }) {
  const rows: Array<[string, string]> = [
    ["성능 점수", lab.performanceScore === null ? "-" : `${lab.performanceScore}`], ["LCP", lab.lcpMs === null ? "-" : `${lab.lcpMs}ms`],
    ["CLS", lab.cls === null ? "-" : lab.cls.toFixed(3)], ["TBT", lab.tbtMs === null ? "-" : `${lab.tbtMs}ms`], ["FCP", lab.fcpMs === null ? "-" : `${lab.fcpMs}ms`],
  ];
  return <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">{rows.map(([label, value]) => <div key={label} className="rounded-lg bg-slate-950/40 p-2"><dt className="text-xs text-slate-500">{label}</dt><dd className="text-sm font-semibold text-white">{value}</dd></div>)}</dl>;
}

export function PageSpeedPanel({ url }: { url: string }) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    call<{ configured: boolean }>("/api/pagespeed/key").then((status) => { if (active) setConfigured(status.configured); }).catch(() => { if (active) setConfigured(false); });
    return () => { active = false; };
  }, []);

  async function run(action: () => Promise<void>) {
    setBusy(true); setError("");
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : "처리하지 못했습니다."); } finally { setBusy(false); }
  }
  const measure = (strategy: "mobile" | "desktop") => run(async () => setResult((await call<{ result: Result }>(`/api/pagespeed?url=${encodeURIComponent(url)}&strategy=${strategy}`)).result));
  const saveKey = () => run(async () => { await call("/api/pagespeed/key", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ apiKey }) }); setApiKey(""); setConfigured(true); });

  if (configured === null) return null;
  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-center gap-2">
        <Gauge className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        <h2 className="text-base font-bold text-white">페이지 속도 (PageSpeed Insights)</h2>
        <span className="text-xs text-slate-500">진단 점수에는 반영하지 않습니다</span>
      </div>
      {!configured ? (
        <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={(event) => { event.preventDefault(); void saveKey(); }}>
          <input aria-label="PageSpeed API 키" type="password" autoComplete="off" className="flex-1" placeholder="Google Cloud의 PageSpeed Insights API 키" value={apiKey} onChange={(event) => setApiKey(event.target.value)} />
          <Button type="submit" disabled={busy || apiKey.trim().length < 20}>키 저장</Button>
        </form>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" variant="secondary" disabled={busy} onClick={() => void measure("mobile")}>{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}모바일 측정</Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => void measure("desktop")}>데스크톱 측정</Button>
        </div>
      )}
      {error && <p role="alert" className="mt-3 text-xs text-rose-300">{error}</p>}
      {result && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <section>
            <h3 className="text-sm font-semibold text-white">실험실 측정 <span className="text-xs font-normal text-slate-500">Lighthouse 1회 · {result.strategy === "mobile" ? "모바일" : "데스크톱"}</span></h3>
            {result.lab ? <Lab lab={result.lab} /> : <p className="mt-2 text-xs text-slate-500">실험실 측정 결과가 없습니다.</p>}
          </section>
          <section>
            <h3 className="text-sm font-semibold text-white">실사용자 측정 <span className="text-xs font-normal text-slate-500">CrUX 지난 28일 p75 · {result.field?.scope === "origin" ? "사이트 전체 기준" : "이 페이지 기준"}</span></h3>
            {result.field ? (
              <ul className="mt-2 space-y-1.5">{result.field.metrics.map((metric) => <li key={metric.key} className="flex items-center justify-between rounded-lg bg-slate-950/40 p-2 text-sm"><span className="text-slate-300">{metric.label}</span><span className="flex items-center gap-2 text-white">{metric.p75}{metric.category && <Badge tone={CATEGORY[metric.category]?.tone ?? "default"}>{CATEGORY[metric.category]?.label ?? metric.category}</Badge>}</span></li>)}</ul>
            ) : <p className="mt-2 text-xs text-slate-500">실사용자 데이터가 부족해 Google이 제공하지 않았습니다.</p>}
          </section>
        </div>
      )}
    </Card>
  );
}
