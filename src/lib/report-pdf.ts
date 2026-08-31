import { AppError } from "./errors";
import type { PortableReport } from "./reports";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const BOTTOM = 54;
export const PDF_MAX_PAGES = 200;
export const PDF_MAX_RESULTS = 1_000;
const MAX_PDF_BYTES = 12 * 1024 * 1024;

type Color = readonly [number, number, number];
const COLORS = {
  ink: [0.09, 0.12, 0.18] as Color,
  muted: [0.38, 0.43, 0.51] as Color,
  cyan: [0.03, 0.55, 0.66] as Color,
  amber: [0.78, 0.43, 0.08] as Color,
  red: [0.75, 0.16, 0.2] as Color,
  line: [0.84, 0.86, 0.89] as Color,
  pale: [0.93, 0.95, 0.97] as Color,
};

function number(value: number) {
  const finite = Number.isFinite(value) ? value : 0;
  return Number(finite.toFixed(3)).toString();
}

function safeText(value: unknown, maxLength = 4_000) {
  const limit = Math.max(0, Math.floor(maxLength));
  const normalized = String(value ?? "")
    .slice(0, limit * 2)
    .normalize("NFC")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\r\n?/g, "\n");
  return [...normalized]
    .slice(0, limit)
    .map((character) => {
      const point = character.codePointAt(0) ?? 0;
      return point > 0xffff || (point >= 0xd800 && point <= 0xdfff) ? "?" : character;
    })
    .join("");
}

function utf16BeHex(value: string, bom = false) {
  const source = Buffer.from(safeText(value), "utf16le");
  const output = Buffer.alloc(source.length + (bom ? 2 : 0));
  let offset = 0;
  if (bom) {
    output[0] = 0xfe;
    output[1] = 0xff;
    offset = 2;
  }
  for (let index = 0; index < source.length; index += 2) {
    output[offset + index] = source[index + 1];
    output[offset + index + 1] = source[index];
  }
  return output.toString("hex").toUpperCase();
}

function units(value: string) {
  return [...value].length;
}

export function wrapPdfText(value: unknown, maxUnits: number) {
  const paragraphs = safeText(value).split("\n");
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    const characters = [...paragraph.replace(/\s+/g, " ").trim()];
    if (!characters.length) {
      lines.push("");
      continue;
    }
    let start = 0;
    while (start < characters.length) {
      let width = 0;
      let end = start;
      let lastSpace = -1;
      while (end < characters.length) {
        const next = units(characters[end]);
        if (end > start && width + next > maxUnits) break;
        width += next;
        if (characters[end] === " ") lastSpace = end;
        end += 1;
      }
      if (end < characters.length && lastSpace >= start) end = lastSpace;
      const line = characters.slice(start, Math.max(start + 1, end)).join("").trim();
      lines.push(line);
      start = Math.max(start + 1, end);
      while (characters[start] === " ") start += 1;
    }
  }
  return lines;
}

function textCommand(text: string, x: number, y: number, size: number, color: Color) {
  return `BT /F1 ${number(size)} Tf ${color.map(number).join(" ")} rg 1 0 0 1 ${number(x)} ${number(y)} Tm <${utf16BeHex(text)}> Tj ET\n`;
}

function rectCommand(x: number, y: number, width: number, height: number, color: Color) {
  return `${color.map(number).join(" ")} rg ${number(x)} ${number(y)} ${number(width)} ${number(height)} re f\n`;
}

class PdfLayout {
  private readonly pages: string[][] = [];
  private y = PAGE_HEIGHT - 58;
  truncated = false;

  constructor(private readonly title: string) {
    this.newPage();
  }

  private newPage() {
    if (this.pages.length >= PDF_MAX_PAGES) {
      this.truncated = true;
      return false;
    }
    const page: string[] = [];
    page.push(textCommand("GEO Master", MARGIN, PAGE_HEIGHT - 31, 8, COLORS.cyan));
    page.push(textCommand(this.title, PAGE_WIDTH - MARGIN - Math.min(260, units(this.title) * 8.2), PAGE_HEIGHT - 31, 8, COLORS.muted));
    page.push(rectCommand(MARGIN, PAGE_HEIGHT - 40, PAGE_WIDTH - MARGIN * 2, 0.6, COLORS.line));
    this.pages.push(page);
    this.y = PAGE_HEIGHT - 62;
    return true;
  }

  private ensure(height: number) {
    if (this.truncated) return false;
    if (this.y - height >= BOTTOM) return true;
    return this.newPage();
  }

  text(value: unknown, options: { size?: number; color?: Color; indent?: number; maxChars?: number; lineHeight?: number } = {}) {
    const size = options.size ?? 9.5;
    const color = options.color ?? COLORS.ink;
    const indent = options.indent ?? 0;
    const lineHeight = options.lineHeight ?? size * 1.45;
    const available = PAGE_WIDTH - MARGIN * 2 - indent;
    const maxUnits = Math.max(8, Math.floor(available / (size * 1.02)));
    const lines = wrapPdfText(safeText(value, options.maxChars ?? 4_000), maxUnits);
    for (const line of lines) {
      if (!this.ensure(lineHeight)) return;
      if (line) this.pages.at(-1)!.push(textCommand(line, MARGIN + indent, this.y, size, color));
      this.y -= lineHeight;
    }
  }

  space(height = 8) {
    if (this.ensure(height)) this.y -= height;
  }

  rule() {
    if (!this.ensure(12)) return;
    this.pages.at(-1)!.push(rectCommand(MARGIN, this.y, PAGE_WIDTH - MARGIN * 2, 0.6, COLORS.line));
    this.y -= 12;
  }

  section(title: string) {
    this.space(8);
    if (!this.ensure(34)) return;
    this.text(title, { size: 14, color: COLORS.ink, lineHeight: 19 });
    this.rule();
  }

  bar(label: string, passed: number, total: number) {
    if (!this.ensure(31)) return;
    const ratio = total > 0 ? Math.max(0, Math.min(1, passed / total)) : 0;
    this.text(`${label}  ${passed}/${total}`, { size: 9, color: COLORS.muted, lineHeight: 13 });
    this.pages.at(-1)!.push(rectCommand(MARGIN, this.y - 3, PAGE_WIDTH - MARGIN * 2, 6, COLORS.pale));
    this.pages.at(-1)!.push(rectCommand(MARGIN, this.y - 3, (PAGE_WIDTH - MARGIN * 2) * ratio, 6, COLORS.cyan));
    this.y -= 13;
  }

  build() {
    this.pages.forEach((page, index) => {
      page.push(rectCommand(MARGIN, 38, PAGE_WIDTH - MARGIN * 2, 0.5, COLORS.line));
      page.push(textCommand(`GEO Master · ${index + 1}/${this.pages.length}`, MARGIN, 24, 7.5, COLORS.muted));
    });
    if (this.truncated) {
      this.pages.at(-1)!.push(textCommand("페이지 상한으로 일부 근거가 생략되었습니다. JSON 또는 CSV 원본을 확인하세요.", MARGIN, 43, 7.5, COLORS.red));
    }
    return buildPdfBytes(this.pages, this.title);
  }
}

function pdfDate(date = new Date()) {
  const digits = date.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return `D:${digits}Z`;
}

function buildPdfBytes(pages: string[][], title: string) {
  const objects = new Map<number, Buffer>();
  const fontId = 4;
  const cidFontId = 5;
  const pageIds = pages.map((_, index) => 6 + index * 2);
  const contentIds = pages.map((_, index) => 7 + index * 2);

  objects.set(1, Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "ascii"));
  objects.set(2, Buffer.from(`<< /Type /Pages /Count ${pages.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`, "ascii"));
  objects.set(3, Buffer.from(`<< /Title <${utf16BeHex(title, true)}> /Author <${utf16BeHex("GEO Master", true)}> /Subject <${utf16BeHex("GEO 진단 및 응답 점유율 보고서", true)}> /CreationDate (${pdfDate()}) >>`, "ascii"));
  objects.set(fontId, Buffer.from(`<< /Type /Font /Subtype /Type0 /BaseFont /HYSMyeongJo-Medium /Encoding /UniKS-UTF16-H /DescendantFonts [${cidFontId} 0 R] >>`, "ascii"));
  objects.set(cidFontId, Buffer.from("<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HYSMyeongJo-Medium /CIDSystemInfo << /Registry (Adobe) /Ordering (Korea1) /Supplement 2 >> /DW 1000 >>", "ascii"));

  pages.forEach((commands, index) => {
    const content = Buffer.from(commands.join(""), "ascii");
    objects.set(pageIds[index], Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${number(PAGE_WIDTH)} ${number(PAGE_HEIGHT)}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentIds[index]} 0 R >>`, "ascii"));
    objects.set(contentIds[index], Buffer.concat([
      Buffer.from(`<< /Length ${content.length} >>\nstream\n`, "ascii"),
      content,
      Buffer.from("endstream", "ascii"),
    ]));
  });

  const maximumId = Math.max(...objects.keys());
  const header = Buffer.concat([Buffer.from("%PDF-1.7\n", "ascii"), Buffer.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])]);
  const chunks: Buffer[] = [header];
  const offsets = new Array<number>(maximumId + 1).fill(0);
  let offset = header.length;
  for (let id = 1; id <= maximumId; id += 1) {
    const body = objects.get(id);
    if (!body) throw new AppError("PDF 객체 구성이 올바르지 않습니다.", 500, "PDF_RENDER_FAILED");
    const object = Buffer.concat([Buffer.from(`${id} 0 obj\n`, "ascii"), body, Buffer.from("\nendobj\n", "ascii")]);
    offsets[id] = offset;
    chunks.push(object);
    offset += object.length;
  }
  const xrefOffset = offset;
  const xref = ["xref", `0 ${maximumId + 1}`, "0000000000 65535 f ", ...offsets.slice(1).map((entry) => `${entry.toString().padStart(10, "0")} 00000 n `)].join("\n");
  chunks.push(Buffer.from(`${xref}\ntrailer\n<< /Size ${maximumId + 1} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`, "ascii"));
  const pdf = Buffer.concat(chunks);
  if (pdf.length > MAX_PDF_BYTES) throw new AppError("PDF가 안전한 출력 크기를 초과했습니다.", 413, "PDF_TOO_LARGE");
  return new Uint8Array(pdf);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numeric(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function auditTemplate(report: Extract<PortableReport, { kind: "audit" }>) {
  const document = new PdfLayout("GEO 진단 리포트");
  document.text("GEO 진단 리포트", { size: 24, color: COLORS.ink, lineHeight: 31 });
  document.text(report.audit.url, { size: 9, color: COLORS.cyan, maxChars: 1_000 });
  document.text(`진단 #${report.audit.id} · ${report.audit.createdAt} · 생성 ${report.generatedAt}`, { size: 8, color: COLORS.muted });
  document.space(16);
  document.text(`${report.audit.score} / ${report.audit.total} · ${report.audit.grade}`, { size: 20, color: report.audit.grade === "우수" ? COLORS.cyan : COLORS.amber, lineHeight: 28 });

  document.section("카테고리 점수");
  for (const category of report.audit.categories) document.bar(category.category, category.passed, category.total);

  const failed = report.audit.items.filter((item) => !item.passed);
  document.section(`우선 개선 항목 (${failed.length})`);
  if (!failed.length) document.text("자동 진단에서 미통과 항목이 없습니다.", { color: COLORS.muted });
  for (const [index, item] of failed.entries()) {
    if (document.truncated) break;
    document.text(`${index + 1}. ${item.label} · ${item.category}${item.manual ? " · 수동 확인" : ""}`, { size: 11, color: COLORS.ink, maxChars: 500, lineHeight: 16 });
    document.text(`진단: ${item.detail}`, { size: 8.5, color: COLORS.muted, indent: 10, maxChars: 1_200 });
    document.text(`권고: ${item.recommendation}`, { size: 8.5, color: COLORS.amber, indent: 10, maxChars: 1_200 });
    document.space(7);
  }

  document.section("전체 검사 항목");
  for (const item of report.audit.items) {
    if (document.truncated) break;
    document.text(`${item.passed ? "통과" : "미통과"} · ${item.category} · ${item.label}`, { size: 8.5, color: item.passed ? COLORS.cyan : COLORS.red, maxChars: 600 });
  }
  return document.build();
}

function shareTemplate(report: Extract<PortableReport, { kind: "share" }>) {
  const document = new PdfLayout("응답 점유율 리포트");
  const summary = asRecord(report.run.summary);
  document.text("응답 점유율 리포트", { size: 24, color: COLORS.ink, lineHeight: 31 });
  document.text(`측정 #${report.run.id} · ${report.run.createdAt} · 완료 ${report.run.completedAt ?? "-"}`, { size: 8, color: COLORS.muted });
  document.space(13);
  document.text(`응답 점유율 ${report.run.answerShare}%  ·  GenRank ${report.run.genrank}  ·  긍정 문맥 ${numeric(summary.positiveRate)}%`, { size: 15, color: COLORS.cyan, lineHeight: 23 });
  document.text(`퍼널 단계 ${report.run.funnelStage} · 총 ${report.run.totalQueries}회`, { size: 10, color: COLORS.ink });

  document.section("모델별 점유율");
  const perModel = asRecord(summary.perModel);
  if (!Object.keys(perModel).length) document.text("모델별 집계가 없습니다.", { color: COLORS.muted });
  for (const [provider, rawMetric] of Object.entries(perModel)) {
    const metric = asRecord(rawMetric);
    document.bar(provider, numeric(metric.mentions), numeric(metric.total));
    document.text(`점유율 ${numeric(metric.share).toFixed(1)}%`, { size: 8, color: COLORS.muted, indent: 10 });
  }

  document.section("경쟁사 비교");
  const competitors = Array.isArray(summary.competitorComparison) ? summary.competitorComparison : [];
  if (!competitors.length) document.text("비교할 경쟁사 집계가 없습니다.", { color: COLORS.muted });
  for (const raw of competitors) {
    const competitor = asRecord(raw);
    document.text(`${safeText(competitor.name, 200)} · ${numeric(competitor.share).toFixed(1)}% · ${numeric(competitor.mentions)}회`, { size: 9 });
  }

  const omittedResults = Math.max(0, report.run.totalQueries - report.run.results.length);
  document.section(`질문별 측정 근거 (${report.run.results.length}${omittedResults ? ` / 전체 ${report.run.totalQueries}` : ""})`);
  if (omittedResults) {
    document.text(`PDF 안전 상한으로 ${omittedResults}개 근거를 생략했습니다. 전체 데이터는 JSON 또는 CSV 원본을 확인하세요.`, { size: 8, color: COLORS.red });
  }
  for (const [index, item] of report.run.results.entries()) {
    if (document.truncated) break;
    document.text(`${index + 1}. [${item.provider} / ${item.model}] ${item.question}`, { size: 10.5, color: COLORS.ink, maxChars: 900, lineHeight: 15 });
    document.text(`브랜드 ${item.brandMentioned ? `언급 · ${item.mentionRank ?? "-"}위` : "미언급"} · 문맥 ${item.sentiment} · 반복 ${item.repetition}`, { size: 8.5, color: item.brandMentioned ? COLORS.cyan : COLORS.muted, indent: 10 });
    if (item.competitorMentions.length) document.text(`경쟁사 언급: ${item.competitorMentions.join(", ")}`, { size: 8, color: COLORS.amber, indent: 10, maxChars: 500 });
    document.text(`응답 근거: ${item.response}`, { size: 8, color: COLORS.muted, indent: 10, maxChars: 1_200, lineHeight: 11 });
    document.space(8);
  }
  return document.build();
}

export function reportToPdf(report: PortableReport) {
  return report.kind === "audit" ? auditTemplate(report) : shareTemplate(report);
}
