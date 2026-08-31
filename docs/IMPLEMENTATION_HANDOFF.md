# GEO Master 구현 핸드오프

기준 시각: 2026-09-01 (Asia/Seoul)

## 저장소

- 로컬: `/Users/user01/Desktop/GEO_master`
- 원격: `https://github.com/leecg39/GEO_master.git`
- 작업 브랜치: `feat/geo-master-app`
- PDF 확장 시작 기준 커밋: `b0a4e1c243a811e791b210456dfaa7caf18f3fa1` (`feat: add scheduled measurement automation`)
- 이 문서는 핵심 앱, llms.txt, 전용 PDF 리포트, 멀티모달, HyperCLOVA X, 팀 공유와 예약 측정 자동화까지 포함한 전달 상태를 설명한다.

## 완료 범위

원 계획 1~9단계와 승격된 선택 확장을 구현했다.

1. OCR 294장은 영구 삭제하지 않고 `/Users/user01/.Trash/GEO_master_ocr_20260901-024648`로 이동
2. Next.js App Router, 반응형 다크 UI, 12개 화면
3. SQLite/Drizzle 14개 테이블, 콜드스타트 자동 생성, HMR 싱글턴, 비파괴 열 마이그레이션
4. AES-256-GCM 설정과 OpenAI/Anthropic/Gemini/HyperCLOVA X 공통 클라이언트
5. 32항목 GEO 진단과 SSRF/DNS rebinding 방어
6. 즉시·예약 응답 점유율, 경쟁사·문맥·GenRank·퍼널 측정
7. Recharts 대시보드와 4개 모델 원자료 가중 월간 집계
8. 콘텐츠 스튜디오 4도구, 전략 CRUD, 4주 사이클
9. 학습 콘텐츠와 SQLite 영속 38항목 체크리스트

## 후속 확장 완료

- **llms.txt**: `/llms` 공식 제안형 생성·편집·검증·다운로드, 자격증명 URL 차단, escaped 라벨 라운드트립, 원격 MIME/배포 확인
- **리포트**: `/reports`, `/api/reports`의 선택형 진단·점유율 미리보기, JSON/UTF-8 BOM CSV와 전용 서버 PDF 1.7 attachment, 수식·PDF 연산자 주입 방어, 보조 인쇄 CSS
- **멀티모달 감사**: `/multimodal`에서 최대 10개 공개 URL의 src/srcset·alt·파일명·차트 수치/텍스트와 영상 title·자막·챕터·대본 신호 분석
- **HyperCLOVA X**: 공식 `clovastudio.stream.ntruss.com/v3` 단일 Bearer 계약, HCX-DASH-002 기본 모델, 설정 암호화·점유율·스튜디오·대시보드 통합
- **팀 공유**: `/workspace` schema v1 JSON, 비밀 열 구조적 제외, 25MB 스트리밍 상한, merge ID/FK 재매핑, 확인형 replace, 키 보존과 원자적 롤백
- **예약 측정**: `/automation`, `/api/automation`의 일정 CRUD, SQLite 영속 큐, 비용 한도·경고, 취소·재시도와 worker 상태 표시

## 전용 PDF 리포트 계약

- `src/lib/report-pdf.ts`는 외부 PDF dependency 없이 PDF 1.7 object/page tree/content stream/xref/trailer를 생성한다. A4 자동 페이지 나눔과 진단 점수·카테고리·개선 항목, 점유율·GenRank·모델·경쟁사·질문 근거 템플릿을 제공한다.
- 한국어는 Type0 `/HYSMyeongJo-Medium` + `/UniKS-UTF16-H` + Adobe-Korea1 CID font로 출력한다. DB·사용자 문자열은 NFC 정규화와 제어문자 제거 후 UTF-16BE hex `<...> Tj`로만 기록해 literal PDF operator/stream 주입을 차단한다.
- CID font는 비임베드이므로 CJK font 지원 viewer가 필요하다. Korea1 밖 보조평면 문자는 무음 누락 대신 `?`로 결정적으로 치환한다. Latin과 한글 모두 `/DW 1000`의 1em advance를 보수적으로 계산해 혼합 문장 우측 잘림을 막는다.
- 문서는 최대 200페이지·12MB다. PDF route는 점유율 근거를 최대 1,000건만 materialize하고 생략 수를 문서에 표시한다. JSON/CSV route는 기존처럼 전량을 유지한다.
- PDF·JSON·CSV와 오류 응답은 `no-store`, `nosniff`를 사용한다. attachment 파일명은 ASCII이며, 완료되지 않은 점유율 run은 409로 차단한다. 브라우저 인쇄는 보조 경로다.

## 예약 자동화 계약

### 영속 상태와 실행

- `measurement_schedules`: 이름, 질문, provider, 반복 수, 간격, UTC 다음 실행, 활성 상태와 마지막 오류 코드
- `measurement_jobs`: share 입력만 담은 payload, due slot 멱등키, 상태, lease/worker, run 연결, 비용 예약·정산과 안정적 오류 코드
- `automation_policy`: 월 한도, 건별 한도, 양수 provider별 호출 추정 단가, 알림 임계값
- 일정 slot은 `schedule:{id}:{nextRunAt}` UNIQUE 키로 한 번만 생성하고, 장기 중단 뒤 누락 실행은 한 건으로 합친 다음 첫 미래 slot으로 이동한다.
- claim은 조건부 `UPDATE … WHERE status='queued' … RETURNING`이며 프로세스 내 worker/API는 `globalThis` 잠금을 공유한다. DB 조건부 갱신이 여러 프로세스의 최종 중복 방지선이다.
- `src/instrumentation.ts`가 Node 서버에서 worker를 시작한다. `NODE_ENV=test`, `GEO_DISABLE_AUTOMATION_WORKER=1`, production build에서는 기동하지 않으며 읽기 전용 GET도 worker를 시작하지 않는다.
- 지원 운영 범위는 로컬 단일 서버다. 다중 서버에서도 double claim은 막지만 전용 분산 scheduler·advisory lock 운영은 별도 범위다.

### 비용·실패 처리

- 비용 정책의 월/건별 한도가 0이면 자동화 작업은 API 호출 전에 `COST_POLICY_DISABLED`로 차단된다.
- enqueue 시 질문 × provider × 반복 × 최대 2회(응답+문맥 분류)의 보수적 상한을 `IMMEDIATE` transaction에서 예약한다.
- 작업 생성 당시 provider 단가를 job에 고정하고, 완료·실패·실행 중 취소 뒤에는 실제 시작한 호출 횟수 × 해당 단가만 월 계상액으로 남긴다. 제공자 실제 청구액·토큰 usage가 아니라 사용자 조정 추정치다.
- queued 취소는 예약액 전부를 즉시 해제한다. running 취소는 호출 사이와 결과 커밋 직전에 협조적으로 확인하고 이미 시작한 호출만 정산한다.
- stale lease는 자동 재실행하지 않고 `STALE_LEASE` 실패로 격리하며 orphan `measure_run`도 마감한다. 늦게 끝난 원 worker가 실제 completed run을 커밋하면 worker 소유권 CAS 실패를 감지해 job을 completed로 재조정한다.
- 실패·차단·취소 작업은 사용자가 명시적으로 재시도할 때 새 job과 새 예산을 예약한다. 에러 메시지·업스트림 본문 대신 코드만 DB에 저장한다.
- 스케줄 job reserve와 `next_run_at` 갱신은 같은 `IMMEDIATE` transaction이다. 손상 schedule은 `INVALID_SCHEDULE_DATA`로 안전 정지하고, 일시 enqueue 실패는 오류를 표시한 채 다음 tick에 재시도한다.

### 데이터 경계

- job payload에는 `questions`, `providers`, `repetitions`만 저장하며 API 키, 암호문, LLM 응답 원문을 넣지 않는다.
- schema v1 팀 스냅샷은 자동화 일정·작업·비용 정책을 제외한다. 가져온 파일이 대상 기기에서 유료 예약을 자동 활성화하지 않게 하는 의도적 경계다.
- 기존 `runShareMeasurement`의 완료 시 `measure_results`+요약 단일 transaction 불변식은 유지하며 큐는 실행 ID·취소·호출 시작 콜백만 주입한다.

## 적대적 검토에서 수정한 사항

기존 검토 수정:

- 검증된 IP를 Node `http/https` lookup에 고정하고 리다이렉트마다 재검증해 DNS TOCTOU 제거
- dev/start `127.0.0.1` 고정, cross-site 변경 403, non-JSON 변경 415
- 손상된 무관 제공자 키 지연 복호화, 측정 완료 원자 저장, 원자료 가중 월간 집계
- 멀티모달 개수·MIME·임베드 경계, 리포트 CSV 수식 방어·완료 run 제한, 스냅샷 strict 검증·롤백
- HyperCLOVA X 고정 공식 origin, 모델 경로 인코딩, timeout과 업스트림 본문 비노출

예약 자동화 독립 감사 수정:

- 실패·running 취소가 최대 예약액을 영구 점유하던 P1을 호출 시작 횟수 기반 종료 정산으로 변경
- provider 단가 0 설정에 의한 비용 게이트 무력화를 strict positive 스키마로 차단
- API 수동 처리와 background tick이 같은 process lock을 공유하도록 직렬화
- worker 소유권 CAS와 stale 이후 late-success 재조정으로 job/run 상태 불일치 방지
- due job reserve와 next slot 이동을 동일 `IMMEDIATE` transaction으로 결합
- 손상 schedule/policy JSON을 상태 전체 500 대신 오류 코드·안전 기본값으로 격리
- 기존 자동화 테이블에 정산 열을 데이터 보존 `ALTER TABLE`로 추가
- build와 읽기 전용 GET에서 worker가 유료 호출을 시작하지 않도록 차단
- 두 독립 감사 후 별도 fix verifier가 8개 불변식 PASS와 신규 P0 부재를 확인

전용 PDF 독립 감사 수정:

- `/DW 1000` 고정폭을 Latin·한글 모두 1em으로 계산하고 혼합 요약의 실제 text command 줄바꿈을 회귀 테스트로 고정
- JSON/CSV/PDF와 report 오류 응답에 `no-store`·`nosniff`를 일관 적용하고 409/422/404 route 계약을 추가
- 선택 ID가 남아도 report load가 실패하면 세 다운로드를 실제 disabled button으로 전환
- PDF route에 1,000개 결과 조회 상한과 생략 고지를 추가하되 JSON/CSV 전량 동작은 유지
- Korea1 밖 보조평면 문자와 lone surrogate를 `?`로 결정 치환하고 처리 문자열 길이를 선제 제한
- 0분모 progress, grade 기반 강조색과 하드코딩 `/32` 이력 라벨 drift를 제거
- 세 관점의 독립 적대적 감사 뒤 별도 fix verifier가 F1~F6, xref·주입·페이지 상한·미완료 run 차단을 모두 PASS하고 P0/P1 부재를 확인

## 검증 증거

- `npm test`: 20 files / 103 tests passed
- `npm run typecheck`: passed
- `npm run lint`: 0 errors, 0 warnings
- `npm run build`: passed; 12 UI routes, 13 API routes, Proxy 생성
- `npm run test:coverage`: statements 79.97%, branches 69.12%, functions 85.97%, lines 82.40%
- 자동화 테스트: 비용 상한·종료 정산, 0단가 거부, budget TOCTOU transaction, slot 멱등/coalescing, double claim, stale/orphan 격리·late success, 취소·재시도, 공유 잠금, 손상 상태, 비파괴 마이그레이션, payload 비밀 부재
- 격리 API: `$0.02` 상한 예약 작업이 API 키 선차단으로 호출 0회 실패한 뒤 incurred/used/reserved/consumed 모두 `$0`, DB에는 안정적 `API_KEY_REQUIRED`만 저장
- ego-browser: `/automation` 전역 메뉴, 정책·큐 상태, 예약 수정 왕복과 live status, 종료 정산/상한 표시, aria progress/busy, 375px 무가로넘침·오류 alert 부재
- 리포트 Chromium QA: audit/share PDF href가 선택 ID와 일치하고 desktop·375px에서 무가로넘침, 빈 이력과 삭제 후 404에서 JSON/CSV/PDF/인쇄 4개 disabled·download anchor 0개
- PDF API/파일 QA: 실제 Korean fixture PDF의 `%PDF-1.7`, xref, `/UniKS-UTF16-H`, ASCII attachment, `no-store`, `nosniff`; macOS `file` 인식과 `sips` Quartz 595×842 PNG 렌더, 혼합 요약 2개 text command 확인
- 기존 프로덕션 QA: example.com 진단, W3C+example.com 멀티모달, 스냅샷 attachment, HyperCLOVA mock·DB 마이그레이션, 스냅샷 merge/replace·키 보존

## 로컬 실행 데이터

`data/geo.db*`와 `data/.master-key`는 `.gitignore` 대상이며 커밋하지 않는다. 새 자동화 테이블도 같은 로컬 DB 안에 존재한다. 자동화 QA는 `/tmp/geo-automation-qa.db`·포트 3113, PDF QA는 `/tmp/geo-pdf-qa.db`·포트 3114와 빈 이력 포트 3115에서 격리 실행했으며 서버·DB·렌더 산출물·ego-browser task space는 최종 커밋 전에 정리한다.

## 다음 계획

원 계획과 llms.txt, 전용 PDF 리포트, 멀티모달, HyperCLOVA X, 팀 공유, 예약 측정·영속 큐·비용 한도까지 완료했다. 필수 잔여 항목은 없다.

선택적 발전이 필요하다면 별도 범위로 사용자 인증·권한 기반 실시간 공동 편집과 원격 동기화를 설계한다.

후속 변경에서도 공인 IP pin, API 키 비노출, 완료 측정 원자성, PDF hex text/xref·상한, queue claim/비용 정산, 스냅샷 키 보존·롤백을 회귀 테스트로 유지한다.
