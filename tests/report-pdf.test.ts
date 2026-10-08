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

  it("prints denominator evidence and slot status for versioned runs", () => {
    const report = {
      schemaVersion: 1, kind: "share", generatedAt: "2026-09-01T00:00:00.000Z",
      run: {
        id: 11, status: "completed", models: [], repetitions: 1, totalQueries: 2,
        answerShare: 100, genrank: 100, funnelStage: "추천",
        summary: {
          metricVersion: "m1.0",
          quality: { planned: 2, succeeded: 1, refused: 1, failed: 0, completionRate: { numerator: 2, denominator: 2, value: 100 }, refusalRate: { numerator: 1, denominator: 2, value: 50 } },
          questionMatrix: [{ question: "Q1", provider: "openai", mentioned: 1, valid: 1, refused: 1, failed: 0, planned: 2, label: "1/1" }],
        },
        createdAt: "2026-09-01T00:00:00.000Z", completedAt: "2026-09-01T00:01:00.000Z",
        results: [{ question: "Q1", provider: "openai", model: "m", repetition: 2, response: "거절", brandMentioned: false, sentiment: "neutral", mentionRank: null, competitorMentions: [], slotStatus: "refused", createdAt: "2026-09-01T00:00:00.000Z" }],
      },
    } as unknown as PortableReport;
    const commands = decodedTextCommands(reportToPdf(report)).join("\n");
    expect(commands).toContain("분모 근거 (산식 m1.0)");
    expect(commands).toContain("수집 완료율 100% (2/2)");
    expect(commands).toContain("Q1 · openai 1/1");
    expect(commands).toContain("명시 거절");
  });

  it("prints citation evidence for web-search runs", () => {
    const report = {
      schemaVersion: 1, kind: "share", generatedAt: "2026-09-01T00:00:00.000Z",
      run: {
        id: 12, status: "completed", models: [], repetitions: 1, totalQueries: 1, answerShare: 0, genrank: 0, funnelStage: "존재",
        summary: {
          metricVersion: "m1.0", searchMode: "web",
          citations: {
            ownCitationCoverage: { numerator: 0, denominator: 1, value: 0 }, perProvider: { openai: { numerator: 0, denominator: 1, value: 0 } },
            citedByCategory: { competitor: 1 }, searchedCount: 2, topDomains: [{ domain: "rival.example", category: "competitor", count: 1 }],
            pagesCitedWithoutBrand: [{ url: "https://rival.example/p", domain: "rival.example", category: "competitor", count: 1 }],
          },
        },
        createdAt: "2026-09-01T00:00:00.000Z", completedAt: "2026-09-01T00:01:00.000Z", results: [],
      },
    } as unknown as PortableReport;
    const commands = decodedTextCommands(reportToPdf(report)).join("\n");
    expect(commands).toContain("인용 출처 분석");
    expect(commands).toContain("자사 인용 커버리지 0% (0/1)");
    expect(commands).toContain("https://rival.example/p");
  });

  it("prints diagnostic cards and claim verdict counts", () => {
    const report = {
      schemaVersion: 1, kind: "share", generatedAt: "2026-09-01T00:00:00.000Z",
      run: {
        id: 13, status: "completed", models: [], repetitions: 1, totalQueries: 1, answerShare: 50, genrank: 40, funnelStage: "맥락",
        summary: { metricVersion: "m1.0" }, createdAt: "2026-09-01T00:00:00.000Z", completedAt: "2026-09-01T00:01:00.000Z", results: [],
        diagnostics: {
          cards: [{ card: "맥락", verdict: "issue", rationale: "주장 일치 2건, 충돌 1건" }],
          claimCounts: { match: 2, conflict: 1, insufficient: 0, timeUnknown: 0, needsReview: 0 },
        },
      },
    } as unknown as PortableReport;
    const commands = decodedTextCommands(reportToPdf(report)).join("\n");
    expect(commands).toContain("진단 카드");
    expect(commands).toContain("맥락 · 문제 · 주장 일치 2건, 충돌 1건");
    expect(commands).toContain("일치 2 · 충돌 1");
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
