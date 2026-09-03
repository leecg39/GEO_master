# SEMForge → GEO Master 분석 메모

Source: https://github.com/leecg39/SEMForge.git (cloned 2026-09-03)

## 원본 SEMForge 구조

| 레이어 | 경로 | 성격 |
|---|---|---|
| 공개 사이트 | `/`, `/features/*`, `/pricing/*` | Semrush UI 관찰 기반 랜딩 |
| 로그인 앱 | `/home/`, `/seo/`, `/analytics/*`, `/siteaudit/`, `/position-tracking/`, `/ai-seo/*`, `/local-business/` | 실데이터 SEO 툴킷 |
| CRUD | `/app/*` + `/api/[resource]/` | DB·인증·낙관적 잠금 |

### 데이터 소스 (원본)
- TalorData SERP (`TALORDATA_API_TOKEN`)
- Firecrawl v2 (`FIRECRAWL_API_KEY`)
- PageSpeed Insights (`PAGESPEED_API_KEY`)
- Google Search Console / GBP OAuth

### 원본 원칙
- 모의 지표 금지 → `live` / `unavailable` provenance
- 소스 없는 지표(검색량·KD·Authority Score 등)는 미제공
- autoresearch: `semforge/autoresearch/` (analytics frozen score, isolated git checkpoints)

## GEO Master 매핑 (`src/lib/semforge/*`)

| SEMForge 기능 | GEO Master 경로 | 상태 |
|---|---|---|
| AI 가시성 | `/ai-seo` | 이식됨 (TalorData + briefing) |
| 사이트 진단 | `/site-audit` | 이식됨 (Firecrawl) |
| 포지션 추적 | `/position-tracking` | 이식됨 |
| 도메인 개요 | `/analytics/overview` | 이식됨 (요약) |
| 지역 SEO / Map Rank | `/local-business` | 이식됨 |
| 구독 게이트 | `/subscription` + `requireSemforgeSubscription` | 이식됨 |
| GSC / GBP / PSI / cron | — | 미이식 (원본에만 존재) |
| 공개 Semrush 클론 랜딩 | — | 범위 밖 (GEO는 워크스페이스 앱) |

## QA 게이트 (GEO Master, 2026-09-03)

- lint ✓ (AppShell setState-in-effect 제거, unused vars 정리)
- typecheck ✓
- vitest 190/190 ✓ (schema v9 expectation 갱신)
- `npm run autoresearch:dashboard` → **104/104 (100%)**

## 재귀 개선 방향

Frozen metric(`autoresearch/eval/dashboard-score.mjs`)은 불변.
점수가 이미 ceiling이므로 Inner Loop는:
1. equal-score 단순화/가독성 KEEP
2. Guard 유지 하에 Sentri 토큰·SEMForge 브리핑 UX 폴리시
3. Outer `program.md`에 SEMForge 패리티 힌트 추가 (GSC/PSI는 별도 실험 트랙)
