# 구현 계획: GEO_master2 + FeatGEO 적용 업그레이드

확정일: 2026-10-08 (사용자 승인: "이대로 진행해")
참고 저장소: https://github.com/leecg39/GEO_master2 , https://github.com/EvoNexusX/2026LiuFeatGEO (arXiv 2604.19113)

## 결정 요약

- GEO_master2: 인프라(Supabase·BullMQ·모노레포)는 가져오지 않고 `packages/core`의 순수 TS 로직만 `src/lib/geo-core/`로 이식한다.
- FeatGEO: Python 코드는 이식하지 않고 개념(13 피처 공간, 인용 시뮬레이터, 노출도, NSGA-II)을 TS로 재구현한다.
- FeatGEO 원본 프롬프트의 "가상 통계·지어낸 출처·가짜 인용" 지시는 사용하지 않는다. 모든 후보는 사실 메모 기반 근거 검사(`checkDraftBlock`)를 필수로 통과해야 한다.
- GenRank는 유지하되 항상 분모·엔진별 값과 함께 표시한다.
- 순서: 정밀도(Phase 1) → 근거(Phase 2·3) → 최적화(Phase 4) → 검수·공개(Phase 5). Qshop 접목 계획보다 Phase 1·2를 먼저 한다.

## Phase 1: 측정 정밀도 (GEO_master2 core 이식)
1. `src/lib/geo-core/`: matching(normalize, dictionary, match, rank), refusal/classify, metrics(k/n, 분자·분모), quality/precision-recall
2. 설정에 브랜드 별칭·모호 표기·공식 도메인 필드 추가
3. `share.ts` `analyzeMentions` → `matchBrands` 교체 (기존 테스트 회귀 유지 + 한국어 조사 케이스)
4. `measure_results`에 slot_status, refused, matched_spans, metric_version 추가 (legacy 표기)
5. 대시보드·리포트에 질문별 k/n, 분모, 결측·거절 건수 표시

## Phase 2: 검색 기반 측정과 출처 분석
1. `llm.ts` 검색 모드: OpenAI Responses web_search, Gemini Google Search grounding, Anthropic web search
2. `measure_citations` 테이블 + 도메인 분류 규칙(자사·경쟁사·언론·커뮤니티 등)
3. 자사 인용 커버리지(미지원 N/A), 경쟁 인용 페이지 지표
4. 실행 조건(요청/반환 모델, 검색 발생 여부, 프롬프트 버전) 저장

## Phase 3: 사실 메모와 근거 기반 초안
1. `facts` 테이블 (속성·값·단위·출처 URL·확인일·유효기간·verified)
2. 주장 추출 → compareClaim (일치/충돌/근거부족/시점불명)
3. Studio 출력에 checkDraftBlock 적용, 근거 없는 문장은 `자료 요청`
4. 진단 카드 4종(존재·맥락·시의성·추천) ↔ GEO 퍼널 4단계 매핑

## Phase 4: 콘텐츠 최적화 랩 (FeatGEO 재구현)
1. feature-schema: 13 피처 한국어 가이드 + 사실 제약
2. feature-extractor: 페이지 피처 프로필
3. citation-sim: 실제 인용 경쟁 출처 + 내 페이지 → [n] 인용 응답, 단어·위치 가중 노출도
4. pareto: NSGA-II (노출도 vs 품질, 사실 검사는 제약)
5. 소형 GA (개체 6 × 세대 3), 비용 사전 추정·한도 연동
6. 결과는 "시뮬레이션 추정치"로 분리 표시, 실측과 합산 금지

## Phase 5 (선택): 검수함과 공개 리포트
1. 불확실 식별·충돌 주장 검수함, 정밀도/재현율 기준 충족 시 예외 모드
2. 분모 공개 만료형 공유 링크

## 리스크
- 높음: 배포 SQLite 데이터 마이그레이션 → 컬럼 추가만, 삭제 없음
- 높음: web_search·GA 비용 → 사전 추정 + 하드캡
- 중간: 시뮬레이터 대표성 → "추정" 명시, 실측 비교 기록
- 중간: 구독핀 프록시 도구 지원 미확인 → Phase 2 스파이크
- 낮음: 800줄 근접 파일 → 새 로직은 별도 파일
