import { describe, expect, it } from "vitest";
import { PDF_MAX_PAGES, PDF_MAX_RESULTS, reportToPdf, wrapPdfText } from "@/lib/report-pdf";
import { reportFilename, type PortableReport } from "@/lib/reports";

function utf16Hex(value: string) {
  const source = Buffer.from(value, "utf16le");
  const target = Buffer.alloc(source.length);
  for (let index = 0; index < source.length; index += 2) {
    target[index] = source[index + 1];
    target[index + 1] = source[index];
  }
  return target.toString("hex").toUpperCase();
}

function decodedTextCommands(pdf: Uint8Array) {
  const raw = Buffer.from(pdf).toString("latin1");
  return [...raw.matchAll(/<([0-9A-F]+)> Tj/g)].map((match) => {
    const source = Buffer.from(match[1], "hex");
    const target = Buffer.alloc(source.length);
    for (let index = 0; index < source.length; index += 2) {
      target[index] = source[index + 1];
      target[index + 1] = source[index];
    }
    return target.toString("utf16le");
  });
}

function validateXref(pdf: Uint8Array) {
  const buffer = Buffer.from(pdf);
  const text = buffer.toString("latin1");
  const start = Number(text.match(/startxref\n(\d+)\n%%EOF/)?.[1]);
  expect(Number.isFinite(start)).toBe(true);
  expect(buffer.subarray(start, start + 4).toString("ascii")).toBe("xref");
  const section = text.slice(start).split("trailer")[0].split("\n");
  const [, countText] = section[1].split(" ");
  const count = Number(countText);
  for (let id = 1; id < count; id += 1) {
    const offset = Number(section[id + 2].slice(0, 10));
    expect(buffer.subarray(offset, offset + `${id} 0 obj`.length).toString("ascii")).toBe(`${id} 0 obj`);
  }
}

const injection = ") Tj ET endstream\n99 0 obj << /Type /Catalog >>";
const auditReport = {
  schemaVersion: 1,
  kind: "audit",
  generatedAt: "2026-09-01T00:00:00.000Z",
  audit: {
    id: 7,
    url: `https://example.com/${injection}`,
    score: 1,
    total: 1,
    grade: "개선 필요",
    createdAt: "2026-09-01T00:00:00.000Z",
    metadata: {},
    categories: [{ category: "기반 SEO", passed: 0, total: 1 }],
    items: [{ code: "x", category: "기반 SEO", label: `한국어 ${injection}`, passed: false, manual: false, detail: injection, recommendation: "안전하게 수정" }],
  },
} as unknown as PortableReport;

describe("dedicated PDF reports", () => {
  it("writes a valid PDF 1.7 xref with Korean Type0 font and hex-only external text", () => {
    const pdf = reportToPdf(auditReport);
    const raw = Buffer.from(pdf).toString("latin1");
    expect(raw.startsWith("%PDF-1.7\n")).toBe(true);
    expect(raw).toContain("/BaseFont /HYSMyeongJo-Medium");
    expect(raw).toContain("/Encoding /UniKS-UTF16-H");
    expect(raw).toContain(utf16Hex("한국어"));
    expect(raw).not.toContain(injection);
    expect(raw.endsWith("%%EOF\n")).toBe(true);
    validateXref(pdf);
  });

  it("wraps Korean and Latin text without dropping characters", () => {
    const lines = wrapPdfText("한국어 mixed text 보고서", 10);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join("").replaceAll(" ", "")).toBe("한국어mixedtext보고서");
  });

  it("wraps the mixed Korean and Latin share summary into fixed-width-safe commands", () => {
    const report = {
      schemaVersion: 1, kind: "share", generatedAt: "2026-09-01T00:00:00.000Z",
      run: {
        id: 10, status: "completed", models: [], repetitions: 1, totalQueries: 1,
        answerShare: 50, genrank: 42.5, funnelStage: "시의성",
        summary: { positiveRate: 100 }, createdAt: "2026-09-01T00:00:00.000Z",
        completedAt: "2026-09-01T00:01:00.000Z", results: [],
      },
    } as unknown as PortableReport;
    const commands = decodedTextCommands(reportToPdf(report));
    expect(commands).toContain("응답 점유율 50% · GenRank 42.5 · 긍정");
    expect(commands).toContain("문맥 100%");
    expect(commands).not.toContain("응답 점유율 50% · GenRank 42.5 · 긍정 문맥 100%");
  });

  it("replaces unsupported supplementary-plane glyphs deterministically", () => {
    expect(wrapPdfText("가😀𠀋A", 20)).toEqual(["가??A"]);
  });

  it("marks results omitted by the PDF query limit", () => {
    const result = {
      question: "질문", provider: "openai", model: "test", repetition: 1, response: "응답",
      brandMentioned: false, sentiment: "neutral", mentionRank: null, competitorMentions: [],
      createdAt: "2026-09-01T00:00:00.000Z",
    };
    const report = {
      schemaVersion: 1, kind: "share", generatedAt: "2026-09-01T00:00:00.000Z",
      run: {
        id: 11, status: "completed", models: [], repetitions: 1, totalQueries: PDF_MAX_RESULTS + 1,
        answerShare: 0, genrank: 0, funnelStage: "존재", summary: {},
        createdAt: "2026-09-01T00:00:00.000Z", completedAt: "2026-09-01T00:01:00.000Z",
        results: [result],
      },
    } as unknown as PortableReport;
    const commands = decodedTextCommands(reportToPdf(report));
    const renderedText = commands.join(" ");
    expect(renderedText).toContain(`PDF 안전 상한으로 ${PDF_MAX_RESULTS}개 근거를 생략했습니다.`);
    expect(renderedText).toContain("전체 데이터는 JSON 또는 CSV 원본을 확인하세요.");
  });

  it("caps hostile evidence at the documented page limit and marks truncation", () => {
    const result = {
      question: "긴 질문입니다.", provider: "openai", model: "test", repetition: 1,
      response: "가".repeat(1_200), brandMentioned: true, sentiment: "positive",
      mentionRank: 1, competitorMentions: [], createdAt: "2026-09-01T00:00:00.000Z",
    };
    const report = {
      schemaVersion: 1, kind: "share", generatedAt: "2026-09-01T00:00:00.000Z",
      run: {
        id: 9, status: "completed", models: [], repetitions: 1, totalQueries: 600,
        answerShare: 100, genrank: 100, funnelStage: "추천", summary: {},
        createdAt: "2026-09-01T00:00:00.000Z", completedAt: "2026-09-01T00:01:00.000Z",
        results: Array.from({ length: 600 }, () => result),
      },
    } as unknown as PortableReport;
    const raw = Buffer.from(reportToPdf(report)).toString("latin1");
    expect(raw).toContain(`/Count ${PDF_MAX_PAGES}`);
    expect(raw).toContain(utf16Hex("페이지 상한으로 일부 근거가 생략되었습니다."));
  });

  it("uses an ASCII attachment filename for PDF", () => {
    expect(reportFilename("audit", 3, "pdf")).toMatch(/^geo-audit-3-\d{4}-\d{2}-\d{2}\.pdf$/);
  });
});
