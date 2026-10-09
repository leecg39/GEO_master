# Search Console 콘솔 내보내기 수집기

공개 Search Console API는 SNS 플랫폼 속성(Instagram·X·TikTok 크리에이터 프로필)을 조회하지 못한다(속성 404, 성과 400 — `output/gsc-api-recheck/2026-10-08` 실측). 대신 콘솔 실적 화면의 **내보내기 → Excel 다운로드**를 전용 Chrome 프로필로 실행해 GEO Master의 `/search-console` 가져오기에 올린다.

## 원칙

- **로그인은 사람이 직접 한다.** 수집기는 비밀번호를 입력하지 않는다. `npm run gsc:login`이 연 일반 Chrome 창에서 로그인한다.
- **매일 쓰는 브라우저를 조작하지 않는다.** 전용 프로필(`~/.geo-master/gsc-chrome-profile`)만 쓴다. 보이는 브라우저를 예약 조작하면 탭 전환 시 입력이 다른 탭으로 들어가는 것을 실제로 확인해 이 방식을 택했다.
- **실패를 빈 데이터로 기록하지 않는다.** 로그인 만료(`NOT_LOGGED_IN`), 다른 속성으로 이동(`PROPERTY_UNAVAILABLE`), 화면 변경(`EXPORT_BUTTON_NOT_FOUND`·`EXPORT_MENU_NOT_FOUND`), xlsx가 아닌 파일(`INVALID_DOWNLOAD`)은 각각 실패로 남는다.
- **로컬 앱에만 올린다.** `appUrl`은 기본적으로 127.0.0.1/localhost만 허용한다.

## 사용법

```bash
cp gsc-collect.config.example.json gsc-collect.config.json   # 속성 이름·식별자 입력 (git에 올라가지 않음)
npm run gsc:login                       # 최초 1회·만료 시: 직접 로그인 후 창 닫기
npm run gsc:collect                     # 수집 + 가져오기
npm run gsc:collect -- --dry-run        # 설정 검증만
npm run gsc:collect -- --no-upload      # 내려받기만
npm run gsc:collect -- --print-launchd  # 매일 실행용 LaunchAgent plist 출력(설치는 직접)
```

속성 식별자(`resourceId`)는 콘솔 주소의 `resource_id` 값이다. 예: `sc-creator-profile:tiktok.com/user/계정`.

내려받은 파일과 실행 결과(`result-*.json`)는 `~/.geo-master/gsc-exports/YYYY-MM-DD/`에 저장된다(권한 600). 같은 파일은 앱에서 중복으로 처리된다.

## 종료 코드

| 코드 | 의미 |
|---|---|
| 0 | 모든 속성 내려받기·가져오기 성공(중복 포함) |
| 1 | 일부 또는 전체 속성 실패 — 결과 파일과 출력의 오류 코드 확인 |
| 2 | 설정 오류, 이미 실행 중, Chrome 실행 실패 |

## 알려진 제약

- Google이 헤드리스 세션을 로그인 상태로 인정하지 않으면 설정에 `"headless": false`를 넣는다(전용 창이 잠깐 열렸다 닫힌다). 탐지 회피(사용자 에이전트 위장 등)는 하지 않는다.
- launchd로 실행할 때 macOS 키체인 접근(Chrome 쿠키 암호화) 확인 창이 뜰 수 있다. 처음 한 번 수동 실행해 허용해 둔다.
- 콘솔 기본 기간(플랫폼 속성은 최근 28일)과 필터는 파일의 필터 시트에 기록되며 가져오기 화면에 그대로 표시된다.

## PR #22 회귀 수정

- 수집기는 일반 JavaScript ESM을 사용한다. Node **22.0.0 이상**에서 별도 TypeScript 로더나 사전 빌드 없이 실행한다. 공용 로직의 타입은 JSDoc과 `npm run typecheck`로 검사한다.
- 설정의 `label`은 대소문자 구분 없이, `resourceId`는 앞뒤 공백을 제거한 정확한 값으로 중복을 거부한다. URL 경로는 대소문자를 구별하므로 식별자 전체를 소문자로 바꾸지 않는다.
- 파일명은 `이름-slug + resourceId의 SHA-256 + 날짜.xlsx`다. 이름에서 특수문자 제거·길이 제한·한글 정규화가 일어나도 다른 속성의 파일을 덮어쓰지 않는다. 같은 속성을 같은 날짜에 재실행하면 해당 속성의 파일은 갱신된다.
- 로그인 Chrome이 비정상 종료하거나 시그널로 종료되면 `BROWSER_LOGIN_FAILED`, 수집기 종료 코드 **2**를 반환한다. Chrome을 실행하지 못한 경우는 `BROWSER_LAUNCH_FAILED`다. 모두 프로필 잠금을 해제한다. 정상 종료 코드 0 자체가 Google 인증 성공을 보장하지는 않는다.

### 자동 검증

```bash
npm run test:gsc   # bare Node 회귀 테스트: CLI 실행·파일 보존·중복 거부·로그인 종료 코드
npm test          # 기존 Vitest 전체 + 위 회귀 테스트
npm run typecheck
npm run lint
npm run build
```

`.github/workflows/gsc-collector.yml`은 Node 22.0.0 / 22.17.0 / 22.18.0 / 최신 22.x / 24.x / 26.x에서 수집기 테스트를 실행한다. 수집기 버전별 작업은 사용하지 않는 앱의 SQLite 네이티브 빌드를 생략한다. 별도의 Node 24.x 작업은 일반 설치 후 앱 전체 테스트·타입 검사·린트·빌드를 수행한다.

자동 테스트는 임시 디렉터리, 가짜 Chrome 실행 파일, 가짜 Playwright 다운로드를 사용한다. 실제 Google 계정에 접속하거나 실제 Search Console 보고서를 다운로드하지 않는다.

### 실제 계정·macOS에서 남은 검증

- [ ] `npm run gsc:login`으로 사용자가 직접 Google 로그인 후 창을 닫는다.
- [ ] `npm run gsc:collect -- --no-upload`로 권한이 있는 실제 속성의 Excel을 다운로드하고 내용·기간·속성을 확인한다.
- [ ] GEO Master 실행 후 `npm run gsc:collect`로 가져오기를 확인하고, 같은 보고서 재실행 시 중복 처리되는지 확인한다.
- [ ] macOS launchd 실행에서 키체인·전용 Chrome 쿠키 접근과 예약 수집을 확인한다.

### 이번 수정의 실행 결과 (2026-10-09 KST)

| 검증 | 결과 |
|---|---|
| 기존 Vitest 전체 (Node 24.19.0) | 90개 파일, 636개 테스트 통과 |
| 수집기 회귀 테스트 (각 Node 버전) | 22.0.0 / 22.17.0 / 22.18.0 / 24.19.0 / 26.0.0에서 각각 16개 통과 |
| 타입 검사 / 린트 / 프로덕션 빌드 | Node 24.19.0에서 모두 통과 |
| 실제 Google 로그인·실제 Excel 수집·macOS launchd | 이번 수정에서는 미실행, 위 수동 검증 목록 참조 |

Linux 검증 환경의 최초 `npm ci`는 Node 헤더 압축 해제 중 `fchown` 오류로 중단됐다. 의존성 버전 변경 없이 `npm ci --ignore-scripts` 후 공식 Node 24.19.0 헤더를 준비하고 `better-sqlite3`를 다시 빌드해 전체 검증을 완료했다. 다른 Node 버전은 수집기 회귀 테스트 범위만 실행했다.
