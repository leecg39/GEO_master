import { describe, expect, it } from "vitest";
import type { ChangeReport } from "@/lib/change-report";
import { changeReportToPdf } from "@/lib/change-report-pdf";

function texts(pdf: Uint8Array) {
  const raw = Buffer.from(pdf).toString("latin1");
  return [...raw.matchAll(/<([0-9A-F]+)> Tj/g)].map((match) => {
    const source = Buffer.from(match[1]!, "hex");
    const target = Buffer.alloc(source.length);
    for (let index = 0; index < source.length; index += 2) { target[index] = source[index + 1]!; target[index + 1] = source[index]!; }
    return target.toString("utf16le");
  }).join("\n");
}

const item = (overrides: Partial<ChangeReport["items"][number]> = {}): ChangeReport["items"][number] => ({
  id: 1, url: "https://example.com/a", field: "title", status: "verification_pending", originalValue: "", proposedValue: "새 제목",
  wordpressValue: "새 제목", wordpressMatched: true, publicValue: "옛 제목", lastCheckedAt: "2026-10-13T01:00:00.000Z", lastHttpStatus: 200,
  lastResult: "pending", lastFinalUrl: "https://example.com/elsewhere", finalUrlMismatch: true, deliveryMethod: "wordpress",
  deliveredAt: "2026-10-13T00:00:00.000Z", updatedAt: "2026-10-13T00:00:00.000Z", history: [], ...overrides,
});
const report = (items = [item()]): ChangeReport => ({
  schemaVersion: 1, kind: "changes", generatedAt: "2026-10-13T02:00:00.000Z", scope: { url: "https://example.com/a", ids: null },
  kpi: { total: items.length, draft: 0, approved: 0, delivered: 0, pending: 1, verified: 0, conflict: 0, failed: 0 },
  items, actions: [{ id: 1, url: "https://example.com/a", field: "title", kind: "pending", message: "WordPress에는 저장됐지만 공개 페이지에는 아직 보이지 않습니다." }],
  reaudits: [{ url: "https://example.com/a", before: { id: 3, score: 18, createdAt: "2026-10-01T00:00:00.000Z" }, after: null }],
});

describe("change report PDF (R10)", () => {
  it("is a valid PDF with the same facts as the Markdown report", () => {
    const pdf = changeReportToPdf(report());
    expect(Buffer.from(pdf.subarray(0, 5)).toString("ascii")).toBe("%PDF-");
    const text = texts(pdf);
    for (const expected of ["수정 결과 보고서", "빈 값 또는 기록 없음", "새 제목", "옛 제목", "WordPress 저장값", "확인 주소가 수정안 주소와 다릅니다", "WordPress에는 저장됐지만", "수정 이후 진단이 없어", "추정 향상치"]) {
      expect(text, expected).toContain(expected);
    }
  });

  it("caps very long values and many items", () => {
    const many = Array.from({ length: 400 }, (_, index) => item({ id: index + 1, proposedValue: "가".repeat(3_000) }));
    const pdf = changeReportToPdf(report(many));
    expect(pdf.byteLength).toBeLessThan(12 * 1024 * 1024);
    expect(texts(pdf)).not.toContain("가".repeat(600));
  });
});
