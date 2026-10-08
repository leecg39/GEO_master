/** 관측 지표 라벨(서버·클라이언트 공용, DB 의존 없음) */
export const PURPOSE_LABELS = { search: "검색 색인", user: "사용자 요청 방문", training: "모델 학습" } as const;
export const OUTCOME_KIND_LABELS = { cta_click: "CTA 클릭", form_submit: "폼 제출", conversion: "전환(구매·가입 등)" } as const;
export type BotPurposeKey = keyof typeof PURPOSE_LABELS;
export type OutcomeKindKey = keyof typeof OUTCOME_KIND_LABELS;
