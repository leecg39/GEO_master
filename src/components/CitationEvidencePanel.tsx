import { Badge, Card } from "@/components/ui";
import { formatRatio } from "@/lib/measurement-evidence";
import type { CitationSummary } from "@/lib/geo-core";

const categoryLabels: Record<string, string> = {
  own: "자사", competitor: "경쟁사", media: "언론·블로그", community: "커뮤니티",
  marketplace: "마켓플레이스", public: "공공·백과", other: "기타", unknown: "미분류",
};
const providerLabels: Record<string, string> = { openai: "GPT", anthropic: "Claude", gemini: "Gemini", grok: "Grok" };

function safeHref(url: string) {
  return /^https?:\/\//i.test(url) ? url : undefined;
}

export function CitationEvidencePanel({ summary, className }: { summary: CitationSummary; className?: string }) {
  const categories = Object.entries(summary.citedByCategory).sort((a, b) => b[1] - a[1]);
  return (
    <Card className={className}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-white">인용 출처 분석</h2>
        <Badge tone="cyan">웹검색 측정</Badge>
      </div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-slate-500">자사 인용 커버리지</dt>
          <dd className="text-xl font-semibold text-white">{formatRatio(summary.ownCitationCoverage)}</dd>
          <p className="text-xs text-slate-600">자사 URL이 명시 인용된 정상 답변 ÷ 실제로 웹검색이 일어난 정상 답변 (검색 미지원·미발생은 N/A)</p>
        </div>
        <div>
          <dt className="text-xs text-slate-500">모델별</dt>
          <dd className="mt-1 space-y-1">
            {Object.entries(summary.perProvider).map(([provider, value]) => (
              <p key={provider} className="flex justify-between text-xs"><span className="text-slate-400">{providerLabels[provider] ?? provider}</span><span className="text-slate-200">{formatRatio(value)}</span></p>
            ))}
          </dd>
        </div>
      </dl>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div>
          <h3 className="text-sm font-medium text-slate-200">출처 유형별 인용 횟수</h3>
          <p className="text-xs text-slate-600">공급자가 돌려준 인용만 셉니다 · 검색만 된 결과 {summary.searchedCount}건, 답변 본문에 적힌 URL {summary.inlineCount}건은 제외</p>
          {categories.length ? (
            <ul className="mt-2 space-y-1 text-xs">{categories.map(([category, count]) => <li key={category} className="flex justify-between"><span className="text-slate-400">{categoryLabels[category] ?? category}</span><span className="text-slate-200">{count}회</span></li>)}</ul>
          ) : <p className="mt-2 text-xs text-slate-500">명시 인용이 없습니다.</p>}
          {summary.topDomains.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs">{summary.topDomains.map((item) => <li key={item.domain} className="flex justify-between gap-2"><span className="truncate text-slate-300">{item.domain}</span><span className="shrink-0 text-slate-500">{categoryLabels[item.category] ?? item.category} · {item.count}회</span></li>)}</ul>
          )}
        </div>
        <div>
          <h3 className="text-sm font-medium text-slate-200">우리 대신 인용된 페이지</h3>
          <p className="text-xs text-slate-600">브랜드가 언급되지 않은 답변에서 인용된 외부 페이지</p>
          {summary.pagesCitedWithoutBrand.length ? (
            <ul className="mt-2 space-y-1.5 text-xs">{summary.pagesCitedWithoutBrand.map((page) => (
              <li key={page.url} className="flex justify-between gap-2">
                <a className="truncate text-cyan-300 hover:underline" href={safeHref(page.url)} target="_blank" rel="noopener noreferrer nofollow">{page.url}</a>
                <span className="shrink-0 text-slate-500">{categoryLabels[page.category] ?? page.category} · {page.count}회</span>
              </li>
            ))}</ul>
          ) : <p className="mt-2 text-xs text-slate-500">해당 페이지가 없습니다.</p>}
        </div>
      </div>
    </Card>
  );
}
