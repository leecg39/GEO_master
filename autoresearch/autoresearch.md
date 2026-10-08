# Autoresearch Session — SEMForge Analysis + Dashboard RSI

## Target
`src/components/DashboardView.tsx` + SEMForge GEO 통합 QA

## Goal
https://github.com/leecg39/SEMForge.git 분석 → GEO Master QA → Frozen Metric 재귀 개선 (2026-09-03)

## Analysis
- 원본: `docs/semforge-analysis.md`
- 이식됨: AI SEO / Site Audit / Position Tracking / Analytics Overview / Local Business / Subscription
- 미이식: GSC, GBP, PageSpeed, cron scheduler, Semrush 공개 랜딩 클론

## Baseline → Current QA
| Gate | Result |
|------|--------|
| lint | ✓ (AppShell effect 제거, unused vars 정리) |
| typecheck | ✓ |
| vitest | ✓ 190/190 (schema v9) |
| SEMForge API smoke | ✓ 200 on dashboard/subscription/ai-seo/position/site-audit/local/analytics |
| autoresearch score | **104/104 (100%)** |

## Experiments (KEEP)

| # | Hypothesis | Evidence | Decision |
|---|-----------|----------|----------|
| 1 | QA 회귀(lint/migration/layout metric) 복구 | guards ✓ · layout +29 · score 104 | KEEP |
| 2 | 레이더 축 tick·표 현재% 모델색 복원 (equal-score) | score 104 · program hint #3 | KEEP |

## Run
```bash
npm run lint && npm run typecheck && npm test
npm run autoresearch:dashboard
```
