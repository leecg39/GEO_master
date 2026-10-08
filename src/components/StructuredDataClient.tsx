"use client";

import { useState } from "react";
import { Check, Clipboard, LoaderCircle, Wand2 } from "lucide-react";
import { Badge, Button, Card, PageHeader } from "@/components/ui";

type JsonLdType = "Organization" | "WebSite" | "WebPage" | "Product" | "BreadcrumbList" | "BlogPosting";
interface Result {
  jsonLd: Record<string, unknown> | null; missing: string[]; blocked: { field: string; reason: string }[];
  issues: { code: string; severity: string; message: string }[]; blocking: { code: string; message: string }[];
  duplicates: { type: string; id: string | null }[]; pageChecked: boolean; publishable: boolean;
}

const TYPES: Record<JsonLdType, { label: string; fields: Array<[string, string, string?]> }> = {
  Organization: { label: "조직", fields: [["name", "이름"], ["url", "대표 URL", "https://"], ["description", "설명"], ["logo", "로고 URL", "https://"], ["sameAs", "공식 프로필 URL (쉼표 구분)"]] },
  WebSite: { label: "웹사이트", fields: [["name", "이름"], ["url", "URL", "https://"], ["description", "설명"]] },
  WebPage: { label: "웹페이지", fields: [["name", "이름"], ["url", "URL", "https://"], ["description", "설명"]] },
  Product: { label: "상품", fields: [["name", "이름"], ["url", "상품 URL", "https://"], ["description", "설명"], ["price", "가격 (숫자)"], ["priceCurrency", "통화 (KRW 등)"], ["priceEvidence", "가격 근거 URL", "https://"], ["ratingValue", "평점"], ["ratingCount", "평가 수"], ["ratingEvidence", "평점 근거 URL", "https://"]] },
  BreadcrumbList: { label: "탐색 경로", fields: [["items", "경로 (줄마다 '이름 | URL')"]] },
  BlogPosting: { label: "블로그 글", fields: [["headline", "제목"], ["url", "글 URL", "https://"], ["description", "요약"], ["datePublished", "발행일 (YYYY-MM-DD)"], ["authorName", "작성자"]] },
};

function toPayload(type: JsonLdType, values: Record<string, string>) {
  const input: Record<string, unknown> = {};
  const evidence: Record<string, string> = {};
  for (const [key, raw] of Object.entries(values)) {
    const value = raw.trim();
    if (!value) continue;
    if (key === "priceEvidence") evidence.price = value;
    else if (key === "ratingEvidence") evidence.ratingValue = value;
    else if (key === "sameAs") input.sameAs = value.split(",").map((item) => item.trim()).filter(Boolean);
    else if (key === "items") input.items = value.split("\n").map((line) => line.split("|").map((part) => part.trim())).filter((parts) => parts.length >= 2 && parts[0] && parts[1]).map(([name, url]) => ({ name, url }));
    else input[key] = value;
  }
  if (Object.keys(evidence).length) input.evidence = evidence;
  return input;
}

export function StructuredDataClient() {
  const [type, setType] = useState<JsonLdType>("Organization");
  const [values, setValues] = useState<Record<string, string>>({});
  const [pageUrl, setPageUrl] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  async function generate() {
    setBusy(true); setError(""); setCopied(false);
    try {
      const response = await fetch("/api/structured-data", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ type, input: toPayload(type, values), ...(pageUrl.trim() ? { pageUrl: pageUrl.trim() } : {}) }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "생성하지 못했습니다.");
      setResult(body as Result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "생성하지 못했습니다."); } finally { setBusy(false); }
  }

  const json = result?.jsonLd ? JSON.stringify(result.jsonLd, null, 2) : "";
  return (
    <div>
      <PageHeader eyebrow="Structured data" title="구조화 데이터 생성기" description="입력한 값만으로 JSON-LD를 만듭니다(AI가 쓰지 않음). 가격·평점·재고는 근거 URL이 없으면 만들지 않고, 페이지 URL을 주면 본문에 실제로 보이는지와 이미 있는 같은 엔티티를 확인합니다." />
      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="space-y-4">
          <label className="block text-xs">유형
            <select className="mt-1.5" value={type} onChange={(event) => { setType(event.target.value as JsonLdType); setValues({}); setResult(null); }}>
              {(Object.keys(TYPES) as JsonLdType[]).map((key) => <option key={key} value={key}>{TYPES[key].label} ({key})</option>)}
            </select>
          </label>
          {TYPES[type].fields.map(([key, label, placeholder]) => (
            <label key={key} className="block text-xs">{label}
              {key === "items" || key === "description"
                ? <textarea className="mt-1.5 min-h-20" value={values[key] ?? ""} onChange={(event) => setValues({ ...values, [key]: event.target.value })} />
                : <input className="mt-1.5" placeholder={placeholder} value={values[key] ?? ""} onChange={(event) => setValues({ ...values, [key]: event.target.value })} />}
            </label>
          ))}
          <label className="block text-xs">검증할 실제 페이지 URL <span className="text-slate-600">(선택 · 본문 일치와 중복 검사)</span>
            <input className="mt-1.5" type="url" placeholder="https://" value={pageUrl} onChange={(event) => setPageUrl(event.target.value)} />
          </label>
          <Button type="button" className="w-full" disabled={busy} onClick={() => void generate()}>{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}생성·검증</Button>
          {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
        </Card>
        <Card>
          {!result ? <p className="text-sm text-slate-500">왼쪽을 입력하고 &quot;생성·검증&quot;을 누르세요.</p> : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={result.publishable ? "good" : "bad"}>{result.publishable ? "발행 가능" : "발행 전 수정 필요"}</Badge>
                {!result.pageChecked && <Badge tone="warn">페이지 미검증</Badge>}
              </div>
              {result.missing.length > 0 && <p className="text-sm text-amber-300">필수 값이 없습니다: {result.missing.join(", ")}</p>}
              {result.blocked.map((item) => <p key={item.field} className="text-sm text-amber-300">{item.field}: {item.reason}</p>)}
              {result.issues.map((item) => <p key={item.code} className="text-sm text-rose-300">{item.message}</p>)}
              {result.blocking.map((item) => <p key={item.code} className="text-sm text-rose-300">{item.message}</p>)}
              {result.duplicates.map((item, index) => <p key={index} className="text-sm text-amber-300">이미 페이지에 {item.type}{item.id ? ` (${item.id})` : ""}이(가) 있습니다. 새로 추가하지 말고 @id로 연결하세요.</p>)}
              {json && (
                <>
                  <pre className="max-h-96 overflow-auto rounded-xl bg-slate-950/60 p-3 text-xs leading-5 text-emerald-300">{json}</pre>
                  <Button type="button" variant="secondary" onClick={() => { void navigator.clipboard.writeText(`<script type="application/ld+json">\n${json}\n</script>`).then(() => setCopied(true)); }}>
                    {copied ? <Check className="h-4 w-4" /> : <Clipboard className="h-4 w-4" />}{copied ? "복사됨" : "script 태그로 복사"}
                  </Button>
                </>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
