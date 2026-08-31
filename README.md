# GEO Master

생성형 AI 답변에서 브랜드가 **발견되고, 올바른 맥락으로 이해되고, 최신 근거와 함께 추천되는 과정**을 관리하는 로컬 퍼스트 GEO 워크스페이스입니다. 「AEO·GEO 생존전략」과 「제로클릭 시대, GEO 대책」의 실행 프레임을 진단·측정·콘텐츠·전략 모듈로 구현했습니다.

## 주요 기능

| 모듈 | 기능 |
|---|---|
| 대시보드 | GEO 퍼널 4단계, 4개 모델별 월간 응답 점유율, GenRank, 최근 진단, 38항목 진행률, 4주 사이클 |
| GEO 진단 | URL·robots.txt·llms.txt·sitemap 수집, SEO/GEO/E-E-A-T/기술/브랜드 32항목 점검과 이력 |
| 멀티모달 감사 | 최대 10개 URL의 이미지 alt·파일명·차트 텍스트와 영상 자막·챕터·대본 신호 일괄 점검 |
| llms.txt | 공식 제안 형식 초안 생성, 편집, 구조 검증, 다운로드, 원격 `/llms.txt` 배포 확인 |
| 응답 점유율 | 브랜드 없는 질문 × GPT/Claude/Gemini/HyperCLOVA X × 반복 실행, 언급·순위·감정·경쟁사·GenRank 분석 |
| 예약 측정 | SQLite 영속 일정·작업 큐, 원자 claim, 취소·재시도, 월·건별 비용 한도와 호출 시도 기반 정산 |
| 리포트 | 진단·점유율 근거 미리보기, JSON/UTF-8 CSV 다운로드, 브라우저 인쇄·PDF 저장 |
| 콘텐츠 스튜디오 | 4개 LLM의 리라이팅 5패턴, 도입부 3단 공식, FAQ+FAQPage, 엔티티 정의+Organization JSON-LD |
| 전략 | 질문 매핑, Pillar–Cluster–Supporting 보드, 콘텐츠 캘린더, 4주 모니터링 사이클 CRUD |
| 학습 센터 | 핵심 개념, 7가지 도구, 6원칙, 패러다임 시프트, 용어 대조, 사례, 38항목 체크리스트 |
| 팀 공유 | 비밀을 제외한 schema v1 JSON 스냅샷, ID 재매핑 병합, 확인형 교체와 트랜잭션 롤백 |
| 설정 | 브랜드·경쟁사·모델·가중치·반복 수와 암호화된 4사 API 키 관리 |

## 시작하기

요구 사항: **Node.js 22 이상**, npm 10 이상

```bash
npm ci
cp .env.example .env.local   # 선택 사항
npm run dev
```

브라우저에서 `http://127.0.0.1:3000`을 엽니다. 개발/프로덕션 서버는 로컬 데이터 보호를 위해 `127.0.0.1`에만 바인딩됩니다.

```bash
npm run build
npm start
```

### 환경 변수

- `GEO_MASTER_KEY`: API 키 암호화에 사용할 32바이트 이상의 임의 문자열. 비워 두면 `data/.master-key`를 권한 `0600`으로 자동 생성합니다.
- `GEO_DB_PATH`: SQLite 파일 경로. 기본값은 `data/geo.db`입니다.
- `GEO_DISABLE_AUTOMATION_WORKER=1`: 유지보수·격리 검증 중 예약 worker 자동 기동을 막습니다. 수동 큐 처리 API는 별도입니다.

`.env*`, SQLite DB/WAL, 자동 마스터 키는 Git에서 제외됩니다.

## 권장 사용 순서

1. `/settings`에서 브랜드, 카테고리, 경쟁사와 사용할 LLM 키를 저장합니다.
2. `/audit`에서 공식 사이트를 진단하고 자동·수동 항목의 우선순위를 확인합니다.
3. `/multimodal`에서 핵심 페이지의 이미지·차트·영상 대체 정보를 일괄 점검합니다.
4. `/llms`에서 공식 사이트 안내 초안을 만들고 `/llms.txt` 배포 상태를 검증합니다.
5. `/share`에서 브랜드명이 없는 핵심 질문 20~30개를 여러 모델로 반복 측정합니다.
6. `/automation`에서 호출 추정 단가와 월·건별 한도를 먼저 저장한 뒤 측정 일정을 활성화합니다.
7. `/reports`에서 진단·점유율 근거를 JSON/CSV/PDF로 공유합니다.
8. `/strategy`와 `/studio`에서 우선 콘텐츠와 4주 개선 사이클을 운영합니다.
9. 매월 대시보드의 응답 점유율, GenRank와 퍼널 변화를 비교합니다.
10. `/workspace`에서 API 키가 제외된 JSON 스냅샷을 팀원 기기로 옮깁니다.

> LLM 측정과 콘텐츠 생성은 각 제공자의 유료 API를 호출할 수 있습니다. 예약 worker는 활성 일정과 비용 정책을 만족하면 사용자 입력 없이 호출하므로, `/automation`의 상한과 다음 실행 시각을 먼저 확인하세요.

## 보안 설계

- API 키는 AES-256-GCM으로 암호화하며 공개 설정 API에는 구성 여부와 끝 4자리 마스크만 반환합니다.
- 손상된 키는 해당 제공자 실행만 차단하고 다른 제공자 키는 독립적으로 복호화합니다.
- 진단 크롤러는 DNS의 모든 주소를 검사하고 선택한 공인 IP를 실제 Node HTTP(S) lookup에 고정합니다. 리다이렉트마다 다시 검증해 DNS rebinding을 차단합니다.
- http/https와 80/443만 허용하고 로컬·사설·예약 IP, URL 자격증명, 압축 응답, 2MB 초과 문서를 차단합니다.
- Next Proxy가 브라우저의 cross-site API 변경 요청을 403으로, JSON이 아닌 변경 요청을 415로 차단합니다.
- 측정 결과와 완료 요약은 하나의 SQLite 트랜잭션으로 저장되어 중간 실패 시 부분 결과가 남지 않습니다.
- 예약 payload에는 질문·provider·반복 수만 저장하며 API 키·응답 원문은 넣지 않습니다. due slot UNIQUE 멱등키와 조건부 `UPDATE … RETURNING` claim으로 중복 실행을 막습니다.
- 자동화 비용 정책 기본값은 0달러로 비활성입니다. 대기·실행 중에는 문맥 분류를 포함한 최대 2배 호출 상한을 예약하고, 종료 뒤에는 실제 시작한 호출 횟수 × 작업 생성 당시 단가로 정산합니다.
- stale lease는 자동 재실행하지 않고 실패로 격리하며, 사용자가 명시적으로 재시도할 때 새 예산을 예약합니다. 빌드 및 읽기 전용 GET은 worker를 기동하지 않습니다.
- HyperCLOVA X는 네이버클라우드 공식 고정 origin과 v3 경로만 호출하며 Bearer 키·업스트림 오류 본문을 노출하지 않습니다.
- 워크스페이스 스냅샷은 API 키·암호문·마스터 키를 구조적으로 제외하고 25MB 상한, strict Zod 검증, ID 재매핑과 트랜잭션 롤백을 적용합니다. 자동 실행 오작동을 막기 위해 일정·큐·비용 정책은 schema v1 스냅샷에서 제외합니다.

## 데이터 구조

앱 최초 요청 때 SQLite 디렉터리와 14개 테이블을 자동 생성합니다.

- 설정/프로젝트: `settings`, `projects`
- 질문: `question_sets`, `questions`
- 측정: `measure_runs`, `measure_results`
- 예약 자동화: `measurement_schedules`, `measurement_jobs`, `automation_policy`
- 진단: `audits`, `audit_items`
- 콘텐츠/실행: `contents`, `checklist_states`, `strategy_items`

Next.js HMR에서도 DB 연결과 자동화 worker는 `globalThis` 캐시를 사용해 프로세스 내 중복을 피합니다. DB의 원자 claim이 여러 서버 프로세스 간 최종 안전망이며, 이 앱의 지원 운영 범위는 로컬 단일 서버입니다. `better-sqlite3`는 서버 외부 패키지로 번들링합니다.

## API

| 메서드 | 경로 | 용도 |
|---|---|---|
| GET | `/api/dashboard` | 통합 대시보드 집계 |
| GET/POST | `/api/audits` | 진단 이력/실행 |
| POST | `/api/llms` | llms.txt 생성·검증·원격 배포 확인 |
| POST | `/api/multimodal` | 공개 URL 이미지·차트·영상 일괄 감사 |
| GET | `/api/reports` | 진단·점유율 JSON/CSV attachment |
| GET/POST | `/api/workspace` | 스냅샷 현황·내보내기/가져오기 |
| GET/PUT | `/api/settings` | 공개 설정/저장 |
| GET | `/api/share` | 측정 이력·질문 템플릿 |
| POST | `/api/share/run` | 응답 점유율 즉시 실행 |
| GET/POST | `/api/automation` | 비용 정책·예약·영속 큐 조회 및 제어 |
| POST | `/api/studio` | 콘텐츠 도구 실행 |
| GET/POST/PATCH/DELETE | `/api/strategy` | 전략 CRUD |
| GET/PUT | `/api/checklist` | 38항목 상태 |

## 검증

```bash
npm test             # Vitest 단위·통합 테스트
npm run test:coverage
npm run typecheck
npm run lint
npm run build
```

현재 기준: **19개 테스트 파일, 93개 테스트 통과**, statements 76.92% / branches 67.22% / functions 83.55% / lines 79.06%, TypeScript·ESLint·Next 프로덕션 빌드 통과. 프로덕션 API, 공개 URL 진단·멀티모달 감사, 리포트/스냅샷 attachment, 자동화 비용·큐 상태 전이, 12개 화면과 375px 모바일 UI도 실제 브라우저로 검증했습니다.

## 기술 스택

Next.js 16 App Router · React 19 · TypeScript 6 · Tailwind CSS 4 · SQLite/better-sqlite3 · Drizzle ORM · OpenAI/Anthropic/Google GenAI SDK · NAVER Cloud HyperCLOVA X REST · Cheerio · Recharts · Vitest

## 로드맵 상태

핵심 계획과 후속 확장인 llms.txt, 리포트, 멀티모달 감사, HyperCLOVA X, 휴대 가능한 팀 공유 스냅샷, 예약 측정·영속 큐·비용 한도까지 완료되었습니다. 필수 잔여 범위는 없으며 이후 선택적 발전 항목은 사용자 인증 기반 실시간 협업·원격 동기화와 전용 PDF 렌더러입니다. 상세 구현·보안 불변식은 `docs/IMPLEMENTATION_HANDOFF.md`를 참고하세요.
