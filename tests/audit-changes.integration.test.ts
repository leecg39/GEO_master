import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createChangeItemFromAudit, suggestChangesFromAudit } from "@/lib/audit-changes";
import { listChangeItems } from "@/lib/change-items";
import { closeDatabase, getDatabase } from "@/lib/db";
import { ensureActiveProject } from "@/lib/projects";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-audit-changes-"));
const databasePath = path.join(dir, "geo.db");
const prevDb = process.env.GEO_DB_PATH;
const prevKey = process.env.GEO_MASTER_KEY;
let auditId = 0;
let legacyId = 0;

function insertAudit(metadata: unknown) {
  const now = "2026-10-08T00:00:00.000Z";
  return Number(getDatabase().sqlite.prepare("INSERT INTO audits (project_id, title, notes, url, score, grade, items, metadata, created_at, updated_at) VALUES (?, 't', '', 'https://example.com/about', 10, '개선 필요', '[]', ?, ?, ?)")
    .run(ensureActiveProject().id, JSON.stringify(metadata), now, now).lastInsertRowid);
}

beforeAll(() => {
  process.env.GEO_DB_PATH = databasePath;
  process.env.GEO_MASTER_KEY = "audit-changes-master-key-with-32-characters";
  auditId = insertAudit({ finalUrl: "https://example.com/about-us", pageFields: { title: "소개", description: null, canonical: "https://example.com/about-us", og_image: null, robots_meta: null } });
  legacyId = insertAudit({ finalUrl: "https://example.com/old" });
});
afterAll(() => {
  closeDatabase(databasePath);
  fs.rmSync(dir, { recursive: true, force: true });
  if (prevDb === undefined) delete process.env.GEO_DB_PATH; else process.env.GEO_DB_PATH = prevDb;
  if (prevKey === undefined) delete process.env.GEO_MASTER_KEY; else process.env.GEO_MASTER_KEY = prevKey;
});

describe("audit → change items", () => {
  it("suggests fields to fix from what the audit actually read, labeled as guidance", () => {
    const suggestions = suggestChangesFromAudit(auditId);
    expect(suggestions.map((s) => [s.field, s.currentValue, s.reasonCode])).toEqual([
      ["title", "소개", "TITLE_SHORT"], ["description", "", "DESCRIPTION_MISSING"], ["og_image", "", "OG_IMAGE_MISSING"],
    ]);
    expect(suggestions[0]!.guidance).toContain("권고");
  });

  it("creates a draft from the audit's recorded value; the proposal is the user's text", () => {
    const item = createChangeItemFromAudit(auditId, { field: "title", proposedValue: "채널톡 회사 소개 | 고객 상담 도구", rationale: "진단: 제목이 너무 짧음" });
    expect(item).toMatchObject({ status: "draft", field: "title", url: "https://example.com/about-us", originalValue: "소개", evidenceUrl: null });
    expect(listChangeItems().map((row) => row.id)).toContain(item.id);
  });

  it("refuses audits that did not record page fields or fields that were not read", () => {
    expect(() => suggestChangesFromAudit(legacyId)).toThrow(expect.objectContaining({ code: "AUDIT_FIELDS_MISSING" }));
    // 진단이 읽지 않은 필드: 허용 목록 밖(json_ld)은 입력 검증에서, 기록되지 않은 허용 필드는 AUDIT_FIELD_NOT_RECORDED로 거부
    expect(() => createChangeItemFromAudit(auditId, { field: "json_ld", proposedValue: "{}" })).toThrow();
    const partial = insertAudit({ finalUrl: "https://example.com/p", pageFields: { title: "제목입니다 충분히 긴" } });
    expect(() => createChangeItemFromAudit(partial, { field: "description", proposedValue: "x" })).toThrow(expect.objectContaining({ code: "AUDIT_FIELD_NOT_RECORDED" }));
    expect(() => createChangeItemFromAudit(999999, { field: "title", proposedValue: "x" })).toThrow();
  });
});
