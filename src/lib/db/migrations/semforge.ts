import type { DatabaseMigration } from "./utils";
import { addColumnIfMissing } from "./utils";

/** 기존 버전 6–10: SQL과 순서를 보존한다. */
export const semforgeMigrations: readonly DatabaseMigration[] = [
  {
    version: 6,
    name: "semforge-integration-and-subscription",
    up(sqlite) {
      addColumnIfMissing(sqlite, "projects", "domain", "TEXT NOT NULL DEFAULT ''");
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS semforge_subscriptions (
          id INTEGER PRIMARY KEY,
          status TEXT NOT NULL DEFAULT 'inactive' CHECK(status IN ('inactive','pending','active','past_due','canceled')),
          amount_krw INTEGER NOT NULL DEFAULT 300000,
          current_period_start TEXT,
          current_period_end TEXT,
          canceled_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT OR IGNORE INTO semforge_subscriptions (id, status, amount_krw, created_at, updated_at)
        VALUES (1, 'inactive', 300000, datetime('now'), datetime('now'));

        CREATE TABLE IF NOT EXISTS semforge_payment_intents (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          amount_krw INTEGER NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('pending','paid','failed','expired')),
          provider TEXT NOT NULL DEFAULT 'toss',
          provider_order_id TEXT NOT NULL UNIQUE,
          confirm_token_hash TEXT,
          checkout_url TEXT,
          paid_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sites (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          domain TEXT NOT NULL,
          name TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(project_id, domain)
        );

        CREATE TABLE IF NOT EXISTS ai_visibility_queries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          domain TEXT NOT NULL,
          query TEXT NOT NULL,
          normalized_query TEXT NOT NULL,
          country_code TEXT NOT NULL DEFAULT 'KR',
          device TEXT NOT NULL DEFAULT 'desktop',
          deleted_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_visibility_query_unique
          ON ai_visibility_queries(project_id, domain, normalized_query, country_code, device)
          WHERE deleted_at IS NULL;

        CREATE TABLE IF NOT EXISTS ai_visibility_snapshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          query_id INTEGER NOT NULL REFERENCES ai_visibility_queries(id) ON DELETE CASCADE,
          aio_present INTEGER NOT NULL DEFAULT 0,
          cited INTEGER,
          cited_url TEXT,
          cited_domains TEXT NOT NULL DEFAULT '[]',
          organic_position INTEGER,
          features TEXT NOT NULL DEFAULT '[]',
          source TEXT NOT NULL DEFAULT 'talordata',
          captured_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS site_audit_campaigns (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          domain TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'idle',
          site_health INTEGER,
          last_run_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS site_audit_pages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          campaign_id INTEGER NOT NULL REFERENCES site_audit_campaigns(id) ON DELETE CASCADE,
          url TEXT NOT NULL,
          status_code INTEGER NOT NULL DEFAULT 0,
          title TEXT,
          depth INTEGER NOT NULL DEFAULT 0,
          response_ms INTEGER,
          bytes INTEGER NOT NULL DEFAULT 0,
          captured_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS site_audit_issues (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          campaign_id INTEGER NOT NULL REFERENCES site_audit_campaigns(id) ON DELETE CASCADE,
          url TEXT NOT NULL,
          severity TEXT NOT NULL,
          category TEXT NOT NULL,
          title TEXT NOT NULL,
          detail TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS position_tracking_campaigns (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          domain TEXT NOT NULL,
          search_engine TEXT NOT NULL DEFAULT 'google',
          device TEXT NOT NULL DEFAULT 'desktop',
          location TEXT NOT NULL DEFAULT 'KR',
          visibility INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS tracked_keywords (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          campaign_id INTEGER NOT NULL REFERENCES position_tracking_campaigns(id) ON DELETE CASCADE,
          keyword TEXT NOT NULL,
          position INTEGER,
          previous_position INTEGER,
          volume INTEGER,
          deleted_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS gsc_connections (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          site_url TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'disconnected',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS gbp_connections (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          location_name TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'disconnected',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_sites_project ON sites(project_id, domain);
        CREATE INDEX IF NOT EXISTS idx_ai_visibility_project ON ai_visibility_queries(project_id, domain, deleted_at);
        CREATE INDEX IF NOT EXISTS idx_ai_visibility_snapshots ON ai_visibility_snapshots(query_id, captured_at DESC);
        CREATE INDEX IF NOT EXISTS idx_site_audit_campaigns ON site_audit_campaigns(project_id, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_position_campaigns ON position_tracking_campaigns(project_id, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_tracked_keywords ON tracked_keywords(campaign_id, deleted_at);
      `);
    },
  },
  {
    version: 7,
    name: "settings-talordata-api-token",
    up(sqlite) {
      addColumnIfMissing(sqlite, "settings", "talordata_api_token", "TEXT");
    },
  },
  {
    version: 8,
    name: "settings-firecrawl-api-key",
    up(sqlite) {
      addColumnIfMissing(sqlite, "settings", "firecrawl_api_key", "TEXT");
    },
  },
  {
    version: 9,
    name: "local-business-map-rank",
    up(sqlite) {
      addColumnIfMissing(sqlite, "gbp_connections", "address", "TEXT NOT NULL DEFAULT ''");
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS map_rank_campaigns (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          gbp_connection_id INTEGER REFERENCES gbp_connections(id) ON DELETE SET NULL,
          name TEXT NOT NULL,
          business_name TEXT NOT NULL,
          location_label TEXT NOT NULL,
          visibility INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS map_rank_keywords (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          campaign_id INTEGER NOT NULL REFERENCES map_rank_campaigns(id) ON DELETE CASCADE,
          keyword TEXT NOT NULL,
          map_position INTEGER,
          previous_map_position INTEGER,
          in_local_pack INTEGER NOT NULL DEFAULT 0,
          deleted_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_map_rank_campaigns ON map_rank_campaigns(project_id, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_map_rank_keywords ON map_rank_keywords(campaign_id, deleted_at);
      `);
    },
  },
  {
    version: 10,
    name: "account-scoped-semforge-entitlements",
    up(sqlite) {
      // Existing single-workspace records belong only to the legacy local account.
      addColumnIfMissing(sqlite, "semforge_subscriptions", "account_id", "TEXT NOT NULL DEFAULT 'local'");
      addColumnIfMissing(sqlite, "semforge_subscriptions", "billing_mode", "TEXT NOT NULL DEFAULT 'legacy'");
      addColumnIfMissing(sqlite, "semforge_payment_intents", "account_id", "TEXT NOT NULL DEFAULT 'local'");
      addColumnIfMissing(sqlite, "semforge_payment_intents", "billing_mode", "TEXT NOT NULL DEFAULT 'legacy'");
      addColumnIfMissing(sqlite, "semforge_subscriptions", "payment_intent_id", "INTEGER REFERENCES semforge_payment_intents(id) ON DELETE SET NULL");
      sqlite.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_semforge_subscription_account ON semforge_subscriptions(account_id);
        CREATE INDEX IF NOT EXISTS idx_semforge_payment_account ON semforge_payment_intents(account_id, provider_order_id);
      `);
    },
  },
] as const;
