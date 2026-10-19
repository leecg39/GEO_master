import type { DatabaseMigration } from "./utils";

/** 기존 버전 28–31: SQL과 순서를 보존한다. */
export const reportMigrations: readonly DatabaseMigration[] = [
  {
    version: 28,
    name: "change-verifications",
    up(sqlite) {
      // 반영 확인 이력 (rankseo-gap-reports-plan R03). 확인할 때마다 무엇을 보고 판정했는지 남긴다.
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS change_verifications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          change_item_id INTEGER NOT NULL REFERENCES change_items(id) ON DELETE CASCADE,
          source TEXT NOT NULL CHECK(source IN ('public','wordpress')),
          result TEXT NOT NULL CHECK(result IN ('matched','pending','http_error','fetch_error')),
          http_status INTEGER,
          matched INTEGER,
          actual_excerpt TEXT,
          checked_url TEXT NOT NULL,
          final_url TEXT,
          duration_ms INTEGER NOT NULL,
          error_code TEXT,
          checked_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_change_verifications_item ON change_verifications(change_item_id, id DESC);
      `);
    },
  },
  {
    version: 29,
    name: "wordpress-connections",
    up(sqlite) {
      // WordPress 코어 REST 연결 (R07). 애플리케이션 비밀번호는 암호화해서만 저장한다.
      // SEO 플러그인 메타 쓰기는 사용자가 허용해야 한다(allow_seo_plugin_writes, 기본 0).
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS wordpress_connections (
          project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
          site_url TEXT NOT NULL,
          username TEXT NOT NULL,
          password_encrypted TEXT NOT NULL,
          seo_plugin TEXT NOT NULL CHECK(seo_plugin IN ('none','yoast','rankmath','other')),
          allow_seo_plugin_writes INTEGER NOT NULL DEFAULT 0,
          verified_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 30,
    name: "change-deliveries",
    up(sqlite) {
      // 전달 이력 (R08). 수동 전달과 WordPress 쓰기를 같은 표에 남긴다. 쓰기 전 값은 되돌리기 안내용이다.
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS change_deliveries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          change_item_id INTEGER NOT NULL REFERENCES change_items(id) ON DELETE CASCADE,
          method TEXT NOT NULL CHECK(method IN ('manual','wordpress')),
          target_json TEXT,
          result TEXT NOT NULL CHECK(result IN ('ok','conflict','error')),
          http_status INTEGER,
          error_code TEXT,
          previous_value TEXT,
          remote_modified_at TEXT,
          started_at TEXT NOT NULL,
          finished_at TEXT NOT NULL,
          duration_ms INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_change_deliveries_item ON change_deliveries(change_item_id, id DESC);
      `);
    },
  },
  {
    version: 31,
    name: "integration-secrets",
    up(sqlite) {
      // 외부 API 키 (A7: PageSpeed Insights). 암호화한 값만 저장하며 API 응답으로 돌려주지 않는다.
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS integration_secrets (
          name TEXT PRIMARY KEY CHECK(name IN ('pagespeed')),
          value_encrypted TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
    },
  },
] as const;
