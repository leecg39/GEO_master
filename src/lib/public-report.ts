/**
 * 공개 리포트 HTML — 외부 JS·CSS 없이 인라인 스타일만 쓰는 정적 문서.
 * 모든 값(답변 원문 포함)은 이스케이프하며, 라우트에서 script를 금지하는 CSP와 함께 내보낸다.
 */
import { formatRatio, parseMeasurementEvidence } from "./measurement-evidence";
import type { PublicReport } from "./report-shares";

const CATEGORY_LABELS: Record<string, string> = {
  own: "자사", competitor: "경쟁사", media: "언론·블로그", community: "커뮤니티",
  marketplace: "마켓플레이스", public: "공공·백과", other: "기타", unknown: "미분류",
};
const VERDICT_LABELS: Record<string, string> = { pass: "통과", issue: "문제", insufficient: "자료 부족" };
const SLOT_LABELS: Record<string, string> = { succeeded: "정상 답변", refused: "명시 거절", failed: "수집 실패" };

export function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const STYLE = `
:root{--bg:#f7f7fb;--card:#fff;--ink:#1d1b26;--muted:#5d5a6b;--line:#e3e1ea;--good:#2f6b16;--bad:#a52b5a;--warn:#8a5a00;--accent:#4b3fa8}
@media (prefers-color-scheme:dark){:root{--bg:#120d1f;--card:#1b1530;--ink:#efecf7;--muted:#b3adc6;--line:#2e2747;--good:#c2ef4e;--bad:#fa7faa;--warn:#f5c35b;--accent:#a79cf0}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 system-ui,-apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif}
main{max-width:960px;margin:0 auto;padding:24px 16px 64px}h1{font-size:26px;margin:4px 0}h2{font-size:17px;margin:0 0 12px}
section{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px;margin-top:16px}
.muted{color:var(--muted);font-size:13px}.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(160px,1fr))}
.metric strong{display:block;font-size:26px}.badge{display:inline-block;border:1px solid var(--line);border-radius:6px;padding:1px 6px;font-size:12px}
.good{color:var(--good)}.bad{color:var(--bad)}.warn{color:var(--warn)}table{width:100%;border-collapse:collapse;font-size:13px}
th,td{border-bottom:1px solid var(--line);padding:6px 4px;text-align:left;vertical-align:top}td.k{text-align:center;font-weight:600}
details{border-top:1px solid var(--line);padding:8px 0}summary{cursor:pointer}pre{white-space:pre-wrap;word-break:break-word;font:inherit;font-size:13px;color:var(--muted);margin:8px 0 0}
.wrap{overflow-x:auto}`;

function page(title: string, body: string) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body><main>${body}</main></body></html>`;
}

function metrics(report: PublicReport) {
  const summary = report.run.summary as Record<string, unknown>;
  const total = typeof summary.total === "number" ? summary.total : null;
  const mentions = typeof summary.mentions === "number" ? summary.mentions : null;
  return `<section><div class="grid">
    <div class="metric"><span class="muted">응답 점유율</span><strong>${escapeHtml(report.run.answerShare)}%</strong><span class="muted">${total === null ? "" : `정상 답변 ${escapeHtml(total)}개 중 ${escapeHtml(mentions)}회 언급`}</span></div>
    <div class="metric"><span class="muted">GenRank</span><strong>${escapeHtml(report.run.genrank)}</strong><span class="muted">언급 순서·모델 가중</span></div>
    <div class="metric"><span class="muted">긍정 문맥</span><strong>${escapeHtml(summary.positiveRate ?? 0)}%</strong><span class="muted">언급된 답변 기준</span></div>
    <div class="metric"><span class="muted">퍼널 단계</span><strong>${escapeHtml(report.run.funnelStage)}</strong></div>
  </div></section>`;
}

function evidenceSection(report: PublicReport) {
  const evidence = parseMeasurementEvidence(report.run.summary as Record<string, unknown>);
  if (evidence.legacy || !evidence.quality) return "";
  const { quality } = evidence;
  const header = evidence.providers.map((provider) => `<th>${escapeHtml(provider)}</th>`).join("");
  const rows = evidence.questions.map((question) => `<tr><th scope="row">${escapeHtml(question)}</th>${evidence.providers.map((provider) => {
    const cell = evidence.questionMatrix.find((item) => item.question === question && item.provider === provider);
    if (!cell) return "<td class=\"k\">-</td>";
    const tone = cell.label === "N/A" ? "muted" : cell.mentioned === 0 ? "bad" : cell.mentioned === cell.valid ? "good" : "warn";
    const missing = cell.refused + cell.failed;
    return `<td class="k ${tone}">${escapeHtml(cell.label)}${missing ? `<br><span class="muted">결측 ${missing}</span>` : ""}</td>`;
  }).join("")}</tr>`).join("");
  return `<section><h2>분모 근거 <span class="badge">산식 ${escapeHtml(evidence.metricVersion)}</span></h2>
    <p class="muted">예정 ${quality.planned} · 정상 ${quality.succeeded} · 거절 ${quality.refused} · 실패 ${quality.failed} · 수집 완료율 ${escapeHtml(formatRatio(quality.completionRate))} · 거절률 ${escapeHtml(formatRatio(quality.refusalRate))}</p>
    <p class="muted">점유율 분모는 정상 답변만 사용하며, 거절·실패를 0으로 세지 않습니다. 표의 값은 "언급 횟수/정상 답변 수"입니다.</p>
    <div class="wrap"><table><thead><tr><th>질문</th>${header}</tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

function citationSection(report: PublicReport) {
  const citations = parseMeasurementEvidence(report.run.summary as Record<string, unknown>).citations;
  if (!citations) return "";
  const categories = Object.entries(citations.citedByCategory).map(([category, count]) => `${escapeHtml(CATEGORY_LABELS[category] ?? category)} ${count}회`).join(" · ") || "명시 인용 없음";
  const pages = citations.pagesCitedWithoutBrand.map((page) => `<li>${escapeHtml(page.url)} <span class="muted">${escapeHtml(CATEGORY_LABELS[page.category] ?? page.category)} · ${page.count}회</span></li>`).join("");
  return `<section><h2>인용 출처 (웹검색 측정)</h2>
    <p>자사 인용 커버리지 <strong>${escapeHtml(formatRatio(citations.ownCitationCoverage))}</strong> <span class="muted">(분모: 실제로 웹검색이 일어난 정상 답변)</span></p>
    <p class="muted">출처 유형별 인용 횟수: ${categories} (검색만 된 결과 ${citations.searchedCount}건, 답변 본문에 적힌 URL ${citations.inlineCount}건은 인용으로 세지 않음)</p>
    ${pages ? `<p class="muted">브랜드가 언급되지 않은 답변에서 인용된 페이지</p><ul>${pages}</ul>` : ""}</section>`;
}

function diagnosticsSection(report: PublicReport) {
  const diagnostics = report.run.diagnostics;
  if (!diagnostics) return "";
  const cards = diagnostics.cards.map((card) => {
    const tone = card.verdict === "pass" ? "good" : card.verdict === "issue" ? "bad" : "muted";
    return `<div><strong>${escapeHtml(card.card)}</strong> <span class="badge ${tone}">${escapeHtml(VERDICT_LABELS[card.verdict] ?? card.verdict)}</span><p class="muted">${escapeHtml(card.rationale)}</p></div>`;
  }).join("");
  return `<section><h2>진단 카드</h2><div class="grid">${cards}</div></section>`;
}

function resultsSection(report: PublicReport) {
  const items = report.run.results.map((item) => {
    const status = SLOT_LABELS[item.slotStatus ?? "succeeded"] ?? "정상 답변";
    const mention = item.brandMentioned ? `<span class="good">언급 · ${escapeHtml(item.mentionRank ?? "-")}번째</span>` : "<span class=\"muted\">미언급</span>";
    return `<details><summary>${escapeHtml(item.question)} <span class="badge">${escapeHtml(item.provider)}</span> <span class="badge">${escapeHtml(status)}</span> ${mention}</summary><pre>${escapeHtml(item.response)}</pre></details>`;
  }).join("");
  const omitted = Math.max(0, report.run.totalQueries - report.run.results.length);
  return `<section><h2>질문별 답변 원문</h2>${omitted ? `<p class="muted">공개 링크에는 앞쪽 ${report.run.results.length}개 답변만 포함됩니다 (전체 ${report.run.totalQueries}개).</p>` : ""}${items}</section>`;
}

export function renderPublicReportHtml(report: PublicReport, expiresAt: string) {
  const title = report.run.title || "GEO 진단 리포트";
  const body = `<p class="muted">GEO 진단 리포트 · 측정 ${escapeHtml(report.run.createdAt.slice(0, 10))} · 링크 만료 ${escapeHtml(expiresAt.slice(0, 10))}</p>
    <h1>${escapeHtml(title)}</h1>
    <p class="muted">AI 답변 API를 같은 조건으로 반복 측정한 결과입니다. 종합 점수 대신 엔진별·질문별 분모를 공개하며, 소비자용 앱 화면과는 다를 수 있습니다.</p>
    ${metrics(report)}${evidenceSection(report)}${citationSection(report)}${diagnosticsSection(report)}${resultsSection(report)}`;
  return page(`${title} · GEO 진단 리포트`, body);
}

export function renderUnavailableHtml() {
  return page("리포트를 볼 수 없습니다", "<section><h1>리포트를 볼 수 없습니다</h1><p class=\"muted\">링크가 만료되었거나 폐기되었습니다. 리포트를 보낸 담당자에게 새 링크를 요청해 주세요.</p></section>");
}
