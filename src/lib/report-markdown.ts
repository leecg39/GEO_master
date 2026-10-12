/**
 * GEO 진단 Markdown 보고서 (rankseo-gap-reports-plan R01).
 * RankSEO 5.2.27은 md-report-generator.js가 배포본에 없어 이 보고서가 나오지 않았다. 여기서는:
 * - 입력은 허용된 필드만 담은 타입(AuditMarkdownInput)이다. 설정·API 키·연결 정보는 타입에 없어 보고서에 들어올 수 없다
 * - 페이지에서 온 문자열은 모두 신뢰하지 않는 입력으로 보고 Markdown·HTML 문법을 이스케이프한다
 * - generatedAt 외에는 같은 입력이면 같은 출력이다
 * - 규칙 기반 진단이며 AI 인용 측정이 아님을 본문에 밝힌다
 */
import { auditGradeScale } from "./audit-grade";
import { ruleDocFor } from "./rule-docs";

export const MD_CELL_MAX = 500;
/** audit.ts scoreAudit가 사람도 엔진도 판정하지 않은 수동 항목에 남기는 문구 */
export const MANUAL_UNCHECKED_DETAIL = "수동 확인 필요";

const isUnchecked = (item: AuditMarkdownItem) => item.manual && !item.passed && item.detail === MANUAL_UNCHECKED_DETAIL;
const isFailed = (item: AuditMarkdownItem) => !item.passed && !isUnchecked(item);

export interface AuditMarkdownItem {
  code: string; category: string; label: string; passed: boolean; manual: boolean; detail: string; recommendation: string;
}

export interface AuditMarkdownFinding {
  code: string; tier: "technical" | "recommendation" | "hypothesis"; severity: "error" | "warning" | "notice";
  passed: boolean; label: string; detail: string; evidence: string | null;
}

export interface AuditMarkdownInput {
  generatedAt: string;
  audit: {
    id: number; url: string; finalUrl: string | null; score: number; total: number; grade: string; createdAt: string;
    categories: ReadonlyArray<{ category: string; passed: number; total: number }>;
    items: readonly AuditMarkdownItem[];
  };
  snapshot: {
    capturedAt: string; renderMode: string; parserVersion: string; rulesVersion: string; skipped: string | null;
    findings: readonly AuditMarkdownFinding[];
  } | null;
  changes: ReadonlyArray<{ id: number; field: string; status: string; proposedValue: string; updatedAt: string }>;
}

/** 한 줄 텍스트: 줄바꿈을 공백으로 바꾸고 Markdown·HTML 문법 문자를 이스케이프한다 */
export function mdInline(value: string | null | undefined) {
  return (value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\\/g, "\\\\")
    .replace(/([`|*_[\]#])/g, "\\$1")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** 표 셀: 이스케이프 + 최대 500자 */
export function mdCell(value: string | null | undefined) {
  const text = mdInline(value);
  return text.length > MD_CELL_MAX ? `${text.slice(0, MD_CELL_MAX - 1)}…` : text;
}

const table = (header: readonly string[], rows: ReadonlyArray<readonly string[]>) => [
  `| ${header.join(" | ")} |`,
  `| ${header.map(() => "---").join(" | ")} |`,
  ...rows.map((row) => `| ${row.join(" | ")} |`),
].join("\n");

const docCell = (code: string) => {
  const doc = ruleDocFor(code);
  return doc ? `<${doc.url}>` : "";
};

const TIER_LABEL = { technical: "기술 오류", recommendation: "페이지 권고", hypothesis: "GEO 가설" } as const;
const SEVERITY_LABEL = { error: "오류", warning: "경고", notice: "참고" } as const;
export const CHANGE_STATUS_LABEL: Readonly<Record<string, string>> = {
  draft: "초안", approved: "승인", delivered: "전달됨", verification_pending: "반영 확인 대기",
  verified: "반영 확인", conflict: "충돌(원본 변경)", failed: "실패",
};

function header(input: AuditMarkdownInput) {
  const { audit, snapshot } = input;
  return [
    `# GEO 진단 보고서 — ${mdInline(audit.url)}`,
    "",
    `- 진단 ID: ${audit.id}`,
    `- 진단 URL: ${mdInline(audit.url)}`,
    `- 최종 URL: ${audit.finalUrl ? mdInline(audit.finalUrl) : "기록 없음"}`,
    `- 진단 시각: ${audit.createdAt}`,
    `- 보고서 생성 시각: ${input.generatedAt}`,
    `- 페이지 규칙 버전: ${snapshot ? `${snapshot.rulesVersion} (파서 ${snapshot.parserVersion})` : "스냅샷 없음"}`,
  ].join("\n");
}

function summary(input: AuditMarkdownInput) {
  const { audit } = input;
  return [
    "## 요약",
    "",
    `**${audit.score} / ${audit.total} 통과 · ${mdInline(audit.grade)}** (${auditGradeScale(audit.total)})`,
    "",
    audit.categories.length
      ? table(["분류", "통과", "전체"], audit.categories.map((entry) => [mdCell(entry.category), String(entry.passed), String(entry.total)]))
      : "평가 항목이 없습니다.",
  ].join("\n");
}

function failedItems(input: AuditMarkdownInput) {
  const failed = input.audit.items.filter(isFailed);
  return [
    "## 미충족 진단 항목",
    "",
    failed.length
      ? table(["분류", "코드", "항목", "관측값", "권고", "근거 문서"],
        failed.map((item) => [mdCell(item.category), `\`${mdInline(item.code)}\``, mdCell(item.manual ? `${item.label} (GEO 엔진 판정)` : item.label), mdCell(item.detail), mdCell(item.recommendation), docCell(item.code)]))
      : "미충족 항목이 없습니다.",
  ].join("\n");
}

function pageFindings(input: AuditMarkdownInput) {
  const { snapshot } = input;
  if (!snapshot) return "## 페이지 규칙 검사\n\n이 URL의 페이지 스냅샷이 없습니다.";
  const order = ["technical", "recommendation", "hypothesis"] as const;
  const failed = order.flatMap((tier) => snapshot.findings.filter((finding) => finding.tier === tier && !finding.passed));
  return [
    "## 페이지 규칙 검사",
    "",
    `스냅샷 ${snapshot.capturedAt} · 수집 방식 ${mdInline(snapshot.renderMode)} · 규칙 ${snapshot.rulesVersion}. GEO 가설은 페이지 유형에 따라 필요 없을 수 있어 오류로 세지 않습니다.`,
    "",
    failed.length
      ? table(["등급", "심각도", "코드", "항목", "관측값", "근거 문서"],
        failed.map((finding) => [TIER_LABEL[finding.tier], SEVERITY_LABEL[finding.severity], `\`${mdInline(finding.code)}\``, mdCell(finding.label),
          mdCell([finding.detail, finding.evidence ? `(관측값: ${finding.evidence})` : ""].filter(Boolean).join(" ")), docCell(finding.code)]))
      : "미충족 규칙이 없습니다.",
  ].join("\n");
}

function passedItems(input: AuditMarkdownInput) {
  const passed = input.audit.items.filter((item) => item.passed);
  return [
    "## 통과 항목",
    "",
    passed.length ? table(["코드", "항목", "관측값"], passed.map((item) => [`\`${mdInline(item.code)}\``, mdCell(item.label), mdCell(item.detail)])) : "통과한 항목이 없습니다.",
  ].join("\n");
}

function changes(input: AuditMarkdownInput) {
  return [
    "## 연결된 수정안",
    "",
    input.changes.length
      ? table(["ID", "필드", "상태", "제안 값", "마지막 변경"],
        input.changes.map((change) => [String(change.id), mdInline(change.field), CHANGE_STATUS_LABEL[change.status] ?? mdInline(change.status), mdCell(change.proposedValue), change.updatedAt]))
      : "이 URL의 수정안이 없습니다.",
  ].join("\n");
}

function notMeasured(input: AuditMarkdownInput) {
  const manual = input.audit.items.filter(isUnchecked);
  const lines = [
    ...manual.map((item) => `- ${mdInline(item.label)}: ${mdInline(item.detail)} (사람이 확인하는 항목)`),
    input.snapshot === null ? "- 이 URL의 페이지 스냅샷이 없어 원본 HTML 규칙(구조화 데이터 필수 속성, hreflang 등)을 판정하지 않았습니다." : "",
    input.snapshot?.skipped ? `- ${mdInline(input.snapshot.skipped)}` : "",
    "- 실제 검색 순위, AI 답변에서의 인용 여부, 페이지 속도는 이 진단에서 측정하지 않았습니다.",
  ].filter(Boolean);
  return ["## 측정하지 않은 것", "", ...lines].join("\n");
}

function aiRequest(input: AuditMarkdownInput) {
  const failed = input.audit.items.filter(isFailed);
  const findings = (input.snapshot?.findings ?? []).filter((finding) => !finding.passed && finding.tier !== "hypothesis");
  const tasks = [
    ...failed.map((item) => `- [ ] ${mdInline(item.label)} — ${mdInline(item.recommendation)}`),
    ...findings.map((finding) => `- [ ] ${mdInline(finding.label)} — ${mdCell(finding.detail)}`),
  ];
  return [
    "## AI에게 넘기는 작업 요청",
    "",
    "아래 미충족 항목만 고쳐 주세요. 페이지에 없는 사실·수치·출처·후기를 새로 만들지 말고, 근거가 없는 내용은 '자료 요청'으로 남기세요.",
    "",
    tasks.length ? tasks.join("\n") : "- 고칠 항목이 없습니다.",
  ].join("\n");
}

const METHOD = [
  "## 방법과 한계",
  "",
  "이 보고서는 공개 페이지의 HTML을 정해진 규칙으로 검사한 결과입니다. 검색 순위나 AI 인용을 측정한 것이 아닙니다.",
  "점수는 통과한 항목 수이며, 수정 후 점수 변화는 다시 진단했을 때만 확인할 수 있습니다.",
  "GEO 가설 항목은 공식 기준이 아니라 AI 답변 엔진이 인용하기 쉬운 형식에 대한 가설입니다.",
].join("\n");

export function auditReportToMarkdown(input: AuditMarkdownInput): string {
  return `${[header(input), summary(input), failedItems(input), pageFindings(input), passedItems(input), changes(input), notMeasured(input), aiRequest(input), METHOD].join("\n\n")}\n`;
}
