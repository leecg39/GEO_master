[C2C]
STATE: PLAN
TASK_ID: c2c_9a30
ITERATION: 0
NEXT_EXPECTED_STEP: EXECUTED

WORKSPACE:

GEO Master · jiaolong

branch: leecg39/feat-settings-research-assist

commit: 948cd04

working tree: dirty, staged 없음. 기존 Qshop 관련 수정·untracked 파일을 보존해야 함.

최근 Codex test record는 없음.

src/lib/seo는 현재 존재하지 않음(FILE_NOT_FOUND 확인).

OBSERVED_EXISTING:

CS01은 사실상 완료: vendor/claude-seo/LICENSE, UPSTREAM.md, manifest.json, selected technical/schema/drift 자료가 있으며 upstream a1480c7... 고정, FLOW 제외가 기록돼 있음.

1차 PR의 수집 기반도 상당 부분 완료:

src/lib/semforge/siteaudit/index.ts: Firecrawl Map과 실제 HTML fetch 분리.

발견 URL은 fetch_state='discovered', HTTP 값은 실제 수집 전 null.

실제 수집 성공/실패/partial을 구분하고 mock을 실측으로 표시하지 않음.

legacy_estimate를 현행 실측 점수·페이지와 분리.

동일 request id 멱등성, Firecrawl 예산, stale run 보호가 있음.

src/lib/site-ops/snapshots.ts:

page_snapshots에 final URL, HTTP status, content type, raw HTML, markdown, body/content/revision hash, parser version, 오류 상태를 보존.

네트워크 실패에는 metadata/rules가 없어 제목 누락 같은 확정 판정을 만들지 않는 구조.

구조화 데이터 보호도 이미 존재:

structured-data.ts가 JSON 문법, @graph, ID 중복, 공개 본문 근거, 가격·평점·재고·author 등의 추측 생성을 차단.

봇 목적 구분도 존재:

bot-policy.ts에서 OAI-SearchBot=search, GPTBot=training 분리.

tests/observation.test.ts fixture 존재.

2차 PR 기반도 일부 완료:

change_sets/change_items, approve → deliver → verify 상태 머신 존재.

승인/전달 직전 재수집으로 원본 변경 conflict 탐지.

verify 시 승인 대상 필드와 비대상 필드의 예상 밖 변경을 구분.

JSON-LD 비교는 key order를 안정화해 비교.

전달만으로 verified가 되지 않음.

MISSING_STAGE_1:
현재 가장 큰 공백은 버전 있는 공통 Finding 계층이다. 현행 PageRule과 /audit의 AuditItemResult는 passed:boolean이라 unknown/not_applicable, 판정 방식, evidence reference를 표현하지 못한다.

EXECUTION_SCOPE_THIS_ITERATION:
Stage 1만 구현한다. 기존 수집/Qshop 작업을 다시 작성하지 않는다.

FILES_AND_CHANGES:

src/lib/seo/contracts.ts 신규

SeoFinding 계약 추가:
pass | fail | unknown | not_applicable

ruleId, ruleVersion, analyzerVersion, method, severity,
snapshotId, sourceUrl, evidenceRefs, explanation,
optional proposedAction, verificationSpec, falsificationCheck.

내부 자유형 chain-of-thought는 저장하지 말고 검토 가능한 결과만 표현.

src/lib/seo/registry.ts 신규

실행 가능한 analyzer를 명시적 allowlist로 제한.

첫 단계는 technical, schema만 허용.

동적 스킬 실행, Python, shell, 외부 SKILL 실행 기능은 만들지 말 것.

src/lib/seo/rules/technical.ts 신규

기존 PageSnapshot.rules/metadata를 재사용하는 adapter로 구현해 parser 로직을 복제하지 말 것.

fetched HTML에서만 title 등 확정 pass/fail 생성.

수집 실패 시 title=fail 같은 결과를 만들지 말고 collection 상태를 unknown으로 표현.

GPTBot/OAI 정책 판단은 기존 bot-policy.ts 재사용.

src/lib/seo/rules/schema.ts 신규

기존 schemaEntities, metadata, jsonLdErrors를 이용한 작은 결정적 검사만 구현.

우선 JSON-LD 문법과 명백한 동일 @id 중복 정도로 제한.

“스키마가 없으면 무조건 실패”, “Product에 FAQ 필수” 같은 규칙은 추가하지 말 것.

편집 시 사실성 검증은 기존 structured-data.ts가 담당하므로 중복 구현하지 말 것.

src/lib/seo/run-analysis.ts 신규

이미 수집된 하나의 PageSnapshot을 technical/schema analyzer가 공유하게 함.

analyzer가 네트워크를 다시 요청하지 않게 할 것.

동일 snapshot + analyzer version + config에서 결정적 결과를 반환.

enabled analyzer/version을 포함한 안정적인 configHash 또는 동등한 실행 식별자를 제공.

src/lib/semforge/siteaudit/index.ts 최소 수정

persistSnapshot() 이후 새 runner를 호출.

기술 점수는 pass/fail로 판정 가능한 finding만 분모에 포함하고 unknown/NA는 제외.

fail만 기존 site_audit_issues로 투영하고, unknown을 failure로 저장하지 말 것.

overview에서 snapshot별 Finding을 검토 가능하게 노출하되 기존 응답 필드는 깨지지 않게 additive하게 추가.

기존 Map/native fetch, budget/idempotency/Qshop 흐름은 유지.

DO_NOT_TOUCH_STAGE_1:

vendor/claude-seo 재다운로드/재설치 금지.

src/lib/audit.ts의 기존 GEO 진단 전체 재작성 금지.

기존 v13 site-ops-migration.ts를 갈아엎지 말 것.

새 crawler DB, Python worker, shell runner, CMS 자동 게시, GSC/PSI 추가 금지.

현재 dirty Qshop 파일을 정리하거나 reset/checkout하지 말 것.

STAGE_1_TESTS:

신규 tests/seo-analysis.test.ts 권장:

failed snapshot → 제목 누락 fail이 생기지 않고 collection unknown.

동일 snapshot 두 번 분석 → 동일 Finding 결과.

모든 확정 Finding에 snapshot evidence + rule/analyzer version 존재.

Product라고 FAQ 부재를 공통 실패로 만들지 않음.

schema JSON 파싱 오류는 근거 있는 fail.

기존 회귀:

tests/site-ops.integration.test.ts

tests/observation.test.ts

tests/site-ops-migration.test.ts

이후 전체:

npm test

npm run typecheck

npm run lint

npm run build

STAGE_1_SUCCESS_CRITERIA:

Firecrawl Map에 나온 URL을 실제 fetch 전 HTTP 200으로 표시하지 않는다.

실패/취소 수집에서 SEO 결함을 날조하지 않는다.

같은 스냅샷을 technical/schema가 재사용하며 추가 fetch가 없다.

unknown/not_applicable이 pass/fail로 강제 변환되지 않는다.

점수는 관측 가능한 deterministic technical findings만 사용한다.

기존 Qshop approve/deliver/verify 및 프로젝트 격리 테스트가 그대로 통과한다.

SECOND_STAGE_AFTER_REVIEW:

src/lib/seo/drift.ts 신규

현재 site-ops/index.ts 안에 박혀 있는 비교 로직을 순수 comparator로 추출.

baseline/current snapshot + approved change items 입력.

각 변경을 expected / unexpected / unchanged 수준으로 명시.

title/canonical/robots/noindex/schema 의미 변경을 버전 있는 이벤트로 반환.

JSON-LD는 stableJson/schemaEntities를 재사용해 key-order 변화는 무시.

DB는 별도 후속 migration으로 추가.

v13 Qshop migration은 수정하지 말고 새 migration 버전을 사용.

seo_drift_events에 project/campaign/change_set, baseline/current snapshot, field, before/after, expected 여부, rule version 저장.

현 단계에서는 별도 seo_baselines 테이블을 만들 필요가 낮음. change_sets.snapshot_id + approved_at가 승인 baseline 역할을 이미 수행하므로 먼저 재사용.

src/lib/site-ops/index.ts

approve/deliver/verify 상태 머신은 유지.

verify의 inline diff를 새 comparator 호출로 교체하고 이벤트를 영속화.

자동 baseline 승격 금지.

새 재수집 전 verified 금지.

STAGE_2_SUCCESS_CRITERIA:

승인한 title 변경은 expected로 확인되면서 동시에 추가된 noindex는 unexpected conflict로 탐지.

JSON-LD key 순서만 바뀌면 drift event를 만들지 않음.

canonical의 예상 밖 변경/삭제가 별도 이벤트로 남음.

/a와 /a/를 임의로 같은 baseline으로 합치지 않음.

verify fetch 실패는 failed/unknown이며 정상 baseline으로 승격되지 않음.

프로젝트 A의 baseline/event/change가 B에서 조회되지 않음.

RISK_CHECKS:

현재 관련 구현 대부분이 uncommitted Qshop 작업이다. “없다고 가정하고 새 구현”하면 중복 DB/API가 생긴다.

PageRule.passed:boolean을 즉시 전역 변경하면 /audit, UI, 저장 데이터까지 파급된다. 이번 Stage 1에서는 adapter 방식으로 새 Finding 계약을 도입하고 기존 계약은 호환 유지하는 것이 안전하다.

audit_items의 status/evidence 확장은 이후 /audit 통합 시 별도 호환 migration으로 처리한다. 이번 Stage 1에서 dirty audit.ts까지 넓히지 않는다.

Codex는 위 Stage 1 범위만 실행하고, 변경 파일·테스트 결과·미검증 사항을 EXECUTED로 보고해야 한다. 이후 diff를 독립 검토한 다음 Stage 2 진행 여부를 판단한다.
