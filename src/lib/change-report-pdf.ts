/**
 * 수정 결과 보고서 PDF (R10). 기존 report-pdf.ts의 레이아웃을 재사용하고, Markdown 보고서와 같은 사실만 담는다.
 */
import type { ChangeReport } from "./change-report";
import { COLORS, PdfLayout } from "./report-pdf";
import { CHANGE_STATUS_LABEL } from "./report-markdown";

const VALUE_MAX = 500;
const status = (value: string) => CHANGE_STATUS_LABEL[value] ?? value;

function itemBlock(document: PdfLayout, item: ChangeReport["items"][number]) {
  document.text(`#${item.id} · ${item.field} · ${status(item.status)}`, { size: 11, color: COLORS.ink, lineHeight: 16, maxChars: 300 });
  document.text(`원래 값: ${item.originalValue || "빈 값 또는 기록 없음"}`, { size: 8.5, color: COLORS.muted, indent: 10, maxChars: VALUE_MAX });
  document.text(`제안 값: ${item.proposedValue ?? ""}`, { size: 8.5, color: COLORS.ink, indent: 10, maxChars: VALUE_MAX });
  document.text(`WordPress 저장값: ${item.wordpressValue ?? "WordPress 확인 기록 없음"}`, { size: 8.5, color: COLORS.muted, indent: 10, maxChars: VALUE_MAX });
  document.text(`공개 페이지 값: ${item.publicValue ?? "확인 기록 없음"}`, { size: 8.5, color: COLORS.muted, indent: 10, maxChars: VALUE_MAX });
  document.text(`마지막 확인: ${item.lastCheckedAt ?? "-"}${item.lastHttpStatus === null ? "" : ` · HTTP ${item.lastHttpStatus}`}`, { size: 8, color: COLORS.muted, indent: 10 });
  if (item.finalUrlMismatch) document.text(`확인 주소가 수정안 주소와 다릅니다: ${item.lastFinalUrl ?? ""}`, { size: 8, color: COLORS.amber, indent: 10, maxChars: 400 });
  document.space(7);
}

export function changeReportToPdf(report: ChangeReport) {
  const document = new PdfLayout("수정 결과 보고서");
  document.text("수정 결과 보고서", { size: 24, color: COLORS.ink, lineHeight: 31 });
  document.text(report.scope.url ?? `선택한 수정안 ${report.scope.ids?.join(", ") ?? ""}`, { size: 9, color: COLORS.cyan, maxChars: 1_000 });
  document.text(`생성 ${report.generatedAt}`, { size: 8, color: COLORS.muted });
  document.space(12);
  const { kpi } = report;
  document.text(`전체 ${kpi.total} · 반영 확인 ${kpi.verified} · 확인 대기 ${kpi.pending} · 충돌 ${kpi.conflict} · 실패 ${kpi.failed}`, { size: 12, color: COLORS.ink, lineHeight: 18 });

  document.section(`조치 필요 (${report.actions.length})`);
  if (!report.actions.length) document.text("없음", { color: COLORS.muted });
  for (const action of report.actions) document.text(`#${action.id} ${action.field}: ${action.message}`, { size: 9, color: COLORS.amber, maxChars: 600 });

  document.section("재진단 비교");
  for (const entry of report.reaudits) {
    document.text(entry.after
      ? `${entry.url}: ${entry.before ? `진단 #${entry.before.id} ${entry.before.score}점` : "수정 전 진단 없음"} → 진단 #${entry.after.id} ${entry.after.score}점`
      : `${entry.url}: 수정 이후 진단이 없어 점수 변화를 표시하지 않습니다.`, { size: 9, color: COLORS.muted, maxChars: 600 });
  }

  document.section(`수정안별 결과 (${report.items.length})`);
  for (const item of report.items) {
    if (document.truncated) break;
    itemBlock(document, item);
  }

  document.section("방법과 한계");
  document.text("반영 여부는 공개 페이지를 다시 받아 대상 필드를 비교해 판정합니다. HTTP 200 응답만으로는 반영으로 보지 않습니다.", { size: 8.5, color: COLORS.muted });
  document.text("점수 변화는 마지막 전달 이후 실제로 다시 진단한 기록이 있을 때만 표시합니다. 추정 향상치는 쓰지 않습니다.", { size: 8.5, color: COLORS.muted });
  return document.build();
}
