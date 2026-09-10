import {
  EDITOR_LABELS,
  FIELD_LABELS,
  type ChangeSet,
  type PageSnapshot,
} from "@/lib/site-ops/types";

export function buildQshopDelivery(change: ChangeSet, snapshot: PageSnapshot) {
  const guide =
    change.editor === "qshop_blog"
      ? "큐샵 스튜디오의 대상 블로그 글을 열고 글별 SEO 항목을 확인하세요. 구조화 데이터는 글의 콘텐츠 유형/커스텀 JSON-LD 설정에서 검토합니다. 직접 추가는 기존 구조에 더해지므로 같은 @type/@id가 이미 있으면 추가하지 말고 기존 엔티티를 먼저 정리하세요."
      : change.editor === "qshop_site"
        ? "큐샵 관리자 설정 → SEO/GEO → 페이지별 SEO에서 대상 페이지의 제목·설명·메타 이미지를 검토하세요. 기존 사이트의 구조화 데이터 확인 메뉴는 직접 편집용이 아닙니다. 원본 상품/회사 정보를 수정하거나 지원되는 편집 경로를 확인하세요."
        : "사이트 관리 시스템에서 대상 URL의 SEO 항목을 수정하세요. JSON-LD는 해당 페이지에서만 적용하고 동일한 @id와 유형이 중복되지 않게 검토하세요.";
  const sections = change.items.map(
    (item) =>
      `## ${FIELD_LABELS[item.field]}\n\n현재 값:\n\n${item.before || "(없음)"}\n\n수정안:\n\n${item.after || "(비움)"}\n\n이유: ${item.reason}\n근거: ${item.evidence}`,
  );
  const document = [
    `# ${EDITOR_LABELS[change.editor]} 적용 도우미`,
    `대상 URL: ${snapshot.finalUrl ?? snapshot.url}\n변경안: ${change.id}\n승인자: ${change.approvedBy ?? "미승인"}\n승인 시각: ${change.approvedAt ?? "미승인"}\n원본 수집: ${snapshot.capturedAt}\n원본 해시: ${snapshot.contentHash}`,
    guide,
    "전달은 게시 완료가 아닙니다. 지원하지 않는 항목을 공통 header에 우회 삽입하지 마세요. 특히 Product는 해당 상품 페이지에만 적용합니다. 검색 noindex, AI 검색 수집, 학습 이용, 로그인 비공개는 각각 다른 정책입니다.",
    ...sections,
    "## 반영 확인\n\n큐샵에서 저장·게시한 뒤 GEO Master의 ‘공개 URL 재검증’을 실행하세요. 대상 필드가 일치하고 원본과 충돌하지 않을 때만 확인 완료로 표시됩니다. 충돌 시 최신 페이지를 다시 수집하여 새 변경안을 승인하세요.",
    "참고: https://help.qshop.ai/customer_support/guide/setting/manage/seo\nhttps://qshop.ai/insights/qshop-blog-jsonld-content-type-guide",
  ].join("\n\n");
  return {
    filename: `qshop-change-${change.id}.md`,
    document,
    method: "manual" as const,
    published: false,
  };
}
