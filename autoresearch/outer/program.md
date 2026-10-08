# GEO Master Dashboard — Autoresearch Directive

## Goal
SEMForge 원본 분석 기반 GEO Master QA + 대시보드 Frozen Metric 유지·재귀 개선.
**전체 언급율(좌)** · **AI 모델 언급율(우)** 2열 유지.
레이더(기존/현재 면) + 표(모델색) + 범례(차트 하단 통합).

## Frozen Metric
`node autoresearch/eval/dashboard-score.mjs` — 수정 금지 (eval/)

## Target (수정 가능)
- `src/components/DashboardView.tsx`
- `src/app/globals.css` (대시보드 관련 최소 스타일만)
- SEMForge 브리핑/클라이언트 UX (Guard 통과 시에만)

## Guard
- `npm run lint`
- `npm run typecheck`
- `npm test -- tests/annatar-mock.integration.test.ts`

## Constraints
- GEO 지표·데이터 소스(`src/lib/dashboard.ts`) 변경 금지
- KPI 카드·질문 드릴다운 동작 유지
- Frozen eval 디렉터리 수정 금지
- 한 실험 = 하나의 가설

## Hints (우선순위)
1. 레이더·표 `items-stretch`로 세로 정렬; 범례는 레이더 컬럼 하단에만
2. 좌 Area / 우 Radar 높이 대칭 (≈400px, 패널 min-h 560)
3. 모델색은 축 tick · 표 ProviderDot · 현재% 에 유지 (시리즈 stroke는 기존/현재 구분)
4. SplitPanelHeader 1줄 유지 (`전체 언급율` / `AI 모델 언급율` 표기 유지)
5. 콘솔 에러 0 · score 104/104 유지
6. SEMForge 미이식(GSC/GBP/PSI/cron)은 별도 트랙 — 대시보드 metric에 섞지 말 것

## Ceiling policy
점수가 이미 104/104이면 equal-score 단순화·가독성·a11y만 KEEP.
