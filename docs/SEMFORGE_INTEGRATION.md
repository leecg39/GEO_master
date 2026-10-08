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
| 수동 위치 등록 / Map Rank | — | ✓ |

Google OAuth 및 GSC·GBP 동기화는 아직 구현되지 않았다. GBP 위치는 수동 등록 데이터이며 항상 미연결로 표시한다. Google OAuth 환경 변수만으로 연결 완료를 판정하지 않는다.

로컬 테스트는 `SEMFORGE_BILLING_MODE=dev`를 명시한 환경에서 `/subscription`의 checkout intent와 확인 토큰으로 활성화한다. 실제 과금은 발생하지 않는다. 운영 결제는 아직 구현되지 않았으며, `live`·미설정·잘못된 모드에서는 checkout과 confirm이 `503 PAYMENT_PROVIDER_UNAVAILABLE`을 반환한다. 실결제 도입에는 제공자 승인 조회, 주문·금액 대조 및 검증된 webhook 처리가 필요하다.

## 이식 범위

**포함:** `src/lib/semforge/*`, SEMForge API/UI subset, `project_id` FK, ProviderResult provenance

**제외:** SEMForge 공개 마케팅 사이트, Semrush UI 인벤토리 전체, 39테이블 RBAC 전체(Phase 6 경량화)

현재 사이트 진단은 Firecrawl `/v1/map`의 URL 발견 목록에 기반한 휴리스틱이다. 개별 페이지의 실제 HTTP 상태·응답 시간·본문을 수집한 기술 진단은 아니며, 건강 점수도 발견 범위에 따른 추정값이다.

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
