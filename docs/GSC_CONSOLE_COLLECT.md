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
