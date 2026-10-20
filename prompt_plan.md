# 구현 계획: RankSEO 역공학 결과 반영 (트랙 A) + 보고서·WordPress (트랙 B)

확정일: 2026-10-13 (사용자 승인: "yes")
근거: `~/Desktop/profound_REA/output/rankseo-rea-2026-10-12/` — REA_REPORT.md, reports/scoring-analysis.md, reports/network-analysis.md, source/(source.zip과 같은 74개 파일, 실행하지 않고 읽기만 함)
트랙 B 상세: `docs/planning/rankseo-gap-reports-plan.md` (R00~R10, 변경 없음)

## 결정 요약

- RankSEO에서는 새 기능 6개(G1~G7 중 A1~A7)와 소규모 점검 2개(L1, L3)만 가져온다. 코드는 복사하지 않고 개념만 참고한다.
- 가져오지 않는다: Citation Tracker의 추정 엔진, AI Answer Simulation, 자동화 가산 점수(+8/+10), LLM Schema 생성기, Google `site:` 색인 확인, DA/DR·트래픽 지표, SERP overlay, 키워드 밀도, Firecrawl→Monid 자동 대체 경로.
- 승인 시 따로 지정이 없어 기본값을 적용한다:
  - 순서: 추천 순서 (A1~A3 → R01~R05 → A4~A6 → R06~R10 → A7·A8)
  - A7(PageSpeed, DB 변경)은 범위에 넣되 마지막(P2)에 둔다
  - A4 비교 페이지 수 상한은 기존 `RENDER_PAGE_LIMIT`과 같게 한다
- HARD-GATE 대상(3개 이상 파일, DB 변경)이다. 브랜치는 `feat/geo-master-app`에서 새로 만든다.

## 비교 결과 요약

### GEO_master가 이미 앞선 부분 (가져오지 않음)
- AI 인용 측정: RankSEO의 `live`는 검색 도구 없이 API를 부르고 응답에 도메인 문자열이 있는지만 본다. GEO_master는 검색 기반 응답에서 인용 URL을 파싱한다 (`llm.ts` `generateGroundedText`, `grounding.ts`).
- 한국어: RankSEO는 영어 정규식만 쓰고 n-gram 추출에서 한글을 지운다. GEO_master는 질문형 제목과 수치 단위를 한국어로 판별한다 (`audit.ts`).
- Schema 생성: RankSEO는 LLM과 내장 키를 쓰고 연도를 고정한다. GEO_master는 결정적으로 생성하고 가격·평점에 근거 URL을 요구한다 (`structured-data.ts`).
- 개선 수치: RankSEO는 고정값을 더한다. GEO_master는 재진단과 반영 확인 상태 흐름을 쓴다 (`change-items.ts`).
- 비밀값: RankSEO 배포 코드에는 기본 키 4종이 있다. GEO_master `src`에서는 키 패턴 검색 결과가 0건이다.

### 빈칸 (가져올 후보)
| ID | 빈칸 | RankSEO 근거 | GEO_master 현재 상태 |
|---|---|---|---|
| G1 | JSON-LD 타입별 필수·권장 필드 검사 | content.js:3514 | 구문 오류와 `@type` 존재 여부만 봄 |
| G2 | JS 의존 콘텐츠 감지 | content.js:4485 (DOM 추정) | native·rendered 수집은 되지만 비교하지 않음 |
| G3 | 답변 구조 지표 | content.js:3832–3882 | 첫 문단 40~400자 검사만 있음 |
| G4 | 사이트맵으로 llms.txt 초안 채우기 | popup.js:18914 | 직접 입력만 받음 |
| G5 | 규칙별 공식 문서 링크 | libs/audit-rules.js | 링크 없음 |
| G6 | 기본 기술 SEO 규칙 | content.js:116–154, 5842– | hreflang·viewport 규칙 없음 |
| G7 | PageSpeed·CWV | background.js:1540 | 없음 |

### 내 코드 점검
- L1: 등급 기준이 화면마다 다르다 (`auditGrade` 25/20 통과 개수, 사이트 감사 90/75/60, AI 가시성 80/60/40). 점수 종류가 달라 틀린 것은 아니지만 척도가 표시되지 않는다. → A1에서 척도를 표시한다.
- L2: LLM 제공자 선택 로직이 `audit.ts:276`과 `studio.ts:85`에 중복돼 있다. 엔드포인트는 `llm.ts`가 결정하므로 위험은 낮다. → 알리기만 하고 고치지 않는다 (별도 요청 시 진행).
- L3: RankSEO는 GEO 만점이 실제로 98점이다. → A8에서 만점 도달 테스트를 추가한다.

## 트랙 A: 작업 티켓

| ID | 우선 | 작업 | 주요 파일 | 완료 기준 (테스트로 증명) |
|---|---|---|---|---|
| A0 | P0 | 기준선 기록 (R00과 같은 작업) | — | test, typecheck, lint, build 결과 기록 |
| A1 | P0 | 규칙별 공식 문서 링크(G5)와 등급 척도 표시(L1) | `audit.ts`, `page-snapshots.ts`, 진단 화면 | 직접 확인 항목이 아닌 모든 규칙에 허용 도메인의 https 링크가 있음. 링크는 새 탭에서 `rel="noopener"`로 열림 |
| A2 | P0 | 기술 SEO 규칙 보강(G6): title·description 길이, viewport, hreflang(자기 참조·상호 참조), HTTPS, H1과 title 중복 | `page-snapshots.ts` (`page-rules/2`, `page-facts/2`) | 규칙마다 통과·실패 fixture가 있음. 모두 권고 등급이라 점수 변화 없음. 기존 스냅샷 테스트 회귀 없음 |
| A3 | P0 | Schema 필드 검사(G1) | 새 파일 `src/lib/schema-fields.ts` | 타입별 표에 Google 문서 URL과 확인일이 있음. `@graph`·중첩 구조 처리. FAQ·HowTo 리치 결과 제한 안내. 알 수 없는 타입은 "판정 안 함"으로 표시 |
| A4 | P1 | JS 의존 콘텐츠 감지(G2): 같은 URL의 native·rendered 비교 | `siteaudit/discovery.ts`, `page-snapshots.ts` | native에 title·H1·본문이 없거나 단어 수 비율이 기준 미만이면 기술 오류. 비교 페이지 수 상한 = `RENDER_PAGE_LIMIT`. 한쪽 결과가 없으면 판정하지 않음 |
| A5 | P1 | 답변 구조 지표(G3): 첫 문단의 글자 수·문장 수, H2 구간 길이 분포 | `audit.ts`(파서), `page-snapshots.ts` | 한국어 글자 수 기준. 가설 등급이라 점수 미반영. 기준값은 상수 한 곳에 모음 |
| A6 | P1 | llms.txt 초안 채우기(G4) | 새 API `POST /api/llms-documents/suggest`, llms 화면 | `fetchPublicText`로 SSRF 차단. URL 최대 60개, 경로 첫 부분으로 섹션 분류. LLM 사용 안 함. 저장하지 않고 편집기에만 채움 |
| A7 | P2 | PageSpeed·CWV(G7), 사용자 키로만 동작 | `settings.ts`, 마이그레이션 31, 새 API | 키 암호화 저장, 키가 없으면 기능 꺼짐. 실험실 측정값과 실사용자 측정값을 나눠 표시 |
| A8 | P2 | 만점 도달 테스트(L3) | 테스트만 추가 | 모든 신호를 갖춘 fixture가 각 점수에서 만점을 받음 |

## 트랙 B: 보고서·WordPress

`docs/planning/rankseo-gap-reports-plan.md`의 R01~R10을 그대로 쓴다. 진단 Markdown 보고서, 수정 결과 보고서, 확인 이력 저장(마이그레이션 28~30), WordPress 연결·쓰기가 포함된다.

## 실행 순서
1. A0 → A1 → A2 → A3
2. R01~R05 (보고서 두 개)
3. A4 → A5 → A6
4. R06~R10 (WordPress)
5. A7 → A8

## 리스크
| 위험 | 등급 | 대응 |
|---|---|---|
| RankSEO의 Schema 필수 필드 표 일부가 Google 공식 기준과 다를 수 있음 (Article 등은 미확인) | 높음 | 구현할 때 Google 문서를 다시 받아 표를 새로 만들고, 출처와 확인일을 남긴다 |
| 규칙 버전을 올리면 대시보드 추이가 갑자기 뛸 수 있음 | 중간 | 규칙 버전이 다르면 새 스냅샷 행이 생김. 화면에 "규칙 버전 변경" 표시 |
| A4는 같은 페이지를 두 번 받아 Firecrawl 크레딧이 늘어남 | 중간 | 페이지 수 상한을 두고, 수집 전에 예상 비용 표시 |
| 한국어 답변 구조 기준값의 근거 데이터가 없음 | 중간 | 가설 등급으로만 쓰고 점수에 넣지 않음 |
| 배포 SQLite 마이그레이션 (28~31) | 높음 | 컬럼·테이블 추가만 하고 삭제하지 않음 |

## 검증
- 티켓마다 TDD(RED → GREEN → IMPROVE)로 진행하고, 신규 모듈 커버리지 80% 이상을 목표로 한다.
- 마무리 시 `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`를 실제로 실행한 결과를 함께 보고한다.

---

## 이전 계획

### 구현 계획: GEO_master2 + FeatGEO 적용 업그레이드

확정일: 2026-10-08 (사용자 승인: "이대로 진행해")
참고 저장소: https://github.com/leecg39/GEO_master2 , https://github.com/EvoNexusX/2026LiuFeatGEO (arXiv 2604.19113)

#### 결정 요약

- GEO_master2: 인프라(Supabase·BullMQ·모노레포)는 가져오지 않고 `packages/core`의 순수 TS 로직만 `src/lib/geo-core/`로 이식한다.
- FeatGEO: Python 코드는 이식하지 않고 개념(13 피처 공간, 인용 시뮬레이터, 노출도, NSGA-II)을 TS로 재구현한다.
- FeatGEO 원본 프롬프트의 "가상 통계·지어낸 출처·가짜 인용" 지시는 사용하지 않는다. 모든 후보는 사실 메모 기반 근거 검사(`checkDraftBlock`)를 필수로 통과해야 한다.
- GenRank는 유지하되 항상 분모·엔진별 값과 함께 표시한다.
- 순서: 정밀도(Phase 1) → 근거(Phase 2·3) → 최적화(Phase 4) → 검수·공개(Phase 5). Qshop 접목 계획보다 Phase 1·2를 먼저 한다.

#### Phase 1: 측정 정밀도 (GEO_master2 core 이식)
1. `src/lib/geo-core/`: matching(normalize, dictionary, match, rank), refusal/classify, metrics(k/n, 분자·분모), quality/precision-recall
2. 설정에 브랜드 별칭·모호 표기·공식 도메인 필드 추가
3. `share.ts` `analyzeMentions` → `matchBrands` 교체 (기존 테스트 회귀 유지 + 한국어 조사 케이스)
4. `measure_results`에 slot_status, refused, matched_spans, metric_version 추가 (legacy 표기)
5. 대시보드·리포트에 질문별 k/n, 분모, 결측·거절 건수 표시

#### Phase 2: 검색 기반 측정과 출처 분석
1. `llm.ts` 검색 모드: OpenAI Responses web_search, Gemini Google Search grounding, Anthropic web search
2. `measure_citations` 테이블 + 도메인 분류 규칙(자사·경쟁사·언론·커뮤니티 등)
3. 자사 인용 커버리지(미지원 N/A), 경쟁 인용 페이지 지표
4. 실행 조건(요청/반환 모델, 검색 발생 여부, 프롬프트 버전) 저장

#### Phase 3: 사실 메모와 근거 기반 초안
1. `facts` 테이블 (속성·값·단위·출처 URL·확인일·유효기간·verified)
2. 주장 추출 → compareClaim (일치/충돌/근거부족/시점불명)
3. Studio 출력에 checkDraftBlock 적용, 근거 없는 문장은 `자료 요청`
4. 진단 카드 4종(존재·맥락·시의성·추천) ↔ GEO 퍼널 4단계 매핑

#### Phase 4: 콘텐츠 최적화 랩 (FeatGEO 재구현)
1. feature-schema: 13 피처 한국어 가이드 + 사실 제약
2. feature-extractor: 페이지 피처 프로필
3. citation-sim: 실제 인용 경쟁 출처 + 내 페이지 → [n] 인용 응답, 단어·위치 가중 노출도
4. pareto: NSGA-II (노출도 vs 품질, 사실 검사는 제약)
5. 소형 GA (개체 6 × 세대 3), 비용 사전 추정·한도 연동
6. 결과는 "시뮬레이션 추정치"로 분리 표시, 실측과 합산 금지

#### Phase 5 (선택): 검수함과 공개 리포트
1. 불확실 식별·충돌 주장 검수함, 정밀도/재현율 기준 충족 시 예외 모드
2. 분모 공개 만료형 공유 링크

#### 리스크
- 높음: 배포 SQLite 데이터 마이그레이션 → 컬럼 추가만, 삭제 없음
- 높음: web_search·GA 비용 → 사전 추정 + 하드캡
- 중간: 시뮬레이터 대표성 → "추정" 명시, 실측 비교 기록
- 중간: 구독핀 프록시 도구 지원 미확인 → Phase 2 스파이크
- 낮음: 800줄 근접 파일 → 새 로직은 별도 파일
