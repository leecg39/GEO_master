import type { DatabaseMigration } from "./utils";
import { addColumnIfMissing } from "./utils";
import { createHash } from "node:crypto";

/** 기존 버전 20–27: SQL과 순서를 보존한다. */
export const workbenchMigrations: readonly DatabaseMigration[] = [
  {
    version: 20,
    name: "page-change-items",
    up(sqlite) {
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS change_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          url TEXT NOT NULL,
          field TEXT NOT NULL CHECK(field IN ('title','description','canonical','og_image','robots_meta','json_ld','body')),
          original_value TEXT NOT NULL,
          original_hash TEXT NOT NULL,
          proposed_value TEXT NOT NULL,
          rationale TEXT NOT NULL DEFAULT '',
          evidence_url TEXT,
          status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','delivered','verification_pending','verified','conflict','failed')),
          approved_at TEXT,
          delivery_method TEXT,
          delivered_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_change_items_project ON change_items(project_id, status, updated_at DESC);
      `);
    },
  },
  {
    version: 21,
    name: "llms-document-revisions",
    up(sqlite) {
      // Qshop P07: 이미 저장된 문서를 현재 내용의 첫 리비전으로 보존한다.
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS llms_document_revisions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          document_id INTEGER NOT NULL REFERENCES llms_documents(id) ON DELETE CASCADE,
          revision INTEGER NOT NULL,
          document TEXT NOT NULL,
          content_hash TEXT NOT NULL,
          origin TEXT NOT NULL CHECK(origin IN ('created','edited','remote','restored')),
          created_at TEXT NOT NULL,
          UNIQUE(document_id, revision)
        );
        CREATE INDEX IF NOT EXISTS idx_llms_revisions_doc ON llms_document_revisions(document_id, revision DESC);
      `);
      const rows = sqlite.prepare("SELECT id, document, created_at FROM llms_documents").all() as { id: number; document: string; created_at: string }[];
      const insert = sqlite.prepare("INSERT OR IGNORE INTO llms_document_revisions (document_id, revision, document, content_hash, origin, created_at) VALUES (?, 1, ?, ?, 'created', ?)");
      for (const row of rows) insert.run(row.id, row.document, createHash("sha256").update(row.document).digest("hex"), row.created_at);
    },
  },
  {
    version: 22,
    name: "page-change-items-v2",
    up(sqlite) {
      // 호환 마이그레이션: 20번을 이미 적용한 DB에서는 버전으로 건너뛴다.
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS change_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          url TEXT NOT NULL,
          field TEXT NOT NULL CHECK(field IN ('title','description','canonical','og_image','robots_meta','json_ld','body')),
          original_value TEXT NOT NULL,
          original_hash TEXT NOT NULL,
          proposed_value TEXT NOT NULL,
          rationale TEXT NOT NULL DEFAULT '',
          evidence_url TEXT,
          status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','delivered','verification_pending','verified','conflict','failed')),
          approved_at TEXT,
          delivery_method TEXT,
          delivered_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_change_items_project ON change_items(project_id, status, updated_at DESC);
      `);
    },
  },
  {
    version: 23,
    name: "llms-document-revisions-v2",
    up(sqlite) {
      // 호환 마이그레이션: 21번을 이미 적용한 DB에서는 버전으로 건너뛴다.
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS llms_document_revisions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          document_id INTEGER NOT NULL REFERENCES llms_documents(id) ON DELETE CASCADE,
          revision INTEGER NOT NULL,
          document TEXT NOT NULL,
          content_hash TEXT NOT NULL,
          origin TEXT NOT NULL CHECK(origin IN ('created','edited','remote','restored')),
          created_at TEXT NOT NULL,
          UNIQUE(document_id, revision)
        );
        CREATE INDEX IF NOT EXISTS idx_llms_revisions_doc ON llms_document_revisions(document_id, revision DESC);
      `);
      const rows = sqlite.prepare("SELECT id, document, created_at FROM llms_documents").all() as { id: number; document: string; created_at: string }[];
      const insert = sqlite.prepare("INSERT OR IGNORE INTO llms_document_revisions (document_id, revision, document, content_hash, origin, created_at) VALUES (?, 1, ?, ?, 'created', ?)");
      for (const row of rows) insert.run(row.id, row.document, createHash("sha256").update(row.document).digest("hex"), row.created_at);
    },
  },
  {
    version: 24,
    name: "page-snapshots",
    up(sqlite) {
      // Qshop P03: URL별 실제 수집 버전과 규칙 버전이 있는 진단 근거
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS page_snapshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          campaign_id INTEGER REFERENCES site_audit_campaigns(id) ON DELETE SET NULL,
          url TEXT NOT NULL,
          final_url TEXT,
          status_code INTEGER NOT NULL,
          content_type TEXT,
          body_kind TEXT NOT NULL DEFAULT 'html' CHECK(body_kind IN ('html','markdown','text')),
          render_mode TEXT NOT NULL CHECK(render_mode IN ('native','rendered','cache')),
          content_hash TEXT NOT NULL,
          bytes INTEGER NOT NULL,
          html TEXT,
          html_truncated INTEGER NOT NULL DEFAULT 0,
          facts TEXT,
          findings TEXT NOT NULL,
          skipped_reason TEXT,
          parser_version TEXT NOT NULL,
          rules_version TEXT NOT NULL,
          captured_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_page_snapshots_url ON page_snapshots(project_id, url, captured_at DESC);
      `);
      addColumnIfMissing(sqlite, "page_snapshots", "body_kind", "TEXT NOT NULL DEFAULT 'html' CHECK(body_kind IN ('html','markdown','text'))");
      addColumnIfMissing(sqlite, "site_audit_pages", "snapshot_id", "INTEGER REFERENCES page_snapshots(id) ON DELETE SET NULL");
    },
  },
  {
    version: 25,
    name: "llms-scope-and-robots-policy",
    up(sqlite) {
      // Qshop P04: 경로별 llms.txt, 사이트 진단의 AI 크롤러 정책(목적별)
      addColumnIfMissing(sqlite, "llms_documents", "scope_path", "TEXT NOT NULL DEFAULT '/llms.txt'");
      addColumnIfMissing(sqlite, "site_audit_campaigns", "robots_policy", "TEXT");
    },
  },
  {
    version: 26,
    name: "search-console-console-exports",
    up(sqlite) {
      // Qshop P10 대안: 콘솔에서 내려받은 성과 보고서(Excel) 가져오기. API 연결(gsc_connections)과 원천을 섞지 않는다
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS search_console_imports (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          source TEXT NOT NULL DEFAULT 'console_export' CHECK(source IN ('console_export')),
          property_label TEXT NOT NULL,
          file_name TEXT NOT NULL,
          content_hash TEXT NOT NULL,
          period_start TEXT,
          period_end TEXT,
          filters TEXT NOT NULL DEFAULT '{}',
          clicks INTEGER NOT NULL,
          impressions INTEGER NOT NULL,
          ctr REAL,
          position REAL,
          has_data INTEGER NOT NULL,
          imported_at TEXT NOT NULL,
          UNIQUE(project_id, property_label, content_hash)
        );
        CREATE TABLE IF NOT EXISTS search_console_daily (
          import_id INTEGER NOT NULL REFERENCES search_console_imports(id) ON DELETE CASCADE,
          date TEXT NOT NULL,
          clicks INTEGER NOT NULL,
          impressions INTEGER NOT NULL,
          ctr REAL,
          position REAL,
          PRIMARY KEY (import_id, date)
        );
        CREATE TABLE IF NOT EXISTS search_console_rows (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          import_id INTEGER NOT NULL REFERENCES search_console_imports(id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK(kind IN ('queries','pages','countries','devices','appearances')),
          key TEXT NOT NULL,
          clicks INTEGER NOT NULL,
          impressions INTEGER NOT NULL,
          ctr REAL,
          position REAL
        );
        CREATE INDEX IF NOT EXISTS idx_search_console_imports_project ON search_console_imports(project_id, imported_at DESC);
        CREATE INDEX IF NOT EXISTS idx_search_console_rows_import ON search_console_rows(import_id, kind);
      `);
    },
  },
  {
    version: 27,
    name: "self-service-signup-accounts",
    up(sqlite) {
      // 회원가입 계정. login_id는 다른 테이블의 account_id와 같은 값(소문자 이메일)이다.
      // 비밀번호는 bcrypt 해시만 저장하며 워크스페이스 내보내기·복원 대상이 아니다.
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS accounts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          login_id TEXT NOT NULL UNIQUE COLLATE NOCASE,
          display_name TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          plan TEXT NOT NULL CHECK(plan IN ('free','semforge')),
          status TEXT NOT NULL CHECK(status IN ('pending','active','disabled')),
          consented_at TEXT NOT NULL,
          approved_at TEXT,
          approved_by TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts(status, created_at DESC);
      `);
    },
  },
] as const;
