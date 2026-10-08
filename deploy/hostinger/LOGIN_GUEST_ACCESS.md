# 로그인 및 게스트 권한

로그인 주소: https://geo.soverin.cloud/login

브라우저 Basic Auth 대화상자의 `401 Unauthorized` 응답 대신 HTML 로그인 폼을 제공합니다. 성공하면 12시간 유효한 `__Host-geo_session` 쿠키를 발급합니다. 쿠키에는 HttpOnly, Secure, SameSite=Lax, Path=/가 적용되며, 비밀번호 변경 또는 계정 삭제 시 기존 세션도 무효화됩니다. API용 Basic Authorization은 계속 지원합니다.

| 계정 역할 | 기본 분석 | SEMForge 실행 | 결제·구독 화면 | 설정 | 설정 포함 내보내기·복원 |
| --- | --- | --- | --- | --- | --- |
| 관리자 (`geo-admin`) | 허용 | 결제 면제 | 허용 | 허용 | 허용 |
| 일반 회원 | 허용 | 본인 명의 유효 결제 필요 | 허용 | 허용 | 허용 |
| 게스트 (`guest`) | 허용 | 차단 | 숨김·403 | 숨김·403 | 숨김·403 |

게스트에게는 데스크톱과 모바일 메뉴 모두 SEMForge Pro, 설정, 팀 공유(설정 포함 내보내기·복원)를 표시하지 않습니다. 직접 주소 입력, API 호출, 위조 사용자 헤더로도 접근할 수 없습니다. 게스트 지정은 관리자 목록보다 우선합니다. 기존 고객별 결제 검증과 관리자 무료 사용 정책은 유지합니다. 실결제 제공자 연동은 기존과 동일하게 준비 중입니다.

응답 점유율·llms.txt 화면에서 사용하는 브랜드명, 카테고리, 반복 횟수, 모델 사용 가능 여부는 `/api/measurement-context`에서 제공합니다. API 키 값·힌트, 제공자 토큰, 결제 설정은 이 응답에 포함하지 않습니다. 기본 업무 데이터는 기존 단일 워크스페이스를 공유합니다.

## 인증 경계

- Traefik: TLS 종료, 외부 사용자 헤더 제거, 서버 전용 비밀 헤더 주입.
- Next.js 프록시: bcrypt 또는 서명 세션 검증, 인증 사용자 헤더 덮어쓰기, 경로별 게스트 권한 검사.
- 결제 서비스: 게스트 결제 생성·승인·취소 거부, 관리자 면제, 일반 계정의 승인 영수증 검증.
- 잘못된 로그인: 동일한 오류 안내. 폼 요청 4KB 제한, 동일 출처 검사, IP당 5분에 15회 제한(단일 프로세스 기준).
- 공개 공유 페이지·OG 이미지 유지. 세션 쿠키가 있는 루트 요청은 앱 인증을 거칩니다.
- 계정 비밀번호는 저장소에 보관하지 않습니다. 서버 `.env`의 `GEO_HTTP_AUTH`에는 bcrypt 해시만 저장합니다. `GEO_GUEST_USERS=guest`를 별도로 지정합니다.

## 검증

```sh
npm test
npm run typecheck
npm run lint
npm run build
node scripts/verify-login-guest.mjs
node scripts/verify-social-preview.mjs
```

HTTP 검증은 로컬 비공개 `.gstack/deploy/geo.soverin.cloud/access.txt` 및 `guest-access.txt`를 사용합니다. 출력 증적에는 비밀번호, 세션 쿠키, API 키를 기록하지 않습니다. 공유 미리보기 검증의 과거 프로젝트 스냅샷 비교는 `GEO_VERIFY_PROJECT_SNAPSHOT=1`로 명시적으로 실행합니다.

배포 이미지: `geo-master:login-guest-20261007T070014Z`.

배포 전 DB·암호화 키·환경·Compose 백업:
`/docker/geo-master/backups/before-login-guest-20261007T065939Z`.

롤백 시 해당 백업의 `.env`와 `compose.yml`을 함께 복원하고 이전 이미지 `geo-master:og-20261007-v1`로 앱만 재생성합니다. 이번 변경에는 DB 마이그레이션이 없습니다.

검증 완료: 44개 테스트 파일·245개 테스트, 타입 검사, ESLint, 로컬 및 Linux Docker 프로덕션 빌드 통과. 운영 HTTPS 로그인·권한 검사 116개와 공유 미리보기 검사 67개 통과. Ego Lite에서 실제 게스트·관리자 폼 로그인, 게스트 새로고침 세션 유지, 데스크톱·모바일 메뉴 숨김, 로그아웃을 확인했습니다.

[HTTP 검증](evidence/login-guest/http-checks.json) · [브라우저 검증](evidence/login-guest/browser-checks.json) · [데이터 비교](evidence/login-guest/data-check.json).

비교 테이블의 행 수는 유지되었고, 설정·측정·진단·콘텐츠·결제 기록은 백업과 동일합니다. 프로젝트 3의 도메인 및 수정 시각은 새 컨테이너 시작 전에 변경되어 그 상태를 보존했습니다.
