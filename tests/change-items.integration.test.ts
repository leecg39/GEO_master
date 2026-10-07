import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approveChangeItem, createChangeItem, deleteChangeItem, listChangeItems, markDelivered, reportCurrentValue, updateChangeItem } from "@/lib/change-items";
import { closeDatabase } from "@/lib/db";
import { createProject, ensureActiveProject } from "@/lib/projects";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-change-items-"));
const databasePath = path.join(dir, "geo.db");
const prevDb = process.env.GEO_DB_PATH;
const prevKey = process.env.GEO_MASTER_KEY;
const base = { url: "https://example.com/about", field: "title", originalValue: "회사 소개", proposedValue: "채널톡 회사 소개 | 고객 상담 도구", rationale: "브랜드명과 카테고리를 제목에 넣어 핵심 답변을 앞세움" };

beforeAll(() => {
  process.env.GEO_DB_PATH = databasePath;
  process.env.GEO_MASTER_KEY = "change-items-master-key-with-32-characters-x";
  ensureActiveProject();
});
afterAll(() => {
  closeDatabase(databasePath);
  fs.rmSync(dir, { recursive: true, force: true });
  if (prevDb === undefined) delete process.env.GEO_DB_PATH; else process.env.GEO_DB_PATH = prevDb;
  if (prevKey === undefined) delete process.env.GEO_MASTER_KEY; else process.env.GEO_MASTER_KEY = prevKey;
});

describe("page change items (Qshop P05)", () => {
  it("creates a draft that keeps the original value's hash and survives reload", () => {
    const item = createChangeItem(base);
    expect(item).toMatchObject({ status: "draft", field: "title", approvedAt: null });
    expect(listChangeItems().map((row) => row.id)).toEqual([item.id]);
  });

  it("rejects non-http URLs and unknown fields", () => {
    expect(() => createChangeItem({ ...base, url: "javascript:alert(1)" })).toThrow();
    expect(() => createChangeItem({ ...base, field: "price" })).toThrow();
  });

  it("approves a draft, and editing an approved item sends it back to draft", () => {
    const item = listChangeItems()[0]!;
    const approved = approveChangeItem(item.id, { expectedUpdatedAt: item.updatedAt });
    expect(approved).toMatchObject({ status: "approved" });
    expect(approved.approvedAt).not.toBeNull();
    const edited = updateChangeItem(item.id, { proposedValue: "채널톡 | 고객 상담 채팅", expectedUpdatedAt: approved.updatedAt });
    expect(edited).toMatchObject({ status: "draft", approvedAt: null });
  });

  it("rejects stale writes", () => {
    const item = listChangeItems()[0]!;
    expect(() => updateChangeItem(item.id, { rationale: "다른 근거", expectedUpdatedAt: "2000-01-01T00:00:00.000Z" })).toThrow();
  });

  it("only delivers approved items", () => {
    const item = listChangeItems()[0]!;
    expect(() => markDelivered(item.id, { method: "manual" })).toThrow(expect.objectContaining({ code: "CHANGE_NOT_APPROVED" }));
    const approved = approveChangeItem(item.id, { expectedUpdatedAt: item.updatedAt });
    expect(markDelivered(approved.id, { method: "manual" })).toMatchObject({ status: "delivered", deliveryMethod: "manual" });
  });

  it("flags a conflict when the live value changed after drafting; unchanged values keep their status", () => {
    const fresh = createChangeItem({ ...base, url: "https://example.com/blog" });
    expect(reportCurrentValue(fresh.id, "회사 소개").status).toBe("draft");
    const conflicted = reportCurrentValue(fresh.id, "다른 사람이 바꾼 제목");
    expect(conflicted).toMatchObject({ status: "conflict" });
    const approvedFresh = createChangeItem({ ...base, url: "https://example.com/faq" });
    approveChangeItem(approvedFresh.id, { expectedUpdatedAt: approvedFresh.updatedAt });
    expect(reportCurrentValue(approvedFresh.id, "달라진 값").status).toBe("conflict");
    expect(() => approveChangeItem(approvedFresh.id, { expectedUpdatedAt: listChangeItems().find((row) => row.id === approvedFresh.id)!.updatedAt })).toThrow(expect.objectContaining({ code: "CHANGE_CONFLICT" }));
  });

  it("keeps items project-scoped and deletes with optimistic locking", () => {
    const item = listChangeItems()[0]!;
    createProject({ name: "다른 프로젝트", brandName: "다른", category: "", competitors: [], activate: true });
    expect(listChangeItems()).toEqual([]);
    expect(() => deleteChangeItem(item.id, { expectedUpdatedAt: item.updatedAt })).toThrow();
  });
});
