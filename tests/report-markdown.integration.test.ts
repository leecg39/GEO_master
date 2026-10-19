import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const auditHtml = `<!doctype html><html lang="ko"><head><title>마크다운 보고서 문서</title>
  <script type="application/ld+json">{"@type":"Product","name":"상품"}</script></head>
  <body><main><h1>보고서</h1><p>마크다운 보고서 통합 테스트를 위한 충분한 길이의 첫 문단입니다. | 파이프 <script>x</script></p></main></body></html>`;

vi.mock("@/lib/url-security", () => ({
  fetchPublicText: vi.fn(async (url: string) => url.endsWith("robots.txt") || url.endsWith("llms.txt") || url.endsWith("sitemap.xml")
    ? { url, status: 404, text: "", contentType: "text/plain" }
    : { url, status: 200, text: auditHtml, contentType: "text/html; charset=utf-8" }),
}));

import { POST as createAudit } from "@/app/api/audits/route";
import { GET as getReport } from "@/app/api/reports/route";
import { createChangeItem } from "@/lib/change-items";
import { closeDatabase, getDatabase } from "@/lib/db";
import { ensureActiveProject } from "@/lib/projects";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-report-md-"));
const databasePath = path.join(tempDir, "report.db");
const previousDb = process.env.GEO_DB_PATH;
const previousKey = process.env.GEO_MASTER_KEY;
let auditId: number;

const report = (query: string) => getReport(new NextRequest(`http://localhost/api/reports?${query}`));

beforeAll(async () => {
  // 실제 LLM 호출을 막는다 — 진단은 규칙 기반 시맨틱 엔진으로만 돈다
  for (const name of ["GUDOKPIN_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GROK_API_KEY", "XAI_API_KEY"]) vi.stubEnv(name, "");
  process.env.GEO_DB_PATH = databasePath;
  process.env.GEO_MASTER_KEY = "report-markdown-integration-master-key-32";
  ensureActiveProject();
  const response = await createAudit(new NextRequest("http://localhost/api/audits", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://example.com/report", title: "보고서" }),
  }));
  expect(response.status).toBe(201);
  auditId = (await response.json() as { audit: { id: number } }).audit.id;
  createChangeItem({ url: "https://example.com/report", field: "description", originalValue: "", proposedValue: "새 설명 | 파이프", rationale: "", evidenceUrl: null });
  createChangeItem({ url: "https://example.com/other", field: "title", originalValue: "a", proposedValue: "다른 URL 수정안", rationale: "", evidenceUrl: null });
});

afterAll(() => {
  vi.unstubAllEnvs();
  closeDatabase(databasePath);
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (previousDb === undefined) delete process.env.GEO_DB_PATH; else process.env.GEO_DB_PATH = previousDb;
  if (previousKey === undefined) delete process.env.GEO_MASTER_KEY; else process.env.GEO_MASTER_KEY = previousKey;
});

describe.sequential("GET /api/reports?format=md", () => {
  it("downloads the audit as UTF-8 Markdown without a BOM", async () => {
    const response = await report(`type=audit&format=md&id=${auditId}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(response.headers.get("content-disposition")).toMatch(new RegExp(`^attachment; filename="geo-audit-${auditId}-\\d{4}-\\d{2}-\\d{2}\\.md"$`));
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const bytes = new Uint8Array(await response.clone().arrayBuffer());
    expect([...bytes.slice(0, 3)]).not.toEqual([0xef, 0xbb, 0xbf]);
    const text = await response.text();
    expect(text.startsWith("# GEO 진단 보고서")).toBe(true);
  });

  it("includes the page snapshot findings and only this URL's change items", async () => {
    const text = await (await report(`type=audit&format=md&id=${auditId}`)).text();
    expect(text).toMatch(/규칙 page-rules\/\d/);
    expect(text).toContain("schema-required");
    expect(text).toContain("새 설명 \\| 파이프");
    expect(text).not.toContain("다른 URL 수정안");
    expect(text).not.toContain("<script>");
  });

  it("reports manual rules the GEO engine judged as engine results, not as unmeasured", async () => {
    const text = await (await report(`type=audit&format=md&id=${auditId}`)).text();
    const failed = text.slice(text.indexOf("## 미충족 진단 항목"), text.indexOf("## 페이지 규칙 검사"));
    const notMeasured = text.slice(text.indexOf("## 측정하지 않은 것"), text.indexOf("## AI에게 넘기는 작업 요청"));
    const row = getDatabase().sqlite.prepare("SELECT items FROM audits WHERE id = ?").get(auditId) as { items: string };
    const manual = (JSON.parse(row.items) as Array<{ label: string; manual: boolean; passed: boolean; detail: string }>).filter((item) => item.manual);
    expect(manual.length).toBeGreaterThan(0);
    for (const item of manual.filter((entry) => !entry.passed && entry.detail !== "수동 확인 필요")) {
      expect(failed).toContain(`${item.label} (GEO 엔진 판정)`);
      expect(notMeasured).not.toContain(item.label);
    }
  });

  it("never copies audit metadata such as secrets into the document", async () => {
    getDatabase().sqlite.prepare("UPDATE audits SET metadata = json_set(metadata, '$.apiKey', 'sk-live-should-not-leak', '$.engine', 'secret-engine-config') WHERE id = ?").run(auditId);
    const text = await (await report(`type=audit&format=md&id=${auditId}`)).text();
    expect(text).not.toContain("sk-live-should-not-leak");
    expect(text).not.toContain("secret-engine-config");
  });

  it("returns 404 for a missing audit and 400 for Markdown share reports", async () => {
    expect((await report("type=audit&format=md&id=999999")).status).toBe(404);
    const share = await report("type=share&format=md");
    expect(share.status).toBe(400);
    expect((await share.json() as { code?: string }).code).toBe("REPORT_FORMAT_UNSUPPORTED");
  });

  it("keeps the JSON export unchanged", async () => {
    const response = await report(`type=audit&format=json&id=${auditId}`);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect((await response.json() as { kind: string }).kind).toBe("audit");
  });
});
