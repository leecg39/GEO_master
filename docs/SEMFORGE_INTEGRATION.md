# SEMForge → GEO_master 통합

## 목표

GEO_master를 메인 셸로 SEMForge 기능(SERP AI 가시성, Firecrawl 사이트 진단, 포지션 추적, GSC/GBP, 지역 SEO)을 흡수한다.

## 유료 구독 게이트

GEO Master의 **분석·측정 UI**(대시보드, Cheerio GEO 진단, LLM 응답 점유율, llms.txt, 전략)는 로컬 퍼스트로 무료 사용 가능하다.

**SEMForge 기반 GEO 실행**(TalorData SERP/AIO, Firecrawl 크롤, GSC/GBP OAuth, 포지션·도메인·지역 SEO API)은 **월 300,000원 구독** 활성화 후에만 사용할 수 있다.

| 구분 | 무료 | SEMForge Pro (월 30만원) |
|------|------|-------------------------|
| LLM Answer Share | ✓ | ✓ |
| GEO 진단 (Cheerio) | ✓ | ✓ |
| llms.txt / 전략 / 리포트 | ✓ | ✓ |
| AI SEO (SERP AIO) | — | ✓ |
| Firecrawl 사이트 진단 | — | ✓ |
| 포지션 추적 / 도메인 개요 | — | ✓ |
| GBP / Map Rank | — | ✓ |

결제는 `/subscription`에서 checkout intent를 생성한다. 개발 환경(`SEMFORGE_BILLING_MODE=dev`)에서는 확인 API로 구독을 활성화할 수 있다. 운영 환경에서는 Toss Payments webhook(`SEMFORGE_TOSS_WEBHOOK_SECRET`)으로 결제를 확정한다.

## 이식 범위

**포함:** `src/lib/semforge/*`, SEMForge API/UI subset, `project_id` FK, ProviderResult provenance

**제외:** SEMForge 공개 마케팅 사이트, Semrush UI 인벤토리 전체, 39테이블 RBAC 전체(Phase 6 경량화)

## 환경 변수

`.env.example`의 SEMForge·결제 섹션 참고.

## 디렉터리

```
src/lib/semforge/
  providers/       ProviderResult, provenance
  talordata/       SERP/AIO
  ai-visibility/
  siteaudit/
  position-tracking/
  domain-analysis/
  gsc/ gbp/ maprank/
src/lib/semforge-subscription.ts
```
