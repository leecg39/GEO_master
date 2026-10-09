# Hostinger 운영 배포

- URL: https://geo.soverin.cloud
- VPS: `srv1655088` / `72.61.116.250`
- 서버 소스: `/docker/geo-master/app`
- Compose 작업 폴더: `/docker/geo-master/app/deploy/hostinger`
- 프로젝트: `geo-master`, 컨테이너: `geo-master-app-1`
- 영구 볼륨: `geo-master_geo-data` → `/app/data`

## 구성

Next.js standalone 이미지를 비루트 사용자로 실행합니다. 앱 포트는 호스트에 공개하지 않으며 기존 Traefik이 HTTPS와 신뢰 프록시 헤더를 담당합니다. 앱이 bcrypt 계정을 검증하고 `/login`에서 HttpOnly·Secure 세션 쿠키를 발급합니다. Basic Authorization도 API 호환용으로 지원합니다. 인증 이후 기존 앱의 same-origin API 보호도 유지됩니다.

### 링크 공유 미리보기

미인증 `GET`/`HEAD /`는 `public/link-preview.html`로 내부 재작성되어 서비스 소개와 OG 메타태그만 제공합니다. 대시보드·프로젝트 데이터는 이 정적 HTML에 포함하지 않습니다. 인증 헤더 또는 세션 쿠키가 있거나 `/?login=1`로 접속하면 앱 인증을 거쳐 대시보드로 연결됩니다. 미인증 업무 페이지는 `/login`으로 이동합니다. 공개 소개 화면의 ‘워크스페이스 열기’ 버튼도 이 로그인 경로를 사용합니다.

공개 허용 파일은 `/link-preview.html`, `/og/geo-master-20261007.jpg`, `/og/geo-master-thumbnail-20261007.jpg`입니다. 이미지에는 SVG 대신 JPG를 사용합니다. `GET`/`HEAD` 이외 메서드, 업무 화면, API 및 나머지 파일은 인증을 유지합니다. `/login`은 공개 로그인 폼이며 `/api/auth/login`은 동일 출처 폼 입력을 검증합니다. 공개 경로에서는 인증 사용자·비밀 헤더를 제거하며, 응답은 `private, no-store`로 설정합니다. User-Agent로 인증을 우회하지 않습니다.

`src/app/layout.tsx`와 공개 HTML에 OG·Twitter 메타태그를 설정하고, Docker standalone 이미지에도 `public/`을 복사합니다. 새 이미지로 교체할 때에는 공개 허용 경로와 양쪽 메타태그를 함께 갱신하세요.

배포 후 `node scripts/verify-social-preview.mjs`로 외부 HTTPS에서 메타태그·JPG·공개 범위·인증 경계를 확인합니다. `.gstack/deploy/geo.soverin.cloud/access.txt`가 존재하면 인증된 대시보드와 API도 검증합니다. 비밀번호는 출력하거나 증적에 기록하지 않습니다. 증적은 `deploy/hostinger/evidence/social-preview/checks.json`에 저장됩니다.

카카오에 이전 결과가 캐시되어 있으면 [카카오 URL 메타정보 관리 도구](https://developers.kakao.com/tool)에서 대표 주소의 OG 캐시를 초기화합니다. [공식 안내](https://developers.kakao.com/docs/ko/tool/common#kakaotalk-url-metadata).

DNS는 Cloudflare의 `geo` A 레코드가 VPS를 가리키는 DNS only 구성입니다. 인증서는 기존 `letsencrypt` resolver가 발급·갱신합니다. 장시간 AI 요청은 Cloudflare 프록시를 경유하지 않습니다.

다음 파일은 Git·이미지에 포함하지 않습니다. 서버에서 권한 `0600`으로 보관합니다.

- `.env`: `GEO_DOMAIN`, `GEO_IMAGE_TAG`, `GEO_HTTP_AUTH`, `GEO_ADMIN_USERS`, `GEO_GUEST_USERS`, `GEO_AUTH_PROXY_SECRET`
- `runtime.env`: 제공자 API 키, 운영 플래그
- `/app/data/geo.db` 및 `/app/data/.master-key`: 영구 볼륨에 생성

해시의 `$` 문자가 Compose에서 재해석되지 않도록 `.env`의 `GEO_HTTP_AUTH` 값은 작은따옴표로 감쌉니다. `.env` 전체나 `docker compose config`의 확장 결과를 로그에 출력하지 마세요. 검증에는 `docker compose config --quiet`를 사용합니다.

## 상태·업데이트

```sh
cd /docker/geo-master/app/deploy/hostinger
docker compose config --quiet
docker compose ps
docker compose logs --tail=100 app

# 새 소스를 올린 뒤 .env의 GEO_IMAGE_TAG를 고유 버전으로 갱신
docker compose build app
docker compose up -d --wait app
```

다른 Compose 프로젝트나 Traefik을 재시작할 필요가 없습니다. `docker compose down -v`는 데이터 볼륨을 삭제하므로 사용하지 마세요. 기존 이미지 태그를 유지하면 이전 `GEO_IMAGE_TAG`로 되돌리고 `docker compose up -d --no-build --wait app`으로 코드만 롤백할 수 있습니다. DB 마이그레이션이 포함된 변경은 별도 백업 복구 계획이 필요합니다.

## 데이터 백업

실행 중인 SQLite는 파일 단순 복사 대신 `better-sqlite3` backup API로 일관된 스냅샷을 만듭니다. 아래 절차는 새 백업 디렉터리를 생성하며 기존 백업을 덮어쓰지 않습니다.

```sh
cd /docker/geo-master/app/deploy/hostinger
backup_dir="/docker/geo-master/backups/$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 700 "$backup_dir"
docker compose exec -T app node -e 'const D=require("better-sqlite3"); const d=new D(process.env.GEO_DB_PATH); d.backup("/app/data/geo-backup.db").then(()=>d.close())' </dev/null
docker cp geo-master-app-1:/app/data/geo-backup.db "$backup_dir/geo.db"
# 설정에서 API 키를 저장한 뒤 자동 생성되는 파일입니다.
if docker compose exec -T app test -f /app/data/.master-key </dev/null; then
  docker cp geo-master-app-1:/app/data/.master-key "$backup_dir/.master-key"
fi
cp runtime.env .env "$backup_dir/"
chmod 600 "$backup_dir"/* "$backup_dir"/.[!.]*
```

백업에는 비밀 키가 포함되므로 공개 저장소에 올리지 말고 암호화된 별도 장소에도 보관합니다. `GEO_MASTER_KEY`를 환경변수로 설정한다면 DB와 함께 그 값을 보존해야 합니다.

## 운영 범위

로그인 계정별로 SEMForge 이용 권한을 확인하는 단일 워크스페이스 배포입니다. `GEO_ADMIN_USERS`에 등록된 계정(기본 `geo-admin`)은 결제 없이 사용합니다. 일반 계정은 자기 계정에 연결된 승인 결제와 유효한 구독 기간이 필요합니다. 프로젝트·업무 데이터까지 고객별로 분리하는 멀티테넌트 제품은 아닙니다.

Traefik이 외부 `X-Geo-Auth-User`를 제거하고 서버 전용 `X-Geo-Auth-Secret`을 추가합니다. Next.js 프록시가 세션 또는 Basic 인증을 검증한 뒤 사용자 헤더를 덮어씁니다. 앱은 32자 이상의 `GEO_AUTH_PROXY_SECRET`을 상수 시간 비교한 뒤 역할을 판단합니다. 요청 본문·쿼리의 사용자나 관리자 값은 권한에 영향을 주지 않습니다. 서버 `.env`에 안전한 임의 비밀을 설정해야 Compose를 시작할 수 있습니다. 이 비밀을 클라이언트·브라우저·Git에 전달하지 마세요.

추가 로그인 계정은 `htpasswd`의 bcrypt 해시를 기존 `GEO_HTTP_AUTH` 목록에 쉼표로 추가하고 앱을 재생성합니다. 계정 이름은 영문·숫자로 시작하고 영문·숫자·`@._+-`만 허용하며 최대 128자입니다. `GEO_GUEST_USERS`(기본 `guest`) 계정은 결제·설정·SEMForge 및 설정을 포함한 워크스페이스 내보내기/복원에 접근할 수 없습니다. 관리자·게스트 목록에 없는 새 계정은 일반 계정이며, 다른 계정의 구독이나 기존 공용 구독을 상속하지 않습니다. 기존 워크스페이스 구독 기록은 DB 마이그레이션에서 `local` 계정으로만 보존합니다.

`SEMFORGE_BILLING_MODE=live`, mock 플래그 `0`으로 배포합니다. 실제 결제 검증 및 Google OAuth/GSC/GBP 연동의 미구현 상태는 그대로이며, API 키를 제공해도 해당 기능이 자동으로 완성되지는 않습니다. 일반 계정의 실결제 활성화는 결제사 연동 후 가능합니다. 운영 프로세스는 `dev` 플래그를 넣어도 테스트 결제를 승인하지 않으며 개발 결제 기록으로 운영 권한을 얻을 수 없습니다. 예약 측정은 기본 비용 한도 0으로 시작합니다.

참고: [Next.js standalone](https://nextjs.org/docs/app/api-reference/config/next-config-js/output), [Traefik BasicAuth](https://doc.traefik.io/traefik/reference/routing-configuration/http/middlewares/basicauth/).

로그인·게스트 권한 상세와 검증 결과: [LOGIN_GUEST_ACCESS.md](LOGIN_GUEST_ACCESS.md).

## 서비스 소개·회원가입·관리자 계정

관리자 자격 증명이 없으면 앱이 `approval`·`auto`를 모두 **`closed`로 처리**합니다. 소개·로그인 화면의 가입 링크와 가입 폼을 숨기고, 직접 가입 POST도 403으로 거절하며 계정을 저장하지 않습니다. 기존 회원의 로그인·세션과 공개 소개 화면은 유지됩니다. `GEO_ADMIN_USERS=geo-admin`만 지정해서는 가입이 열리지 않습니다.

유효한 `GEO_ADMIN_ID` + `GEO_ADMIN_PASSWORD`, 또는 유효한 bcrypt `GEO_HTTP_AUTH` 계정 + 일치하는 `GEO_ADMIN_USERS` 역할이 필요합니다. 게스트로도 지정된 계정은 관리자로 인정하지 않습니다. 관리자 설정을 복구하고 재시작하면 지정한 가입 방식이 다시 적용됩니다. 명시적인 `closed`와 알 수 없는 모드는 관리자가 있어도 가입을 허용하지 않습니다.

공개 운영 전에는 [가입 안전장치와 공유 데이터 위험 검토](SIGNUP_SAFETY.md)를 확인하세요. 승인제 자체는 고객별 데이터 격리를 제공하지 않습니다.

비로그인 `GET /`(및 `/link-preview.html`)는 Traefik이 `/welcome`으로 내부 재작성해 스크립트 없는 서비스 소개 화면을 보여 줍니다. 소개 화면은 OG 메타태그를 유지하며 무료(GEO 측정)·SEMForge Pro(유료) 가입 경로를 구분합니다. `/signup`·`/api/auth/signup`은 로그인 폼과 같은 동일 출처·4KB·신뢰 프록시 검사를 거치며 같은 주소에서 10분에 10회로 제한합니다.

서버 `.env`에 아래 값을 추가하고 앱을 재생성합니다. `$`가 들어간 값은 작은따옴표로 감쌉니다.

```sh
GEO_ADMIN_ID='admin@example.com'
GEO_ADMIN_PASSWORD='8자 이상 비밀번호 또는 bcrypt 해시'
GEO_SIGNUP_MODE=approval   # approval / auto / closed
```

- 관리자는 `/admin/accounts`에서 가입 신청을 승인·거절·중지하고, 회원별 가입 유형과 SEMForge 결제 여부를 확인합니다. 중지하면 기존 세션도 바로 무효가 됩니다.
- 가입 회원은 `customer` 역할입니다. GEO 측정 기능과 SEMForge 구독 화면을 쓰며 설정·워크스페이스 백업/복원·회원 관리에는 접근할 수 없습니다. SEMForge Pro로 가입한 회원은 로그인 후 구독 화면으로 이동하고, 결제가 확인된 계정만 SEMForge API를 사용합니다.
- 관리자·게스트·`GEO_HTTP_AUTH` 아이디는 가입으로 선점할 수 없습니다. 가입 계정은 SQLite `accounts` 테이블(마이그레이션 27)에 bcrypt 해시로 저장되며 워크스페이스 내보내기·복원 대상이 아닙니다.
- 프로젝트·측정 데이터는 여전히 단일 워크스페이스를 공유합니다. 고객별 데이터 분리가 필요하면 별도 작업이 필요합니다.
- 배포 후 `node scripts/verify-social-preview.mjs`로 공개 소개 화면과 인증 경계를 다시 확인합니다.
