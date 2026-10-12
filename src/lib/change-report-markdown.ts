/**
 * 수정 결과 보고서 Markdown (R04). 페이지에서 온 값은 모두 이스케이프하고 500자로 자른다.
 */
import type { ChangeReport, ChangeReportItem } from "./change-report";
import { CHANGE_STATUS_LABEL, mdCell, mdInline } from "./report-markdown";

const EMPTY_ORIGINAL = "빈 값 또는 기록 없음";
const RESULT_LABEL: Record<string, string> = { matched: "일치", pending: "아직 다름", http_error: "HTTP 오류", fetch_error: "요청 실패" };

const table = (header: readonly string[], rows: ReadonlyArray<readonly string[]>) => [
  `| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`, ...rows.map((row) => `| ${row.join(" | ")} |`),
].join("\n");

const status = (value: string) => CHANGE_STATUS_LABEL[value] ?? mdInline(value);
const ACTION_STATUS_KEY: Record<ChangeReport["actions"][number]["kind"], string> = { conflict: "conflict", failed: "failed", pending: "verification_pending", unchecked: "delivered" };

function itemRow(item: ChangeReportItem) {
  return [
    String(item.id), mdInline(item.field),
    `${item.originalValue ? mdCell(item.originalValue) : EMPTY_ORIGINAL} → ${mdCell(item.proposedValue)}`,
    item.wordpressValue === null ? "WordPress 확인 기록 없음" : mdCell(item.wordpressValue),
    item.publicValue === null ? "확인 기록 없음" : mdCell(item.publicValue),
    status(item.status),
    item.lastCheckedAt ?? "-",
    item.lastHttpStatus === null ? "-" : String(item.lastHttpStatus),
  ];
}

function scopeLine(report: ChangeReport) {
  return report.scope.url ? `URL ${mdInline(report.scope.url)}의 모든 수정안` : `선택한 수정안 ${report.scope.ids?.join(", ")}`;
}

function reauditSection(report: ChangeReport) {
  const lines = report.reaudits.map((entry) => {
    if (!entry.after) return `- ${mdInline(entry.url)}: 수정 이후 진단이 없어 점수 변화를 표시하지 않습니다. 다시 진단하면 비교할 수 있습니다.`;
    const before = entry.before ? `진단 #${entry.before.id} ${entry.before.score}점` : "수정 전 진단 없음";
    return `- ${mdInline(entry.url)}: ${before} → 진단 #${entry.after.id} ${entry.after.score}점 (${entry.after.createdAt})`;
  });
  return ["## 재진단 비교", "", lines.length ? lines.join("\n") : "- 비교할 URL이 없습니다."].join("\n");
}

function historySection(report: ChangeReport) {
  const blocks = report.items.map((item) => {
    const delivery = item.deliveredAt ? [`- ${item.deliveredAt} 전달 (${mdInline(item.deliveryMethod ?? "방식 미상")})`] : [];
    const checks = item.history.map((entry) => `- ${entry.checkedAt} ${entry.source === "public" ? "공개 페이지" : "WordPress"} 확인: ${RESULT_LABEL[entry.result] ?? entry.result}`
      + `${entry.httpStatus === null ? "" : ` · HTTP ${entry.httpStatus}`} · ${entry.durationMs}ms${entry.errorCode ? ` · ${mdInline(entry.errorCode)}` : ""}`
      + `${entry.finalUrl ? ` · ${mdInline(entry.finalUrl)}` : ""}`);
    const lines = [...delivery, ...checks];
    return [`### #${item.id} ${mdInline(item.field)}`, "", lines.length ? lines.join("\n") : "- 이력 없음"].join("\n");
  });
  return ["## 전달·확인 이력", "", blocks.length ? blocks.join("\n\n") : "이력이 없습니다."].join("\n");
}

export function changeReportToMarkdown(report: ChangeReport): string {
  const { kpi } = report;
  const mismatches = report.items.filter((item) => item.finalUrlMismatch);
  const sections = [
    `# 수정 결과 보고서\n\n- 범위: ${scopeLine(report)}\n- 보고서 생성 시각: ${report.generatedAt}`,
    ["## 요약", "", table(["전체", "반영 확인", "확인 대기", "충돌", "실패", "초안·승인·전달"],
      [[kpi.total, kpi.verified, kpi.pending, kpi.conflict, kpi.failed, kpi.draft + kpi.approved + kpi.delivered].map(String)])].join("\n"),
    ["## 수정안별 결과", "", "공개 페이지 값은 가장 최근 반영 확인에서 실제로 읽은 값입니다.", "",
      report.items.length ? table(["ID", "필드", "원래 값 → 제안 값", "WordPress 저장값", "공개 페이지 값", "상태", "마지막 확인", "HTTP"], report.items.map(itemRow)) : "수정안이 없습니다.",
      ...mismatches.map((item) => `\n> #${item.id}: 확인 주소가 수정안 주소와 다릅니다 (${mdInline(item.lastFinalUrl)}). 리디렉션 대상이 맞는지 확인하세요.`)].join("\n"),
    ["## 조치 필요", "", report.actions.length ? report.actions.map((action) => `- #${action.id} ${mdInline(action.field)} (${status(ACTION_STATUS_KEY[action.kind])}): ${action.message}`).join("\n") : "- 없음"].join("\n"),
    reauditSection(report),
    historySection(report),
    ["## 방법과 한계", "", "반영 여부는 공개 페이지를 다시 받아 대상 필드를 비교해 판정합니다. HTTP 200 응답만으로는 반영으로 보지 않습니다.",
      "점수 변화는 마지막 전달 이후 실제로 다시 진단한 기록이 있을 때만 표시합니다. 추정 향상치는 쓰지 않습니다."].join("\n"),
  ];
  return `${sections.join("\n\n")}\n`;
}
