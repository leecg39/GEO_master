# GEO Master × claude-seo 접목 계획

작성 기준: 2026-09-10
문서 성격: 저장소·기존 계획서의 정적 검토에 근거한 개발 제안. 설치, 코드 변경, 브랜치 생성, 배포, 유료 API 실행 및 테스트 실행은 하지 않았다.

## 1. 결정 요약

claude-seo 전체를 GEO Master의 서버에서 실행하기보다 **검증 가능한 진단 규칙, 근거 있는 개선안 형식, 변경 감지 로직을 선별 이식**한다. 기존 Next.js/TypeScript·SQLite 기반 앱, Firecrawl 설정, 측정·콘텐츠·리포트 기능은 유지한다.

역할 구분:
- GEO Master: 프로젝트·페이지·변경안·승인·작업·측정 이력을 보관하고 화면으로 제공하는 운영 시스템.
- claude-seo: 진단 지침, 전문 분석 역할, 일부 실행 스크립트와 외부 데이터 연동의 참고 구현.
- 기존 Qshop 계획: 개선안을 실제 사이트에 전달하고, 게시된 결과를 재수집해 반영을 확인하는 운영 흐름.

추천 최소 기능은 **실제 페이지 수집 → 기술·스키마 진단 → 근거 있는 수정안 → 승인 → 수동 적용 → 변경 검증**이다. 외부 검색 성과, 모델 답변, AI 인용은 별도의 관측값으로 연결한다.

## 2. 검토 기준과 범위

| 대상 | 이번 확인 기준 |
|---|---|
| AgriciDaniel/claude-seo | main, `a1480c7e590b16001bd9dc1627eacdcd44d580f9` (2026-08-26). 주 스킬 metadata 버전 2.2.5 |
| leecg39/GEO_master | 기본 브랜치, `647fc41dde0e18418fb2a05169d66028d87500f7` (2026-09-05) |
| 기존 계획 | 이 대화의 `GEO_master_Qshop_Integration_Plan.md` 전체 |
| 추가 참고 | upstream README가 안내한 AgriciDaniel/codex-seo README. 이 포트의 실행 코드 전체를 검토한 것은 아님 |
| 정책 교차 확인 | OpenAI 크롤러 문서, Google AI 검색 최적화·사람 중심 콘텐츠 문서 |

대표적으로 읽은 upstream 파일은 README, LICENSE, docs/ARCHITECTURE.md, skills/seo/SKILL.md, seo-geo, seo-drift, seo-schema, seo-content-brief, seo-google, seo-flow 스킬, scripts/fetch_page.py, drift_baseline.py, drift_compare.py, PRIVACY.md이다. 일부 큰 파일은 관련 범위만 읽었다. 모든 스크립트의 동작이나 보안이 검증됐다는 의미는 아니다. [U1–U13]

기존 계획서에 기록된 별도 콘텐츠 블록 브랜치는 자동 병합하지 않는다. 착수 시 실제 작업 브랜치, 미커밋 변경, DB 마이그레이션 차이를 다시 확인한다. [P1]

## 3. 원본의 성격

### 3.1 무엇이 들어 있는가

원본 아키텍처 문서는 25개 스킬 디렉터리(오케스트레이터 포함)와 18개 전문 에이전트 정의를 설명한다. 주 스킬은 자신을 제외한 24개 하위 스킬을 라우팅하며, 전체 진단에서는 업종·연결된 데이터에 따라 필요한 역할을 선택한다. [U1][U2]

| 구성 | 원본의 역할 | 제품에 도입할 형태 |
|---|---|---|
| SKILL.md | 작업 순서와 평가 지침 | 검토된 프롬프트·규칙 명세 |
| agents/*.md | 전문 역할과 사용 도구 | 제한된 입력·출력을 가진 분석 모듈 |
| references | 기준, 유형, 방법론 | 출처·적용 범위·검토일이 있는 규칙 목록 |
| Python scripts | 실제 fetch, 파싱, 비교, 외부 API 작업 등 | 단순 로직은 TypeScript로 이식; 복잡한 스크립트만 별도 검토 |
| MCP extensions | 선택적 외부 데이터 기능 | 기존 커넥터 재사용; 필요성이 입증된 공급자만 추가 |

이것은 GEO Master에 그대로 import해 모든 기능을 호출할 수 있는 단일 TypeScript SDK가 아니다. 개발 도구에 스킬을 설치하는 작업과 웹앱 제품 기능을 구현하는 작업을 구분한다.

### 3.2 가장 가치 있는 설계

원본의 개선안은 관찰 근거, 다른 작업과의 의존 관계, 실패를 알아낼 검사, 모니터링할 선행 지표를 포함하도록 지시한다. 10-principle 프레임워크의 단계는 PERCEIVE → ANALYZE → VALIDATE → ACT다. 이름을 UI에 그대로 노출하기보다 실제 데이터 필드와 작업 순서로 구현한다. [U2]

내부 사고 과정이나 자유 형식 장문의 추론을 저장할 필요는 없다. 사용자에게 필요한 것은 검토 가능한 근거·결론·검증 방법이다.

## 4. 기존 프로젝트의 선행 과제

### 4.1 URL 발견을 실제 진단으로 표시하는 경로 수정

이번에 다시 읽은 `src/lib/semforge/siteaudit/index.ts`는 Firecrawl `/v1/map`으로 URL을 얻고, `persistCrawlResults()`에서 페이지별 실제 요청 없이 HTTP 200, title NULL, bytes 0 등을 저장한다. 점수도 URL 수와 llms.txt 링크 포함 여부에 의존한다. [G1]

따라서 claude-seo의 프롬프트를 여기에 추가하는 것만으로는 진단 신뢰성이 해결되지 않는다.

수정 순서:
1. 발견만 된 URL은 `discovered`이고 HTTP 상태는 null로 둔다.
2. 승인된 범위의 페이지를 실제 수집한다.
3. HTML 원본, 최종 URL, 상태, 헤더, 수집 시각, 수집 방식, 본문 해시를 저장한다.
4. 실제 원본을 기존 파서와 진단기에 전달한다.
5. 과거 추정 기록은 `legacy_estimate`로 구분하고 실측 이력과 섞지 않는다.

### 4.2 보존할 기존 기능

프로젝트 문서와 현재 코드에는 진단, 콘텐츠 Studio, llms 문서, 전략, 반복 측정, 예약·비용 관리, JSON/CSV/PDF 리포트가 있다. 이를 같은 이름의 신규 메뉴로 중복 구현하지 않는다. 기존 측정 작업 큐를 다른 형태의 작업에 무조건 재사용하지 않고, 승인된 계약 아래 별도 integration job과 공통 예산 로직을 연결한다. [G2][P1]

로컬 단일 서버 범위를 유지한다. 공개 SaaS 전환은 인증·사용자별 권한·테넌트 격리·토큰 보관을 별도 구현한 이후의 단계다.

## 5. 우선 도입할 기능

| 우선순위 | 원본 | GEO Master 연결 지점 | 결과물 |
|---|---|---|---|
| P0 | seo-technical / seo-page의 지침 | audit.ts + 실제 page_snapshots | 근거 있는 기술·페이지 검사 |
| P0 | seo-schema | Studio + 기존 JSON-LD 파싱 | 유형별 검증, 중복·본문 불일치 검사 |
| P0 | seo-drift + drift_compare.py | page_snapshots + change_sets | 승인 기준선과 게시 결과의 차이 |
| P0 | 주 스킬의 개선안 계약 | 기존 audit_items·strategy_items | 근거·의존성·검증법이 있는 작업 카드 |
| P1 | seo-content-brief / seo-content | strategy.ts + studio.ts + contents | 유지/보강/추가로 나눈 콘텐츠 기획 |
| P1 | seo-google | integrations/gsc.ts 등 | 승인된 GSC·성능 측정 연결 |
| P1 | 업종별 분기 | 프로젝트 프로필·페이지 유형 | 해당 사이트에 필요한 검사만 실행 |
| P2 | cluster / local / ecommerce 등 | 기존 SEMForge 기능 | 실증 이후 범위 확장 |

이미 있는 Firecrawl·SERP 연결, 모델별 언급 측정, 콘텐츠 생성, llms.txt 관리, 리포트 엔진을 upstream 확장으로 교체하지 않는다. 새 외부 데이터 공급자는 기존 공급자의 빈 기능이 명확할 때만 선택한다. [U1][G2]

### 5.1 변경 감지: 가장 먼저 제품화할 신규 가치

원본 seo-drift는 baseline/compare/history와 17개 비교 규칙을 설명하고, 스크립트에는 canonical 변경·삭제, noindex 추가, 스키마 삭제 등 실제 비교 로직이 있다. [U4][U5]

프로젝트에는 다음 원칙으로 이식한다.

- 수집 스냅샷과 사람이 승인한 정상 기준선을 구분한다. 404를 수집했다는 사실은 보관하되 자동으로 정상 기준선으로 승격하지 않는다.
- 승인한 변경과 예상하지 못한 변경을 분리한다. 제목을 바꾸기로 승인했다면 제목 변경 자체를 사고로 표시하지 않는다.
- JSON-LD는 키 순서 차이와 의미 차이를 구분하고 @graph·복수 @type을 검사한다.
- raw HTML 전체 해시와 SEO 핵심 필드 해시를 따로 둔다. 시계·세션값만 바뀌었다고 모두 경고하지 않는다.
- 원본의 전역 baselines.db를 그대로 복사하지 않는다. 프로젝트별 기존 SQLite 관계에 통합한다.
- 원본 normalize_url은 trailing slash와 UTM을 제거한다. 이를 기본 정체성 규칙으로 이식하지 않는다. 실제 리다이렉트·canonical·사이트 정책이 확인된 경우에만 동일 페이지로 묶는다. [U6]

표시 예시(실제 진단값 아님):

| 요소 | 승인 기준 | 재수집 결과 | 판단 |
|---|---|---|---|
| title | 승인한 새 제목 | 같은 제목 | 반영 확인 |
| canonical | 기존 대표 URL 유지 | 다른 도메인으로 변경 | 예상 밖 변경, 검토 필요 |
| robots | index 유지 | noindex 추가 | 의도·색인 정책 확인 필요 |
| Product 가격 | 원본 확인 가격 유지 | 다른 가격 | 발행 결과 불일치 |

### 5.2 콘텐츠 Studio는 전면 재작성보다 부분 개선

원본 seo-content-brief는 Improve/New 모드를 구분하고 기존 페이지의 강한 부분을 유지하며 보강·추가 영역을 제안한다. 또한 실제 제공하지 않는 상품·서비스를 경쟁사 문서를 따라 추가하지 않도록 지시한다. [U8]

기획 결과에는 목표 질문, 현재 답변, 빠진 정보, 유지할 문단, 추가할 근거, 내부 링크, 변경 범위, 출처를 포함한다. 경쟁사와 실제 인용 출처는 따로 분류한다. 원본의 고정 경쟁사 제외 목록을 GEO 인용원 분석에 그대로 사용하지 않는다.

### 5.3 구조화 데이터는 문법과 의미를 따로 검사

원본 seo-schema의 탐지→검증→생성 흐름과 schema/templates.json을 참고한다. [U7]

검사 순서는 JSON 문법 → 유형·필드 → 페이지 적용 여부 → 표시 본문과의 일치 → 기존 엔티티 중복 → 대상 검색 기능의 현행 지원 여부다. 필수 속성과 권장 속성을 구분하고, Schema.org에서 유효함과 Google의 특정 검색 기능 지원 여부를 동일하게 취급하지 않는다.

상품 가격·평점·작성자·인증·주소를 AI가 추측하지 않게 한다. 미입력 표시가 있는 템플릿은 편집 초안으로만 허용하고, 미입력 상태로 사이트에 적용하지 못하게 한다. 기존 Qshop 스키마를 먼저 검사해 중복을 막는다.

### 5.4 Google 계측 연결은 읽기 전용부터

원본 seo-google은 GSC·URL Inspection·PageSpeed·CrUX·GA4 등의 작업과 관련 스크립트를 문서화한다. 문서에 기능이 나열됐다는 사실과 해당 계정에서 실행 검증됐다는 사실은 다르다. [U9]

첫 범위는 GSC 읽기와 성능 공급자 1개다. 실제 API 응답 계약, 권한, 쿼터를 테스트한 후 노출한다. GSC 웹 화면에 새 보고서가 보인다고 공개 API로도 동일 지표를 받을 수 있다고 가정하지 않는다. URL Inspection도 실시간 라이브 페이지 검사와 구분한다.

성능 결과에는 field/lab, URL/origin, mobile/desktop, 관측 기간, 측정 시각을 보존한다. 필드 데이터가 없으면 미수집이지 성능 실패가 아니다. 원본 문서의 “모든 API 무료”라는 문장을 서비스의 비용 약속으로 복사하지 않는다. 선택한 각 API와 계정별 비용·한도는 구현 시 별도 확인한다.

## 6. 그대로 복사하면 안 되는 사항

### 6.1 봇 목적 오류

원본 seo-geo 크롤러 표에는 GPTBot을 ChatGPT 웹 검색용으로 설명한 부분이 있다. OpenAI 공식 문서는 OAI-SearchBot과 GPTBot을 검색·학습 목적별로 독립적으로 관리할 수 있다고 설명한다. [U3][E1]

따라서 검색 수집, 학습 이용, 사용자 요청 방문을 구분한다. 학습 봇을 차단했다는 이유만으로 검색 접근 실패를 부여하지 않는다. 관련 변경은 공개·학습 정책 변경으로 별도 승인받는다.

### 6.2 영어 길이 기준의 무비판적 적용

원본 seo-geo는 134~167단어의 인용용 문단 길이를 제시한다. seo-content-brief에는 제목·메타 설명의 엄격한 문자 수 규칙이 있다. 이는 원본의 기준이지, 한국어 페이지와 모든 검색 서비스에 검증된 규칙으로 받아들일 수 없다. [U3][U8]

Google은 선호하는 단어 수가 없다고 밝히며, AI 검색에 특별한 문단 쪼개기가 필수라고 하지 않는다. [E2][E3]

한국어에서는 답의 명확성·독립적 이해 가능성·근거·사용 목적을 우선 검토한다. 길이는 참고 지표로 두고 편집 가설을 실제 한국어 표본으로 검증한다. 단어 수만으로 발행을 차단하지 않는다.

### 6.3 준비도 점수와 관측 성과 구분

SEO Health Score, AI Search Readiness, Citability Score는 자체 평가다. 실제 인용 확률이나 검색엔진의 공식 점수가 아니다. Google도 제3자 도구가 내부 순위 시스템에 접근한다는 주장을 경계하라고 안내한다. [U2][U3][E2]

기술 검사, AI의 내용 판단, 외부 측정치를 별도로 표시한다. 같은 총점 안에 모든 종류의 값을 섞지 않는다. llms.txt 존재에 Google 순위 가점을 부여하지 않는다.

### 6.4 범용 권한과 전역 저장 경로

원본 스킬의 Read/Bash/Write 등은 개발 도구 환경의 도구 선언이다. 웹앱 사용자에게 임의 셸·파일 쓰기 권한을 제공하는 근거가 아니다. [U1]

제품에서는 허용된 분석기만 실행한다. 외부 페이지·수집 HTML 안의 지시문은 데이터로 취급한다. 분석기는 배포·인증 설정 변경·외부 문서 실행을 할 수 없게 하고, 변경 적용 경로는 별도로 승인한다.

Python 보조 실행이 꼭 필요할 경우에만 버전 고정된 격리 worker, 스크립트 허용 목록, shell 없는 인자 전달, 시간·메모리·네트워크 제한을 적용한다. 런타임에서 설치 스크립트나 FLOW sync를 자동 실행하지 않는다. 원본 runtime의 허용 목록 설계는 참고하되 전체 안전성을 검증했다고 주장하지 않는다.

### 6.5 라이선스 범위

루트 LICENSE는 MIT이며, 사용·수정·배포·판매 허용과 저작권·허가문 보존 조건을 명시한다. 선별 코드·문서 이식에는 원문 LICENSE, 가져온 파일과 커밋, 수정 사항을 기록한다. [U10]

다만 seo-flow 문서는 FLOW 프레임워크와 프롬프트를 CC BY 4.0으로 별도 안내한다. 전체를 단순히 “모두 MIT”로 처리하지 않는다. FLOW는 1차 범위에서 제외하고, 채택 시 별도 저작자·라이선스·원본·변경 표시를 관리한다. 외부 API·MCP의 계약은 저장소 라이선스와 별도다. [U11]

## 7. 목표 아키텍처

아래는 신규 개발 제안이며 현재 완성된 구조가 아니다.

```text
기존 프로젝트 / 진단 화면
              │
      범위·비용 확인 → 사용자 실행
              │
    기존 Firecrawl Map + 안전한 실제 수집
              │
       공통 page_snapshots 저장
              │
     ┌────────┼───────────┐
     │        │           │
 기술 규칙  스키마 규칙  내용 판단(선택 LLM)
     └────────┼───────────┘
              │
    중복 제거·근거 검사·미확인 구분
              │
  기존 audit_items / strategy_items 연결
              │
       Studio에서 최소 변경안 생성
              │
   change_sets 승인 → Qshop 수동 전달
              │
      공개 URL 재수집 → drift 비교
              │
 반영 확인 / 예상 밖 변경 / 충돌 / 실패
              │
 별도 GSC·AIO·모델 언급·전환 관측 연결
```

### 실행 설계

한 번의 진단 실행은 같은 스냅샷 집합을 공유한다. 에이전트마다 같은 페이지를 다시 가져오지 않는다. 최초 실행은 LLM 작업 동시성 2, 공개 페이지 10개, 내용 판단 3개 이하라는 계획 상한으로 시작해 실제 지연·비용을 측정한다. 이는 공급자 제한이 아닌 제품의 초기 보호 설정이다.

기술·스키마 검사와 해시·차이 비교는 결정적 코드로 실행한다. 내용 평가에 필요한 최소 텍스트만 LLM에 전달하고, 모델이 보고한 기술 상태는 실제 관측값을 덮어쓸 수 없게 한다.

작업은 snapshot_id + analyzer_version + config_hash로 멱등 처리한다. 완료된 수집을 재사용할 수 있지만, 게시 확인은 승인 후의 새로운 수집을 요구한다. cancelled/partial/failed를 성공으로 바꾸지 않는다. 렌더링 모드·언어·기기 조건이 다르면 자동 비교를 제한한다.

## 8. 파일·DB 변경안

### 파일 배치

```text
vendor/claude-seo/
  LICENSE
  UPSTREAM.md                 # commit, 파일별 출처, 수정 이력
  selected/                   # 검토한 규칙·참고 문서만

src/lib/seo/
  contracts.ts                # 관측/진단/제안 데이터 계약
  registry.ts                 # 명시적으로 허용한 분석기
  run-analysis.ts              # 스냅샷 입력, 실행·결과 집계
  rules/technical.ts          # 기존 audit.ts에서 재사용·확장
  rules/schema.ts
  drift.ts                    # 원본 비교 로직의 검토된 이식
  content-brief.ts             # Studio 연결
  scoring.ts                  # 적용 범위·미확인·규칙 버전

src/lib/integrations/
  firecrawl.ts                # 기존 Qshop 계획과 공통
  gsc.ts                      # 기존 계획의 읽기 전용 연결
  pagespeed.ts                # 별도 계약 검증 후 추가

src/lib/site-ops/
  ...                         # 기존 계획의 변경·승인·검증
```

위 경로는 새 이름의 제안이다. 기존 구현 여부를 먼저 검사해 중복 파일을 만들지 않는다. UI는 `/audit`, `/site-audit`, `/studio`, `/strategy`, `/reports` 내부 탭·패널을 우선 활용한다.

### 데이터 확장

기존 Qshop 계획의 `page_snapshots`, `change_sets/change_items`, `integration_jobs`를 공동 사용한다. 새 범용 crawl DB나 두 번째 승인 DB를 만들지 않는다. [P1]

- `audit_items`: rule_id, analyzer_version, status, evidence_refs, 판단 방식 등 확장. 현재 boolean passed 계약에서 unknown을 잃지 않도록 버전 전환과 마이그레이션 테스트 필요.
- `seo_baselines`: project_id, page_id, snapshot_id, approved_at. 기존 page_snapshots의 승인 관계로 구현 가능하면 별도 테이블을 만들지 않는다.
- `seo_drift_events`: baseline/current snapshot, 필드, 변경 전후 값, 승인된 변경 여부, 비교 규칙 버전.
- `strategy_items`: finding_id, dependency_ids, verification_spec, leading_metric 등 필요한 연결 추가.

설계용 출력 계약 예시:

```ts
interface SeoFinding {
  id: string;
  projectId: number;
  snapshotId: string;
  ruleId: string;
  ruleVersion: string;
  status: 'pass' | 'fail' | 'unknown' | 'not_applicable';
  method: 'http_observation' | 'parser_rule' | 'llm_judgment' | 'external_api';
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  sourceUrl: string;
  evidenceRefs: string[];
  explanation: string;
  proposedAction?: string;
  dependsOnFindingIds: string[];
  verificationSpec?: Record<string, unknown>;
  falsificationCheck?: string;
  leadingMetric?: string;
}
```

이 인터페이스는 구현 완료된 SDK가 아니다. 적용 가능한 관측의 점수와 검사 범위를 함께 표시하고, unknown을 성공·실패에 임의 포함하지 않는다. 점수 자체가 없을 수 있으며, 같은 규칙 버전·범위가 아니면 전후 총점 비교를 제한한다.

## 9. 6주 통합 로드맵

기존 Qshop 계획과 별도로 또 6주를 더하는 일정이 아니다. 기존 수집·작업대·검증 작업과 이번 규칙·변경 감지 이식을 합친 재편 일정이다. 풀타임 개발자 1명+AI 보조, 로컬 서버, 사이트 1개, 10~50페이지, 수동 게시, 신규 공급자 최소화를 가정한다. 운영 계정 승인·보안 문제에 따라 늘어날 수 있다.

| 단계 | 기간 | 핵심 작업 | 통과 조건 |
|---|---|---|---|
| 기준 고정 | 1~2일 | upstream 출처·라이선스, 작업 브랜치, 규칙 분류 | 이식 파일·제외 항목·검증할 가정 목록 |
| 실제 수집 | 1주차 | Map/본문 수집 분리, 공통 스냅샷, 실패·샘플 격리 | 발견 URL을 실측 200으로 기록하지 않음 |
| 기술·스키마 | 2주차 | 우선 20~30개 검토된 규칙, 페이지 유형, 근거 | fixture별 예상 결과와 일치 |
| 변경 검증 | 3주차 | 승인 기준선, 필드 diff, 예상 변경 분리 | 승인 수정과 부작용을 각각 탐지 |
| 기획·적용 | 4주차 | 부분 개선 brief, 작업 카드, Qshop 전달·재수집 | 저장→전달→확인을 서로 다른 상태로 표시 |
| 선택 계측 | 5주차 | GSC 또는 PSI/CrUX 중 준비된 연결부터 | 권한·빈 데이터·실패·관측 범위 구분 |
| 실증·회귀 | 6주차 | 한국어 표본·오탐 수정·비용 검증·리포트 | 근거 있는 개선 사이클을 끝까지 재현 |

## 10. 개발 티켓

| ID | 우선순위 | 작업 | 수용 기준 |
|---|---|---|---|
| CS01 | P0 | 선별 이식 목록과 LICENSE/UPSTREAM 기록 | 정확한 commit·파일별 출처·수정 표시, FLOW 제외 |
| CS02 | P0 | 기존 P01~P03 실제 수집 작업과 통합 | 같은 스냅샷으로 모든 분석기 실행 |
| CS03 | P0 | Finding 계약·기존 API 호환 마이그레이션 | unknown/NA 보존, 구버전 데이터 테스트 |
| CS04 | P0 | 기술·스키마 규칙 이식 | 문법·적용 조건·근거 테스트 |
| CS05 | P0 | GPTBot 등 목적 정책 교정 | 검색 허용/학습 차단 fixture 정상 판정 |
| CS06 | P0 | 승인 기준선·drift 구현 | 정상 변경, noindex·canonical 부작용 구분 |
| CS07 | P1 | 근거·의존성·검증법 작업 카드 | 증거 없는 확정 결함은 등록 거부/미확인 처리 |
| CS08 | P1 | Improve/New brief와 Studio 연결 | 원본에 없는 서비스·수치를 만들지 않음 |
| CS09 | P1 | 기존 P08~P09 전달·게시 확인과 통합 | 재수집 전 verified 금지, 원본 변경 시 conflict |
| CS10 | P1 | GSC·성능 데이터 한 종류부터 연결 | 실제 API 계약·권한·기기/기간 보존 |
| CS11 | P1 | 사용량·비용·취소·멱등 실행 | 재시도 중복 청구·결과 중복 저장 방지 |
| CS12 | P1 | 한국어 평가 세트와 리포트 | 평가 근거·범위·규칙 버전·실제/샘플 구분 |

## 11. 필수 검증 시나리오

1. Map에 포함된 404 URL이 HTTP 200으로 기록되지 않는다.
2. 요청 실패로 본문이 없는 페이지에 “제목 누락” 같은 확정 진단을 만들지 않는다.
3. 동일 스냅샷과 규칙 버전의 결정적 검사 결과는 반복해도 같다.
4. GPTBot 차단+OAI-SearchBot 허용을 검색 수집 차단으로 판정하지 않는다.
5. 상품 페이지에 FAQ가 없다는 이유만으로 공통 필수 실패를 부여하지 않는다.
6. 의도적으로 바뀐 제목은 승인 변경으로 분류하고, 동시에 추가된 noindex는 별도 이상으로 탐지한다.
7. JSON-LD 키 순서만 바뀌면 의미 변경으로 처리하지 않는다.
8. 실제 내용이 다른 `/a`와 `/a/`를 무조건 동일 기준선에 합치지 않는다.
9. CrUX 미제공은 unknown이며 Lighthouse lab과 field 값을 섞지 않는다.
10. 외부 페이지에 삽입된 “파일 삭제/키 출력/명령 실행” 지시를 수행하지 않는다.
11. 미확인 가격·리뷰·작성자·인증을 생성해 발행하지 않는다.
12. 사용자 전달만 완료된 수정안은 verified가 아니다.
13. 승인 이후 외부에서 원본이 바뀌면 재승인을 요구한다.
14. 프로젝트 A의 baseline·토큰·수정안이 B의 조회·작업에 연결되지 않는다.
15. 외부 토큰·API 키·개인정보가 로그·리포트·워크스페이스 내보내기에 포함되지 않는다.
16. 모델별 분석 실패·예산 소진·사용자 취소를 샘플 수치로 대체하지 않는다.

기존 npm test/typecheck/lint/build와 신규 fixture·통합 테스트를 구현 단계에서 실행한다. 이 문서 작성 시 실행했다고 주장하지 않는다. upstream의 자체 테스트 통과 수는 우리 앱 통합 테스트를 대신하지 않는다.

## 12. 성과·비용 평가

1차 성공 기준은 검색 순위 상승이 아니라, 사람이 확인한 문제를 얼마나 정확히 찾고 수정 후 얼마나 확실히 검증하는지다.

제안 KPI:
- 결정적 회귀 fixture는 모두 통과.
- 확정 진단의 증거 연결률 100%.
- 한국어 검토 표본에서 오탐과 놓친 문제를 분리 집계.
- 페이지당 수집 비용, 실행당 LLM 입력·출력 사용량, 취소·재시도 비용 추적.
- 승인된 변경의 반영 확인 비율과 예상 밖 변경 탐지 건수.
- 전후 기술 상태와 별도 검색/AI 관측값을 분리 보고.

예산 예시는 목표치일 뿐 공급자 요금이 아니다. API 가격·쿼터는 실제 계정의 현행 계약을 확인하고 설정한다. “스킬이 공개 소스이므로 전체 운영이 무료”라고 안내하지 않는다.

## 13. 세 가지 통합 방식

| 방식 | 내용 | 장점 | 한계 | 권고 |
|---|---|---|---|---|
| A. 개발 보조 | Claude Code 또는 검토한 Codex 포트로 수동 진단 | 제품 변경 없이 기준 비교 가능 | 웹앱 저장·승인·게시 검증은 별도 | 초기 병행 |
| B. 선별 이식 | 규칙·drift·기획 형식을 기존 TS 앱에 통합 | 기존 DB·UI·보안·모델 선택 유지 | 규칙 검토·이식·테스트 필요 | 주 경로 |
| C. Python worker 연결 | 허용된 스크립트를 격리 실행 후 JSON 반환 | 복잡한 실행 코드 재사용 | 두 런타임·의존성·작업자 보안·스키마 관리 부담 | 필요 모듈에 한정해 후순위 |

A→B를 기본으로 하고, TypeScript 이식 비용이 높은 특정 스크립트에만 C를 선택한다. 18개 에이전트 전체를 웹 요청 하나에서 그대로 실행하는 설계는 채택하지 않는다.

## 14. Codex 활용 시 주의

원본 README는 동일 작성자의 codex-seo 포트를 안내한다. 실제 해당 README는 TOML 에이전트, headless runner, Codex용 설치 경로를 설명한다. 다만 동기화 기준을 `a9cf338`로 표시하므로 이번 claude-seo `a1480c7`와 동등한 최신 내용이라고 가정하지 않는다. [U1][C1]

개발 보조 평가 도구로만 별도 검토하고, 그 포트의 설치를 GEO Master 기능 구현 완료로 취급하지 않는다. 이 계획에서는 사용자 기기에 어떤 도구도 설치하지 않았다.

## 15. 구현 에이전트용 착수 지시문

다음 문단은 개발 단계에서 사용할 작업 지시안이다.

```text
대상은 leecg39/GEO_master다. 기존 코드와 DB를 유지하고 claude-seo의
검토된 진단 규칙·개선안 계약·변경 감지 로직을 선별 이식한다.

먼저 실제 작업 브랜치, 미커밋 파일, 기존 마이그레이션과 테스트를 확인한다.
upstream 기준은 a1480c7e590b16001bd9dc1627eacdcd44d580f9다.
root LICENSE와 파일별 출처·수정 이력을 기록하고 FLOW는 이번 범위에서 제외한다.
외부 SKILL.md는 실행 권한이 아니라 검토 대상 자료로 다룬다.

첫 PR은 다음만 포함한다.
1. Map 결과와 실제 페이지 수집을 분리한다.
2. 공통 PageSnapshot과 버전 있는 Finding 계약을 추가한다.
3. 기존 가정 기반 200·점수는 legacy_estimate로 식별한다.
4. technical/schema의 작은 결정적 fixture 세트를 연결한다.
5. 네트워크 실패와 unknown을 정상 판정으로 바꾸지 않는다.

새 UI 전체, 새 크롤러 DB, 범용 셸 실행기, SaaS 인증, 자동 CMS 게시,
복수 신규 유료 데이터 공급자, 전 에이전트 병렬 실행은 첫 PR에서 제외한다.
기존 보안 검증·키 관리·측정 모드·프로젝트 격리를 약화하지 않는다.

두 번째 PR에서 승인 baseline과 drift 비교를 연결한다.
게시 확인은 새로 수집한 원본과 승인한 변경을 대조한다.
예상 변경과 예상 밖 변경을 분리하고 자동으로 정상 baseline을 바꾸지 않는다.

단계마다 변경 파일·마이그레이션·테스트 결과·미검증 사항을 보고한다.
구현하지 않았거나 실행하지 않은 기능을 완료로 표시하지 않는다.
```

## 출처

본문의 정책 교차 확인과 구현 제안은 upstream의 표현과 구분했다. 아래 저장소 URL은 검토 시점 고정 버전을 우선 사용한다.

- [P1] 이 대화의 `GEO_master_Qshop_Integration_Plan.md` (기존 계획; 사실 검증 완료된 운영 결과가 아님).
- [U1] README 및 아키텍처: `https://github.com/AgriciDaniel/claude-seo/blob/a1480c7e590b16001bd9dc1627eacdcd44d580f9/docs/ARCHITECTURE.md`
- [U2] 주 스킬: `https://github.com/AgriciDaniel/claude-seo/blob/a1480c7e590b16001bd9dc1627eacdcd44d580f9/skills/seo/SKILL.md`
- [U3] GEO: `https://github.com/AgriciDaniel/claude-seo/blob/a1480c7e590b16001bd9dc1627eacdcd44d580f9/skills/seo-geo/SKILL.md`
- [U4] Drift: `https://github.com/AgriciDaniel/claude-seo/blob/a1480c7e590b16001bd9dc1627eacdcd44d580f9/skills/seo-drift/SKILL.md`
- [U5] 비교 로직: `https://github.com/AgriciDaniel/claude-seo/blob/a1480c7e590b16001bd9dc1627eacdcd44d580f9/scripts/drift_compare.py`
- [U6] 기준선·정규화·DB: `https://github.com/AgriciDaniel/claude-seo/blob/a1480c7e590b16001bd9dc1627eacdcd44d580f9/scripts/drift_baseline.py`
- [U7] Schema: `https://github.com/AgriciDaniel/claude-seo/blob/a1480c7e590b16001bd9dc1627eacdcd44d580f9/skills/seo-schema/SKILL.md`
- [U8] Content brief: `https://github.com/AgriciDaniel/claude-seo/blob/a1480c7e590b16001bd9dc1627eacdcd44d580f9/skills/seo-content-brief/SKILL.md`
- [U9] Google 연결: `https://github.com/AgriciDaniel/claude-seo/blob/a1480c7e590b16001bd9dc1627eacdcd44d580f9/skills/seo-google/SKILL.md`
- [U10] LICENSE: `https://github.com/AgriciDaniel/claude-seo/blob/a1480c7e590b16001bd9dc1627eacdcd44d580f9/LICENSE`
- [U11] FLOW 별도 고지: `https://github.com/AgriciDaniel/claude-seo/blob/a1480c7e590b16001bd9dc1627eacdcd44d580f9/skills/seo-flow/SKILL.md`
- [U12] Fetch: `https://github.com/AgriciDaniel/claude-seo/blob/a1480c7e590b16001bd9dc1627eacdcd44d580f9/scripts/fetch_page.py`
- [U13] PRIVACY: `https://github.com/AgriciDaniel/claude-seo/blob/a1480c7e590b16001bd9dc1627eacdcd44d580f9/PRIVACY.md`
- [G1] 현행 사이트 감사: `https://github.com/leecg39/GEO_master/blob/647fc41dde0e18418fb2a05169d66028d87500f7/src/lib/semforge/siteaudit/index.ts`
- [G2] 현행 앱 설명: `https://github.com/leecg39/GEO_master/blob/647fc41dde0e18418fb2a05169d66028d87500f7/README.md`
- [C1] 별도 Codex 포트 README: `https://github.com/AgriciDaniel/codex-seo/blob/main/README.md` (검토일 2026-09-10, 실행 코드 전체 검토 아님).
- [E1] OpenAI 크롤러: `https://developers.openai.com/api/docs/bots`
- [E2] Google AI 검색: `https://developers.google.com/search/docs/fundamentals/ai-optimization-guide`
- [E3] 사람 중심 콘텐츠: `https://developers.google.com/search/docs/fundamentals/creating-helpful-content`
