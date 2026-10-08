/**
 * 큐샵 적용 도우미 (Qshop P08) — 수동 적용 안내 묶음 생성.
 * - 승인된 수정안만 담고, 페이지별로 묶는다
 * - 큐샵 서버 쓰기 API가 확인되지 않았으므로 자동 게시를 하지 않는다. 안내문에도 그렇게 적는다
 * - 큐샵 화면의 메뉴 이름은 공개 자료로 확인되지 않아 지어내지 않는다. 항목별로 "무엇을 넣을지"만 안내한다
 * - 적용 후에는 수정안 작업대의 "반영 확인"(공개 URL 재수집)으로 확인한다
 */
export type EditorKind = "site-settings" | "blog";

export interface GuideItem {
  id: number;
  url: string;
  field: string;
  originalValue: string;
  proposedValue: string;
  rationale: string;
  status: string;
}

interface Step { id: number; fieldLabel: string; current: string; proposed: string; rationale: string; caution: string }
interface PageGuide { url: string; steps: Step[] }

const FIELD_LABELS: Record<string, string> = {
  title: "페이지 제목", description: "페이지 설명", canonical: "대표(canonical) URL", og_image: "공유 이미지(OG)",
  robots_meta: "검색 노출 설정(robots 메타)", json_ld: "구조화 데이터(JSON-LD)", body: "본문",
};

function caution(field: string, editor: EditorKind) {
  switch (field) {
    case "json_ld":
      return editor === "blog"
        ? "블로그 글의 스키마 설정이 이미 있으면 같은 유형이 중복되지 않게 먼저 확인하세요. 본문에 보이는 내용과 일치해야 합니다."
        : "사이트 설정이 이미 같은 엔티티를 자동 생성하고 있을 수 있어 중복을 먼저 확인하세요. 전 페이지 공통 영역에 상품 정보를 넣지 마세요.";
    case "robots_meta":
      return "검색 노출 제한(noindex 등)은 비밀 자료를 보호하지 않습니다. 비공개가 필요한 자료는 로그인 등 접근 제한으로 보호하세요.";
    case "body":
      return "본문은 수정안 전체를 한 번에 붙여 넣기 전에 원문과 비교해 빠진 내용이 없는지 전체를 검토하세요.";
    case "canonical":
      return "대표 URL을 잘못 지정하면 다른 페이지가 검색에서 빠질 수 있습니다. 주소를 한 글자씩 확인하세요.";
    case "og_image":
      return "이미지는 공개 접근이 가능한 절대 URL이어야 합니다.";
    default:
      return "입력 후 글자 수 제한에 걸려 잘리지 않았는지 확인하세요.";
  }
}

/** 코드 펜스(```)가 값 안에 있어도 안내문이 깨지지 않게 무력화한다 */
function fenced(value: string) {
  return "```\n" + (value || "(비어 있음)").replaceAll("```", "'''") + "\n```";
}

export function buildApplyGuide(items: readonly GuideItem[], editor: EditorKind) {
  const approved = items.filter((item) => item.status === "approved");
  const skipped = items
    .filter((item) => item.status !== "approved")
    .map((item) => ({ id: item.id, reason: item.status === "draft" ? "승인되지 않은 수정안(초안)" : `적용 대상이 아닌 상태(${item.status})` }));
  const byUrl = new Map<string, Step[]>();
  for (const item of approved) {
    const steps = byUrl.get(item.url) ?? [];
    steps.push({ id: item.id, fieldLabel: FIELD_LABELS[item.field] ?? item.field, current: item.originalValue, proposed: item.proposedValue, rationale: item.rationale, caution: caution(item.field, editor) });
    byUrl.set(item.url, steps);
  }
  const pages: PageGuide[] = [...byUrl.entries()].map(([url, steps]) => ({ url, steps }));

  const lines = [
    "# 큐샵 적용 안내",
    "",
    `편집 대상: ${editor === "blog" ? "블로그 글" : "사이트(페이지) 설정"}`,
    "",
    "> GEO Master는 큐샵에 수정안을 **자동으로 게시하지 않습니다.** 아래 안내를 보고 직접 반영한 뒤, GEO Master에서 \"전달 처리\"와 \"반영 확인\"을 진행하세요.",
    "> 큐샵 화면의 메뉴 이름은 큐샵 화면에서 직접 확인해 주세요. 항목 이름만 안내합니다.",
    "",
  ];
  if (!pages.length) lines.push("승인된 수정안이 없습니다. 수정안 작업대에서 먼저 승인하세요.");
  for (const page of pages) {
    lines.push(`## ${page.url}`, "");
    page.steps.forEach((step, index) => {
      lines.push(`### ${index + 1}. ${step.fieldLabel}`, "", "현재 값:", fenced(step.current), "", "수정안:", fenced(step.proposed), "");
      if (step.rationale) lines.push(`근거: ${step.rationale.replace(/\s+/g, " ")}`, "");
      lines.push(`주의: ${step.caution}`, "");
    });
  }
  if (pages.length) lines.push("## 적용 후", "", "1. 큐샵에서 저장·게시합니다.", "2. 수정안 작업대에서 \"전달 처리\"를 누릅니다.", "3. \"반영 확인\"으로 공개 페이지를 다시 읽어 값이 일치하는지 확인합니다. 색인·검색 반영에는 시간이 걸릴 수 있습니다.", "");
  return { editor, pages, skipped, markdown: `${lines.join("\n").trim()}\n` };
}
