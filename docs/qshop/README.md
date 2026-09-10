# GEO Master × Qshop 적용 내역

2026-09-09 · 기준 문서: `/Users/user01/Desktop/GEO_master/GEO_master_Qshop_Integration_Plan.md`

기존 앱에 1차 운영 흐름을 연결했다. `/site-audit`에서 실제 페이지를 수집하고, 현재값과 수정안을 비교한 뒤 승인·수동 적용 안내·공개 URL 재검증까지 진행한다. `/llms`에서는 경로와 언어별 안내 파일을 저장하고 원격 내용과 비교한다.

## 사용 방법

1. `npm run dev`로 실행하고 **SEMForge → 사이트 진단**을 연다. 기존 SEMForge 구독/체험 권한을 사용한다.
2. 캠페인을 만들고 이름을 선택한다. 큐샵 기존 사이트, 신형 블로그, 일반 사이트 중 적용할 편집기를 지정한다.
3. 공개 HTTPS URL을 직접 수집한다. API 키 없이도 1개 URL을 확인할 수 있다. 여러 URL을 찾으려면 기존 Firecrawl 키를 설정하고 캠페인을 실행한다.
4. 수집한 페이지를 선택해 제목·설명·대표 URL·OG 이미지·robots·JSON-LD를 검토한다. 변경 이유를 기록하고 변경안을 저장한다.
5. 승인자를 기록하고 승인한다. 검색 색인 정책 변경은 별도 체크가 필요하다. 승인과 안내 다운로드 직전에 실제 URL을 재수집하여 원본 변경을 검사한다.
6. 적용 안내 Markdown을 받아 큐샵의 해당 페이지에 반영한다. **다운로드만으로 게시되지는 않는다.**
7. 공개 URL 재검증을 실행한다. 승인 필드와 일치해야 확인 완료이며, 원본 값이면 반영 대기, 다른 값이나 본문 변경이면 충돌이다. 충돌 시 최신 근거에서 새 변경안을 만들어 재승인한다.

## 적용 범위와 후속 단계

| 계획 항목 | 이번 코드 반영 |
| --- | --- |
| P00 기준 확인 | 현재 HEAD `948cd04`, 브랜치 `leecg39/feat-settings-research-assist`. 기획서 기준 `647fc41`과 비교했다. GEO 블록·GeoPageSpec·연구 보조 기능은 이미 포함되어 재사용한다. 기존 미커밋 WordPress/구독/분석 변경을 보존했다. |
| P01~P03 수집 근거 | Firecrawl v2 Map 응답을 검증하고 v1 문자열/v2 객체 링크를 해석한다. 본문은 SSRF 방어 직접 Fetch로 수집한다. 상태·최종 URL·시각·해시·HTML·본문·메타·규칙 버전을 저장한다. 404/429/실패/취소와 부분 성공을 구분한다. |
| P01 이전 추정 기록 | 기존 URL·점수 값은 삭제하지 않고 `legacy_estimate`로 보존한다. 화면과 새 점수에서 격리한다. 새 기록의 미수집 HTTP·깊이·크기는 null이다. |
| P04 규칙 | llms 요약은 선택 품질 안내다. FAQ 없는 페이지에 FAQ 스키마 필수 실패를 부여하지 않는다. 검색 봇·학습 봇·사용자 요청 봇의 정책을 분리한다. |
| P05/P08/P09 작업대 | 프로젝트별 변경안·근거·승인자·시각을 SQLite에 저장한다. 큐샵 편집기별 적용 도우미와 실제 필드 비교, 낙관적 동시성 검사를 구현했다. |
| P06 스키마 | Product, Organization, WebSite, WebPage, BlogPosting, BreadcrumbList 기본 제안과 제한된 필드 검증. 가격·평점·작성자 등은 추측하지 않는다. 본문 근거·원본 값·중복 유형/@id·컨텍스트를 검사한다. 완전한 schema.org/Rich Results 검증기는 아니다. |
| P07 AI 파일 | `/llms.txt`, `/docs/llms.txt` 같은 하위 경로, `llms-ko.txt`·`ai.txt`·`ai-ko.txt` 선택 파일을 개별 저장·다운로드한다. 언어, 버전 비교, MIME/내용 해시 비교를 지원한다. 원격 파일이 초안을 덮어쓰지 않는다. 자동 번역·ZIP 묶음 배포는 포함하지 않는다. |
| 지표 의미 교정 | 모델 호출은 `model_only`, 기존 AIO는 `serp_snapshot`으로 구분한다. 질문·모델·브랜드·반복 수·언어 등의 조건 해시를 기록하고 조건이 다른 전후 증감은 null이다. SERP 집계에서 mock/live를 섞지 않고 citation null을 유지한다. |
| P10~P13 후속 계측 | GSC OAuth, 서버/CDN 로그 수집, 새 웹 검색 citation 호출, CTA/폼 집계는 후속 단계로 남긴다. 현재 미연결 상태를 0으로 표시하지 않는다. 큐샵 관리자 권한·로그/API 계약 검증·자동 게시 기능은 이번에 실행하거나 구현하지 않았다. |

기획서의 4주 MVP 방향 중 공개 페이지 운영 흐름을 적용한 상태이며, 문서 전체 6~8주 로드맵 완료를 의미하지 않는다. 기존 GEO 블록·Studio는 연결 링크와 프로젝트 문맥을 재사용한다. 본문 자체를 외부 에디터에 자동 게시하지 않는다.

## 수집·보관·비용 경계

- Map 실행당 최대 25개 URL, 본문 동시 요청 3개, 직접 수집 캠페인당 최대 50개 URL.
- 연결한 정확한 HTTPS origin만 허용한다. `www`로 리다이렉트하는 사이트는 최종 도메인으로 캠페인을 만든다. 외부 origin·사설 IP·비표준 포트·자격증명 URL은 차단한다.
- 응답은 2MB로 제한한다. 본문 수집은 렌더링 없는 `native_fetch`다. JavaScript가 실행된 브라우저의 화면이나 검색 봇의 수집 성공을 뜻하지 않는다.
- 원본 HTML/추출 Markdown은 URL별 최근 5개, 최대 30일 기준으로 새 수집 시 정리한다. 메타데이터·해시·승인 근거는 보존한다. 모든 승인 근거는 로컬 SQLite에 저장한다.
- `GEO_FIRECRAWL_MONTHLY_MAP_LIMIT=100`이 기본 월간 Map **요청 시도** 한도다. 실패 시도도 보수적으로 예약량에 포함한다. 이는 실제 Firecrawl 청구액이 아니다. 0으로 설정하면 새 유료 Map 시도를 차단한다.
- `PATCH /api/site-audit?id=…`의 `idempotency-key` 헤더를 같은 값으로 재시도하면 저장한 결과를 반환한다. 같은 요청의 Map 예약량과 호출을 중복 계상하지 않는다. 자동 재시도와 오류 시 샘플 대체는 없다.
- 기존 서버 운영 범위는 로컬 단일 워크스페이스다. 승인자 이름은 작업 기록이며, 사용자 인증·다중 고객 권한 격리를 대신하지 않는다.

## DB 호환성과 되돌리기

기존 작업 중이던 마이그레이션 11/12 다음에 **13 (`evidence-based-site-operations`)**을 추가했다. 이전 site_audit_pages의 ID·값을 보존하며 nullable 구조로 전환한다. 과거 llms `deployed` 상태는 내용 일치를 재확인해야 하므로 `validated`로 전환한다.

실제 프로젝트 DB에도 백업 후 v13을 적용했다. `integrity_check=ok`, 외래키 위반 0건을 확인했다.

전체 SQLite 백업 명령:

```sh
node --env-file=.env.local scripts/backup-db.mjs
# 환경변수가 이미 설정된 셸에서는 npm run backup:db
```

원본 DB를 유지한 채 `data/backups/`에 접근 권한 0600의 백업을 만들고 무결성을 검사한다. 이 폴더는 Git에서 제외했다. 이번 작업 전 실제 DB 백업은 `data/backups/geo-2026-09-09T05-05-57.366Z-4584.db`다.

기존 JSON 워크스페이스 내보내기는 llms 경로·언어를 보존한다. **새 사이트 운영 테이블과 llms 전체 revision은 기존 JSON 백업에 포함되지 않으므로 전체 복구에는 SQLite 백업을 사용해야 한다.** JSON 교체 가져오기만으로 이번 운영 이력을 복구할 수 있다고 가정하지 않는다.

롤백이 필요하면 서버를 종료한 후 백업을 별도 작업 디렉터리로 복사하고 `GEO_DB_PATH`를 복사본으로 지정해 확인한다. 이전 코드로 복귀할 때는 해당 시점의 DB 백업과 기존 암호화 키도 함께 유지한다. 현재 작업 트리의 다른 미커밋 변경을 덮어쓰는 초기화 명령은 사용하지 않았다.

## 검증

- `npm run typecheck`, `npm run lint`, `npm run build` 통과.
- Vitest 39개 파일, 214개 테스트 통과. 신규 핵심 시나리오: HTTP 404, Map 429, 취소, 단일 요청 중복 실행/월간 한도, 이전 추정 데이터 마이그레이션, 승인 전후 충돌, 실제 미반영/일치, 프로젝트 경계, schema 사실·중복, 잘못된 MIME, llms 초안 보존.
- 별도 임시 SQLite와 `http://127.0.0.1:3317`에서 Chromium으로 공개 `https://example.com/` HTML 수집 → 초안 → 승인 → 안내 다운로드 → 반영 대기 → 새로고침 상태 보존을 확인했다. 외부 페이지를 수정하지 않았다.
- 390px 모바일에서 가로 넘침을 확인하고 브라우저 예외를 수집했다. 결과 파일: [browser-qa.json](evidence/browser-qa.json), [수집 화면](evidence/01-page-capture.png), [적용 확인 화면](evidence/02-delivery-verification.png), [모바일 화면](evidence/03-mobile.png), [AI 파일 화면](evidence/04-ai-files.png), [적용 안내 예시](evidence/qshop-delivery-example.md).
- 설정 응답을 의도적으로 지연시켜도 입력한 브랜드명과 사용자가 비운 요약이 보존되는지 확인했다.
- Firecrawl 유료 계정 호출과 로그인한 큐샵 관리자 조작은 실행하지 않았다. Firecrawl 외부 계약은 응답 fixture로 검사했고, 실제 페이지 Fetch는 브라우저 QA에서 실행했다.

브라우저 재현 스크립트는 `scripts/qa-qshop.mjs`다. 격리된 DB로 3317 포트 서버를 띄우고 Playwright 모듈 경로를 `GEO_PLAYWRIGHT_MODULE`로 지정한다. 테스트용 캠페인과 로컬 체험 상태를 만들므로 운영 DB로 실행하지 않는다.

## 확인한 공식 자료

- [Firecrawl Map](https://docs.firecrawl.dev/features/map): URL 발견과 본문 수집 구분, v2 링크 객체 계약.
- [llms.txt v2](https://llmstxt.org/): 하위 경로와 선택적 요약.
- [큐샵 SEO/GEO 설정](https://help.qshop.ai/customer_support/guide/setting/manage/seo): 파일·페이지 설정과 기존 구조화 데이터 확인.
- [큐샵 블로그 구조화 데이터](https://qshop.ai/insights/qshop-blog-jsonld-content-type-guide): 블로그 커스텀 스키마 추가와 기존 엔티티 중복 주의.
