# SEMForge 관리자·일반 계정 권한 배포

2026-10-07 · https://geo.soverin.cloud · 실행 이미지 `geo-master:9b8014c`

## 적용 결과

- `geo-admin`: 관리자 권한으로 SEMForge 활성화. 결제 면제, 구독 만료 없음. 구독 화면에서 결제 버튼 대신 관리자 이용 안내와 워크스페이스 링크 표시.
- 일반 로그인 계정: 자기 계정의 승인 결제 기록과 유효한 구독 기간이 있을 때만 활성화. 다른 계정의 구독·결제·취소에 영향을 줄 수 없음.
- SEMForge 업무 API 20개 메서드에 공통 서버 권한 검사 적용. 미결제 계정은 입력 파싱이나 외부 API 호출 전에 HTTP 402로 차단.
- Traefik이 인증된 사용자 이름을 덮어쓰고 서버 전용 비밀을 주입. 앱은 이를 검증하며 요청 본문, 쿼리, 위조된 관리자 헤더를 역할로 인정하지 않음.
- 요청별 AsyncLocalStorage로 동시 사용자 권한을 분리. 권한에 따라 달라지는 API 응답은 `private, no-store`.
- DB 마이그레이션 10: 기존 공용 구독 기록은 `local` 계정에만 보존. 개발 결제 기록이나 운영 프로세스의 `dev` 플래그로 운영 권한을 얻을 수 없음.

## 검증

- Vitest **43개 파일 / 220개 테스트 통과**.
- 타입 검사·ESLint·로컬 및 Linux Docker 프로덕션 빌드 통과.
- 실제 HTTPS **51개 검사 통과**: 관리자 활성 상태, 일반 계정 비활성 상태, 헤더 위조 차단, 관리자 업무 API 조회, 일반 계정의 업무 API 20개 요청 차단, 운영 결제 위조 차단, 화면 19개 응답 확인.
- Ego Lite에서 관리자 `결제 면제` 화면 및 SEMForge 이동 확인. 일반 계정은 관리자 이름을 요청 헤더에 넣어도 `결제 필요` 화면으로 표시.
- 임시 검증 계정과 해당 구독 행 제거. 제거된 계정 및 미인증 요청 401, 기존 관리자 200·활성 상태 재확인.
- 기존 프로젝트 2개 보존, SQLite `integrity_check=ok`, 컨테이너 healthy.
- 유효 결제·만료·취소·타 계정 결제 재사용은 격리 DB 테스트로 검증. 운영에서 실제 결제나 유료 제공자 실행은 수행하지 않음.

운영 DB와 설정의 변경 전 백업: `/docker/geo-master/backups/before-account-roles-20261007T054729Z`.

## 운영 범위

현재 실제 결제사의 승인 연동은 준비되지 않았습니다. 따라서 일반 계정의 실결제 버튼은 준비 중으로 표시되며 임의 활성화는 차단합니다. 결제사 연결·승인 검증 구현 후 일반 계정의 실제 구독 구매가 가능합니다. 관리자에게 부여한 이용 권한은 미구현 Google OAuth/GSC/GBP 연동을 대신 구현하지 않습니다.

로그인은 [일반 로그인 폼과 세션 쿠키](LOGIN_GUEST_ACCESS.md)를 사용하며 Basic Authorization도 지원합니다. `guest`는 결제·설정과 관련 내보내기·복원에 접근할 수 없습니다. 추가 계정은 서버에서 관리하며 회원가입 화면은 없습니다. SEMForge 구독·이용 권한은 계정별로 구분하지만 프로젝트와 업무 데이터는 단일 워크스페이스를 공유합니다.

[관리자 화면](evidence/account-roles/admin-subscription.png) · [일반 계정 화면](evidence/account-roles/member-subscription.png) · [HTTP 검증](evidence/account-roles/http-checks.json) · [최종 인증 검사](evidence/account-roles/final-check.json) · [계정 추가·운영 안내](README.md).
