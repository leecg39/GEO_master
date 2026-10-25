import type { DatabaseMigration } from "./utils";
import { addColumnIfMissing } from "./utils";

/** 기존 버전 11–19: SQL과 순서를 보존한다. */
export const measurementMigrations: readonly DatabaseMigration[] = [
  {
    version: 11,
    name: "measurement-slot-status-and-brand-aliases",
    up(sqlite) {
      // 컬럼 추가만 한다. 기존 결과는 정상 답변(succeeded) + legacy 산식으로 표기된다.
      addColumnIfMissing(sqlite, "projects", "brand_aliases", "TEXT NOT NULL DEFAULT '[]'");
      addColumnIfMissing(sqlite, "measure_results", "slot_status", "TEXT NOT NULL DEFAULT 'succeeded'");
      addColumnIfMissing(sqlite, "measure_results", "matched_spans", "TEXT NOT NULL DEFAULT '[]'");
      addColumnIfMissing(sqlite, "measure_results", "own_domain_hit", "INTEGER NOT NULL DEFAULT 0");
      addColumnIfMissing(sqlite, "measure_results", "metric_version", "TEXT NOT NULL DEFAULT 'legacy'");
    },
  },
  {
    version: 12,
    name: "search-grounded-measurement-citations",
    up(sqlite) {
      addColumnIfMissing(sqlite, "projects", "competitor_domains", "TEXT NOT NULL DEFAULT '[]'");
      addColumnIfMissing(sqlite, "measure_results", "search_mode", "TEXT NOT NULL DEFAULT 'off'");
      addColumnIfMissing(sqlite, "measure_results", "search_performed", "INTEGER");
      addColumnIfMissing(sqlite, "measure_results", "citation_supported", "INTEGER");
      addColumnIfMissing(sqlite, "measure_results", "returned_model", "TEXT");
      addColumnIfMissing(sqlite, "measure_results", "slot_error", "TEXT");
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS measure_citations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_id INTEGER NOT NULL REFERENCES measure_runs(id) ON DELETE CASCADE,
          result_id INTEGER NOT NULL REFERENCES measure_results(id) ON DELETE CASCADE,
          url TEXT NOT NULL,
          domain TEXT NOT NULL,
          title TEXT,
          kind TEXT NOT NULL CHECK(kind IN ('cited','searched')),
          category TEXT NOT NULL CHECK(category IN ('own','competitor','media','community','marketplace','public','other','unknown')),
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_measure_citations_run ON measure_citations(run_id, category);
        CREATE INDEX IF NOT EXISTS idx_measure_citations_result ON measure_citations(result_id);
      `);
    },
  },
  {
    version: 13,
    name: "fact-memos-and-claim-checks",
    up(sqlite) {
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS facts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          attribute TEXT NOT NULL,
          attribute_normalized TEXT NOT NULL,
          value TEXT NOT NULL,
          unit TEXT,
          conditions TEXT NOT NULL DEFAULT '',
          source_url TEXT,
          excerpt TEXT NOT NULL DEFAULT '',
          checked_at TEXT,
          valid_until TEXT,
          verified INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_facts_project ON facts(project_id, attribute_normalized);
        CREATE TABLE IF NOT EXISTS measure_claims (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_id INTEGER NOT NULL REFERENCES measure_runs(id) ON DELETE CASCADE,
          result_id INTEGER NOT NULL REFERENCES measure_results(id) ON DELETE CASCADE,
          claim_text TEXT NOT NULL,
          attribute TEXT NOT NULL,
          value TEXT NOT NULL,
          unit TEXT,
          verdict TEXT NOT NULL CHECK(verdict IN ('match','conflict','insufficient','time_unknown','needs_review')),
          fact_id INTEGER REFERENCES facts(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_measure_claims_run ON measure_claims(run_id, verdict);
      `);
    },
  },
  {
    version: 14,
    name: "featgeo-optimization-runs",
    up(sqlite) {
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS optimization_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          title TEXT NOT NULL DEFAULT '',
          query TEXT NOT NULL,
          input TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('running','completed','failed','canceled')),
          progress TEXT NOT NULL DEFAULT '{}',
          result TEXT,
          error_code TEXT,
          cancel_requested INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          completed_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_optimization_runs_project ON optimization_runs(project_id, created_at DESC);
      `);
    },
  },
  {
    version: 15,
    name: "review-inbox-and-report-shares",
    up(sqlite) {
      addColumnIfMissing(sqlite, "measure_claims", "reviewed", "INTEGER NOT NULL DEFAULT 0");
      addColumnIfMissing(sqlite, "measure_claims", "original_verdict", "TEXT");
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS mention_reviews (
          result_id INTEGER PRIMARY KEY REFERENCES measure_results(id) ON DELETE CASCADE,
          run_id INTEGER NOT NULL REFERENCES measure_runs(id) ON DELETE CASCADE,
          auto_mentioned INTEGER NOT NULL,
          human_mentioned INTEGER NOT NULL,
          reviewed_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mention_reviews_run ON mention_reviews(run_id);
        CREATE TABLE IF NOT EXISTS report_shares (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          run_id INTEGER NOT NULL REFERENCES measure_runs(id) ON DELETE CASCADE,
          token_hash TEXT NOT NULL UNIQUE,
          snapshot TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          revoked_at TEXT,
          view_count INTEGER NOT NULL DEFAULT 0,
          last_viewed_at TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_report_shares_run ON report_shares(run_id, created_at DESC);
      `);
    },
  },
  {
    version: 16,
    name: "inline-citation-kind",
    up(sqlite) {
      // SQLite는 CHECK 제약을 바꿀 수 없어 테이블을 다시 만든다. 기존 행은 그대로 옮긴다.
      sqlite.exec(`
        CREATE TABLE measure_citations_v16 (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_id INTEGER NOT NULL REFERENCES measure_runs(id) ON DELETE CASCADE,
          result_id INTEGER NOT NULL REFERENCES measure_results(id) ON DELETE CASCADE,
          url TEXT NOT NULL,
          domain TEXT NOT NULL,
          title TEXT,
          kind TEXT NOT NULL CHECK(kind IN ('cited','searched','inline')),
          category TEXT NOT NULL CHECK(category IN ('own','competitor','media','community','marketplace','public','other','unknown')),
          created_at TEXT NOT NULL
        );
        INSERT INTO measure_citations_v16 (id, run_id, result_id, url, domain, title, kind, category, created_at)
          SELECT id, run_id, result_id, url, domain, title, kind, category, created_at FROM measure_citations;
        DROP TABLE measure_citations;
        ALTER TABLE measure_citations_v16 RENAME TO measure_citations;
        CREATE INDEX IF NOT EXISTS idx_measure_citations_run ON measure_citations(run_id, category);
        CREATE INDEX IF NOT EXISTS idx_measure_citations_result ON measure_citations(result_id);
      `);
    },
  },
  {
    version: 17,
    name: "site-audit-discovery-states",
    up(sqlite) {
      // Qshop P01: 이전 Map 결과(가정한 HTTP 200·건강 점수)는 삭제하지 않고 추정치로 격리한다
      addColumnIfMissing(sqlite, "site_audit_pages", "fetch_state", "TEXT NOT NULL DEFAULT 'legacy_estimate'");
      addColumnIfMissing(sqlite, "site_audit_campaigns", "data_state", "TEXT NOT NULL DEFAULT 'legacy_estimate'");
      addColumnIfMissing(sqlite, "site_audit_campaigns", "llms_txt_state", "TEXT");
      sqlite.exec("UPDATE site_audit_campaigns SET data_state = 'none' WHERE last_run_at IS NULL");
    },
  },
  {
    version: 18,
    name: "site-audit-page-fetch-evidence",
    up(sqlite) {
      // Qshop P02: 실제 페이지 응답 근거 (최종 URL, 본문 해시, 오류, 수집 방식)
      addColumnIfMissing(sqlite, "site_audit_pages", "final_url", "TEXT");
      addColumnIfMissing(sqlite, "site_audit_pages", "content_hash", "TEXT");
      addColumnIfMissing(sqlite, "site_audit_pages", "fetch_error", "TEXT");
      addColumnIfMissing(sqlite, "site_audit_pages", "render_mode", "TEXT");
    },
  },
  {
    version: 19,
    name: "site-audit-cancel-request",
    up(sqlite) {
      // Qshop P02: 실행 중인 크롤 취소 요청
      addColumnIfMissing(sqlite, "site_audit_campaigns", "cancel_requested", "INTEGER NOT NULL DEFAULT 0");
    },
  },
] as const;
