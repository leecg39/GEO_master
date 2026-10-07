# Hostinger 운영 배포

- URL: https://geo.soverin.cloud
- VPS: `srv1655088` / `72.61.116.250`
- 서버 소스: `/docker/geo-master/app`
- Compose 작업 폴더: `/docker/geo-master/app/deploy/hostinger`
- 프로젝트: `geo-master`, 컨테이너: `geo-master-app-1`
- 영구 볼륨: `geo-master_geo-data` → `/app/data`

## 구성

Next.js standalone 이미지를 비루트 사용자로 실행합니다. 앱 포트는 호스트에 공개하지 않으며 기존 Traefik이 HTTPS와 전체 경로 Basic Auth를 담당합니다. 비밀번호는 bcrypt 해시만 Traefik에 전달합니다. 인증 이후 기존 앱의 same-origin API 보호도 유지됩니다.

DNS는 Cloudflare의 `geo` A 레코드가 VPS를 가리키는 DNS only 구성입니다. 인증서는 기존 `letsencrypt` resolver가 발급·갱신합니다. 장시간 AI 요청은 Cloudflare 프록시를 경유하지 않습니다.

다음 파일은 Git·이미지에 포함하지 않습니다. 서버에서 권한 `0600`으로 보관합니다.

- `.env`: `GEO_DOMAIN`, `GEO_IMAGE_TAG`, `GEO_HTTP_AUTH`, `GEO_ADMIN_USERS`, `GEO_AUTH_PROXY_SECRET`
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

Basic Auth 계정별로 SEMForge 이용 권한을 확인하는 단일 워크스페이스 배포입니다. `GEO_ADMIN_USERS`에 등록된 계정(기본 `geo-admin`)은 결제 없이 사용합니다. 일반 계정은 자기 계정에 연결된 승인 결제와 유효한 구독 기간이 필요합니다. 프로젝트·업무 데이터까지 고객별로 분리하는 멀티테넌트 제품은 아닙니다.

Traefik이 Basic Auth로 확인한 사용자 이름을 `X-Geo-Auth-User`에 덮어쓰고 서버 전용 `X-Geo-Auth-Secret`을 추가합니다. 앱은 32자 이상의 `GEO_AUTH_PROXY_SECRET`을 상수 시간 비교한 뒤 역할을 판단합니다. 요청 본문·쿼리의 사용자나 관리자 값은 권한에 영향을 주지 않습니다. 서버 `.env`에 안전한 임의 비밀을 설정해야 Compose를 시작할 수 있습니다. 이 비밀을 클라이언트·브라우저·Git에 전달하지 마세요.

추가 로그인 계정은 `htpasswd`의 bcrypt 해시를 기존 `GEO_HTTP_AUTH` 목록에 쉼표로 추가하고 앱을 재생성합니다. 계정 이름은 영문·숫자로 시작하고 영문·숫자·`@._+-`만 허용하며 최대 128자입니다. `GEO_ADMIN_USERS`에 넣지 않은 새 계정은 일반 계정이며, 다른 계정의 구독이나 기존 공용 구독을 상속하지 않습니다. 기존 워크스페이스 구독 기록은 DB 마이그레이션에서 `local` 계정으로만 보존합니다.

`SEMFORGE_BILLING_MODE=live`, mock 플래그 `0`으로 배포합니다. 실제 결제 검증 및 Google OAuth/GSC/GBP 연동의 미구현 상태는 그대로이며, API 키를 제공해도 해당 기능이 자동으로 완성되지는 않습니다. 일반 계정의 실결제 활성화는 결제사 연동 후 가능합니다. 운영 프로세스는 `dev` 플래그를 넣어도 테스트 결제를 승인하지 않으며 개발 결제 기록으로 운영 권한을 얻을 수 없습니다. 예약 측정은 기본 비용 한도 0으로 시작합니다.

참고: [Next.js standalone](https://nextjs.org/docs/app/api-reference/config/next-config-js/output), [Traefik BasicAuth](https://doc.traefik.io/traefik/reference/routing-configuration/http/middlewares/basicauth/).
