# GEO 진단 Markdown 보고서 · 수정 결과 보고서 계획

작성 기준: 2026-10-13
문서 성격: 계획 문서. 코드는 아직 바꾸지 않았다. 승인 후 티켓 순서대로 TDD로 구현한다.

## 1. 결론

RankSEO 5.2.27에서 동작하지 않는 두 보고서를 GEO_master에서는 **기존 "진단 → 수정안 → 승인 → 전달 → 반영 확인" 흐름 위에 새로 만든다.** 원본 복원도, 호출 계약 호환도 하지 않는다.

비유하면 RankSEO는 영수증 프린터가 빠진 계산대다. 계산(진단·수정)은 하는데 영수증(보고서)이 안 나오고, 나온다 해도 "계산 전 금액" 칸이 비어 있다. GEO_master는 이미 장부(audits, change_items, page_snapshots)를 갖고 있으므로, 그 장부에서 검증 가능한 영수증을 뽑으면 된다.

| 보고서 | 한 줄 정의 | RankSEO 대비 차별점 |
|---|---|---|
| A. GEO 진단 Markdown 보고서 | 저장된 진단 1건을 사람과 AI가 함께 읽는 `.md`로 내보낸다 | 실제로 생성됨, 비밀값을 넣지 않음, 측정값과 추정값을 섞지 않음, 같은 입력이면 같은 출력 |
| B. 수정 결과 보고서 (WordPress 포함) | 수정안별로 "원래 값 → 제안 값 → 실제 반영 값"을 증거와 함께 보여 준다 | 수정 전 값을 진단 당시 저장값에서 가져오고, 수정 후 값을 서버에서 다시 받아 확인한다. 가짜 점수 상승을 표시하지 않음 |

## 2. 근거

### 2.1 참조한 자료

- 보고서 위치 정정: 요청에 적힌 `profound_REA/output/rea/REA_REPORT.md`는 **Profound 플랫폼** 분석이다. RankSEO 분석은 `profound_REA/output/rankseo-rea-2026-10-12/`에 있다. 이 계획은 다음 세 문서를 근거로 한다.
  - `rankseo-rea-2026-10-12/REA_REPORT.md`
  - `rankseo-rea-2026-10-12/missing-scripts/README.md`
  - `rankseo-rea-2026-10-12/reports/missing-script-contracts.md`
- RankSEO 코드는 설계 참고용 "결함 목록"으로만 쓴다. 코드를 복사하지 않는다.

### 2.2 RankSEO에서 확인된 결함 → GEO_master 설계 원칙

| # | RankSEO 결함 (REA 근거) | GEO_master 원칙 |
|---|---|---|
| 1 | `md-report-generator.js`, `mcp-fix-report.js`가 배포본에 없음 | 보고서 생성은 서버 모듈 + 테스트로 존재를 보장한다 |
| 2 | 수정 전 값이 `raw.meta.title` 등 존재하지 않는 경로에서 읽혀 빈 값이 될 수 있음 | 수정 전 값 = `change_items.original_value`(진단 시 실제로 읽은 필드). 빈 값이면 "기록 없음"으로 표시하고 빈 문자열로 위장하지 않는다 |
| 3 | 수정 후 값이 "보고서를 여는 순간의 활성 탭 DOM", URL 동일성 검사 없음 | 수정 후 값 = 서버가 공개 URL을 다시 받아 읽은 값(`verifyChangeItem` 재사용) + 확인 시각. 수정안 URL과 확인 URL이 다르면 보고서에 경고한다 |
| 4 | 도구 실행 상세(`detail`)가 빠지고 `durationMs`가 0 | 전달·확인 시도를 이력 테이블에 남긴다(HTTP 상태, 소요 시간, 오류 코드) |
| 5 | Markdown 생성자에 API 키·endpoint·호출 로그를 가진 bridge 객체 통째로 전달 | 보고서 입력은 허용 필드 목록(allowlist)으로 만든다. 비밀값은 보고서 모듈에 도달하지 않는다 |
| 6 | HTML 보고서 문자열을 `innerHTML`에 직접 삽입 | 화면은 React 렌더링만 쓴다. Markdown은 표·코드 문법을 이스케이프한다 |
| 7 | 단일 글 수정이 `seo_fix_all`(`dry_run:false`) 사이트 전체 수정으로 넓어질 수 있음 | WordPress 쓰기는 "승인된 수정안 1건 → 글 1개 → 필드 1개"만 허용한다. 대체 경로·일괄 수정은 없다 |
| 8 | AEO +8, GEO +10 같은 가산식 개선값 | 개선 수치는 재진단을 실제로 실행했을 때만, 두 진단 ID와 함께 표시한다 |
| 9 | 한국어 질문·정의 판별이 영어 정규식 | 보고서 문구는 한국어 기본. 진단 규칙의 한국어 처리 여부는 R01에서 점검만 한다(이번 범위에서 규칙 변경 없음) |

### 2.3 GEO_master에 이미 있는 것 (재사용)

| 기능 | 위치 | 보고서에서의 쓰임 |
|---|---|---|
| 진단 결과 JSON·CSV·PDF 내보내기 | `src/lib/reports.ts`, `src/lib/report-pdf.ts`, `src/app/api/reports/route.ts` | `format=md`를 추가할 자리 |
| 진단이 읽은 페이지 필드 | `audits.metadata.pageFields`, `src/lib/audit-changes.ts` | 수정 전 값의 출처 |
| 수정안 상태 기계 | `src/lib/change-items.ts` (draft → approved → delivered → verification_pending/verified/conflict/failed) | 수정 결과 보고서의 뼈대 |
| 공개 URL 재수집·필드 비교 | `verifyChangeItem`, `src/lib/page-fields.ts` | 수정 후 값의 출처 |
| 결정적 진단 규칙과 버전 | `src/lib/page-snapshots.ts` (technical/recommendation/hypothesis) | 보고서에 규칙 버전·등급 표시 |
| 비밀값 암호화 | `src/lib/crypto.ts` | WordPress 애플리케이션 비밀번호 저장 |
| SSRF 방지 요청 | `src/lib/url-security.ts` (`assertPublicUrl`, `fetchPublicText`) | WordPress 사이트 주소 검증 |
| 수동 적용 안내 | `src/lib/integrations/qshop-manual.ts` | 전달 방식별 안내 문구 패턴 |

### 2.4 현재 코드의 빈칸

- WordPress 연동 코드가 전혀 없다(`grep wordpress|wp-json` 결과 없음).
- `verifyChangeItem`은 확인 결과(`check`)를 응답으로만 돌려주고 **저장하지 않는다.** 보고서가 "언제, 무엇을 보고 verified로 판정했는지"를 보여 주려면 이력 저장이 먼저 필요하다.
- `deliverSchema`는 `manual`만 허용한다.

## 3. 범위

### 포함

1. GEO 진단 Markdown 보고서 (`/api/reports?type=audit&format=md`)
2. 수정 결과 보고서: 화면 + Markdown + JSON. 전달 방식과 무관하게 동작(수동 적용도 대상)
3. WordPress 읽기 연결: 연결 확인, URL → 글 ID 찾기, 저장된 값 읽기
4. WordPress 쓰기: **WordPress 코어 REST API로 확실히 쓸 수 있는 필드만**, 수정안 1건 단위, 미리보기 후 실행

### 제외 (이번 계획에서 하지 않음)

- RankSEO 호출 계약(`RankSEOMarkdownReport`, `renderHtml()` 등) 호환
- 사이트 전체 일괄 수정, 자동 수정(승인 없는 쓰기)
- MCP 서버 연동 (WordPress 코어 REST가 먼저. MCP는 별도 결정)
- SEO 플러그인(Yoast·Rank Math·AIOSEO) 메타 쓰기: R06 실측 결과가 나온 뒤 별도 승인
- 진단 규칙 자체의 변경, 점수 공식 변경

## 4. 보고서 A — GEO 진단 Markdown 보고서

### 4.1 입력

- `audits` 1건 (기존 `buildAuditReport` 결과)
- 같은 프로젝트·같은 URL의 최신 `page_snapshots` 1건이 있으면 규칙 등급과 관측값을 함께 표시
- 해당 진단에서 만든 `change_items` 목록과 상태 (있을 때만)

### 4.2 문서 구성 (고정 순서)

1. 머리말: URL, 최종 URL, 진단 ID, 진단 시각, 보고서 생성 시각, 규칙 버전
2. 요약: 점수·등급, 카테고리별 통과 수 (표)
3. 기술 오류(technical) → 페이지 권고(recommendation) → GEO 가설(hypothesis) 순서로 실패 항목. 항목마다 코드, 관측값, 권고
4. 통과 항목 (접기 없이 짧은 표)
5. 연결된 수정안과 현재 상태 (있을 때)
6. 측정하지 않은 것: 수동 확인 항목, 원본 HTML이 없어 판정하지 않은 항목을 명시
7. AI에게 넘기는 작업 요청: 실패 항목만 모은 짧은 체크리스트. 사실·수치를 새로 만들지 말라는 제약 문구 포함
8. 방법과 한계: 규칙 기반 진단이며 AI 인용 측정이 아님을 명시

### 4.3 규칙

- 출력 결정성: `generatedAt` 외에는 같은 입력이면 같은 바이트. 스냅샷 테스트로 고정한다.
- 이스케이프: 표 셀의 `|`, 줄바꿈, 백틱, `<`를 처리한다. 페이지에서 온 문자열은 모두 신뢰하지 않는 입력으로 다룬다.
- 길이 제한: 관측값은 항목당 500자, 본문 원문은 넣지 않는다.
- 비밀값: 설정·키·WordPress 연결 정보는 입력 타입에 존재하지 않는다(타입 수준에서 차단).
- 파일: `geo-audit-{id}-{YYYY-MM-DD}.md`, `text/markdown; charset=utf-8`, BOM 없음, 기존 라우트와 같은 보안 헤더.

## 5. 보고서 B — 수정 결과 보고서

### 5.1 핵심 개념: 값 세 개와 증거 두 개

| 칸 | 출처 | 비고 |
|---|---|---|
| 원래 값 | `change_items.original_value` | 진단 당시 실제로 읽은 값 |
| 제안 값 | `change_items.proposed_value` | 승인된 값 |
| WordPress 저장값 | WordPress REST 재조회 (연결된 경우만) | "DB에 들어갔는가" |
| 공개 페이지 값 | 공개 URL 재수집 (`verifyChangeItem`) | "방문자·검색봇에게 보이는가" |

저장값과 공개값을 나눠 보여 주면 "WordPress에는 들어갔지만 캐시 때문에 아직 안 보인다" 같은 상태를 구분할 수 있다. RankSEO는 이 둘을 구분하지 못한다.

### 5.2 보고서 범위와 구성

- 범위: URL 1개 기준(그 URL의 모든 수정안) 또는 선택한 수정안 ID 목록
- KPI: 전체 수, verified, 확인 대기, conflict, failed
- 항목별 표: 필드, 원래 값 → 제안 값, 저장값, 공개값, 상태, 마지막 확인 시각, HTTP 상태
- 조치 필요 목록: conflict(원본이 바뀜), failed(4xx/5xx), 대기 중(캐시 가능성)
- 재진단 비교: 수정 이후 같은 URL의 진단이 실제로 있을 때만 "진단 #A 점수 → 진단 #B 점수"
- 전달·확인 이력: 시각, 방식(manual/wordpress), 결과, 소요 시간
- 형식: 화면(`/changes/report`), `.md`, `.json`

## 6. WordPress 연동

### 6.1 연결 방식

WordPress 코어 REST API + 애플리케이션 비밀번호(WordPress 5.6 이상 코어 기능, HTTPS 필수)를 사용한다. 사용자의 MCP endpoint에 의존하는 RankSEO 방식은 쓰지 않는다.

- 저장: 사이트 주소, 사용자명, 애플리케이션 비밀번호(`crypto.ts`로 암호화). 프로젝트당 1개.
- 사이트 주소는 `assertPublicUrl`로 검증하고 https만 허용한다.
- 연결 확인: `/wp-json/` 응답과 인증된 `users/me` 요청으로 권한을 확인한다. 결과(WordPress 버전 정보 노출 여부, 감지된 SEO 플러그인)는 연결 정보에 기록한다.

### 6.2 필드 매핑 (R06에서 실제 사이트로 확인 후 확정)

GEO_master의 `title`은 HTML `<title>`이고, WordPress 글 제목과 다를 수 있다(SEO 플러그인이 제목 템플릿을 쓰는 경우). 그래서 매핑을 추측하지 않고 상태를 셋으로 나눈다.

| GEO_master 필드 | 1차 판단 | 쓰기 허용 조건 |
|---|---|---|
| `body` | 코어 `content` | R06 확인 후 |
| `title` | SEO 플러그인이 없으면 코어 `title`이 `<title>`에 반영될 가능성 | R06에서 공개 페이지 반영이 확인된 구성만 |
| `description`, `canonical`, `robots_meta`, `og_image` | SEO 플러그인 메타. 코어 REST로는 기본 노출되지 않는 것으로 알고 있음 (미확인) | 이번 범위에서는 수동 적용 안내만 |
| `json_ld` | 테마·플러그인 의존 | 수동 적용 안내만 |

모든 경우에 공개 URL 재수집 비교가 최종 판정이다. 쓰기 성공 응답만으로 verified 처리하지 않는다.

### 6.3 쓰기 안전장치

- 승인된(`approved`) 수정안만, 1건씩 실행
- 실행 직전에 WordPress 현재 저장값을 읽어 원래 값 해시와 비교. 다르면 쓰지 않고 `conflict`
- 미리보기(어떤 글 ID의 어떤 필드를 무엇으로 바꾸는지)를 보여 주고 사용자 확인 후 실행
- 글 ID는 URL로부터 찾되, 후보가 1개가 아니면 실행하지 않음
- 요청 본문에는 대상 필드 하나만 넣는다
- 실행 기록에 WordPress 응답의 수정 시각을 남겨 되돌리기 안내에 쓴다(자동 되돌리기는 이번 범위 밖)

## 7. 데이터 모델 변경 (마이그레이션 28~30)

| 버전 | 이름 | 내용 |
|---|---|---|
| 28 | `change-verifications` | `change_verifications(id, change_item_id FK, source 'public'|'wordpress', checked_at, http_status, matched, actual_excerpt(≤500자), checked_url)` |
| 29 | `change-deliveries` | `change_deliveries(id, change_item_id FK, method 'manual'|'wordpress', target_json, started_at, finished_at, duration_ms, result 'ok'|'conflict'|'error', http_status, error_code, remote_modified_at)` |
| 30 | `wordpress-connections` | `wordpress_connections(project_id PK FK, site_url, username, password_encrypted, seo_plugin, verified_at, created_at, updated_at)` |

`change_items` 테이블 구조는 바꾸지 않는다. `deliverSchema`의 enum에 `wordpress`를 더한다. 기존 데이터는 이력 없이 그대로 동작한다(보고서에 "이력 없음"으로 표시).

## 8. 작업 티켓

HARD-GATE 대상(3개 이상 파일, DB 스키마 변경)이므로 승인 후 시작한다. 새 브랜치는 `feat/geo-master-app`에서 분기한다.

| ID | 우선 | 작업 | 완료 기준 (테스트로 증명) |
|---|---|---|---|
| R00 | P0 | 기준선 확인 | `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` 결과를 기록 |
| R01 | P0 | 진단 Markdown 생성 모듈 `src/lib/report-markdown.ts` | 스냅샷 테스트 고정, 이스케이프 테스트(`|`, 백틱, `<script>`), 빈 진단·수동 항목·원본 HTML 없음 케이스 |
| R02 | P0 | `/api/reports?format=md` + 리포트 화면 버튼 | 라우트 통합 테스트(헤더·파일명·404·409), 기존 json/csv/pdf 회귀 없음 |
| R03 | P0 | 확인 이력 저장 (마이그레이션 28) | `verifyChangeItem` 호출마다 이력 1행, 네트워크 오류도 기록, 기존 상태 전이 테스트 통과 |
| R04 | P0 | 수정 결과 보고서 모델 `src/lib/change-report.ts` + Markdown/JSON | 원래 값 없음·URL 불일치·conflict·failed·재진단 없음 케이스. 비밀값이 출력에 없음을 검사하는 테스트 |
| R05 | P1 | 수정 결과 보고서 화면 `/changes/report` | 컴포넌트 테스트, `dangerouslySetInnerHTML` 미사용 확인, 375px 폭 레이아웃 |
| R06 | P1 | WordPress 실측 스파이크 (로컬 WordPress, 플러그인 없음/Yoast/Rank Math 3구성) | 필드별 "코어 REST로 쓰기 → 공개 페이지 반영" 결과표를 `docs/planning/`에 기록. 이 결과로 6.2 표 확정 |
| R07 | P1 | WordPress 연결·읽기 (마이그레이션 30) | 비밀번호 암호화 저장·평문 미노출, http·사설 IP 거부, 401/403/404 구분, 글 ID 후보 0/1/여러 개 케이스 |
| R08 | P1 | WordPress 쓰기 전달 (마이그레이션 29) | 승인 안 된 항목 거부, 저장값 불일치 시 conflict, 요청 본문 필드 1개, 일괄 엔드포인트 없음, 성공 응답만으로 verified 안 됨 |
| R09 | P2 | 보고서 B에 WordPress 저장값 칸 연결 | 저장값=제안값·공개값≠제안값 → "반영 대기(캐시 가능성)" 표시 |
| R10 | P2 | 수정 결과 보고서 PDF (기존 `report-pdf.ts` 재사용) | 기존 PDF 테스트 패턴 |

R00~R05만으로 "두 보고서가 제대로 나온다"는 차별점은 완성된다. WordPress는 R06 결과를 보고 쓰기 범위를 확정한다.

## 9. 검증 방식

- 단위·통합: vitest. 신규 모듈 커버리지 80% 이상.
- 보안: 보고서 출력 전체에 대해 설정 키·애플리케이션 비밀번호·endpoint 문자열이 없는지 검사하는 테스트.
- 실제 동작: 개발 서버에서 진단 1건 → `.md` 다운로드 → 내용 확인. 수정안 1건 → 수동 전달 → 반영 확인 → 보고서 화면 확인.
- WordPress: 로컬 WordPress(R06)에서만 쓰기 테스트. 운영 사이트에는 쓰지 않는다.

## 10. 위험과 대응

| 위험 | 대응 |
|---|---|
| SEO 플러그인 메타를 코어 REST로 못 쓸 가능성이 높음 | 이번 범위는 수동 안내. R06 결과로 별도 결정 |
| 캐시·CDN 때문에 공개값 반영이 늦음 | 저장값/공개값 분리 표시, `verification_pending` 유지 |
| 진단 당시 `pageFields`가 없는 옛 진단 | 보고서에 "필드 기록 없음, 다시 진단 필요" 표시 (기존 `AUDIT_FIELDS_MISSING`과 같은 정책) |
| 보고서가 길어짐 | 관측값 500자 제한, 본문 원문 제외 |

## 11. 승인 시 결정할 것

1. 첫 출시 범위: R00~R05(보고서 두 개, WordPress 없음)로 먼저 낼지, R08(WordPress 쓰기)까지 묶을지
2. WordPress 연결 방식: 코어 REST + 애플리케이션 비밀번호(이 계획의 기본값)로 확정할지
3. "AI에게 넘기는 작업 요청" 절(4.2-7)을 Markdown 보고서에 넣을지
