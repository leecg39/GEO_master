import { strToU8, zipSync } from "fflate";

/** 테스트용 최소 xlsx 생성기 — 시트 이름과 2차원 문자열 배열로 구성 (숫자는 문자열로 넣어 콘솔 내보내기와 같은 모양) */
export function buildXlsx(sheets: Record<string, string[][]>, options: { sharedStrings?: boolean } = {}) {
  const names = Object.keys(sheets);
  const files: Record<string, Uint8Array> = {};
  const shared: string[] = [];
  const col = (index: number) => String.fromCharCode(65 + index);
  names.forEach((name, i) => {
    const rows = sheets[name]!.map((row, r) => `<row r="${r + 1}">${row.map((cell, c) => {
      if (options.sharedStrings === false) return `<c r="${col(c)}${r + 1}" t="inlineStr"><is><t>${cell}</t></is></c>`;
      let index = shared.indexOf(cell);
      if (index < 0) { shared.push(cell); index = shared.length - 1; }
      return `<c r="${col(c)}${r + 1}" t="s"><v>${index}</v></c>`;
    }).join("")}</row>`).join("");
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(`<?xml version="1.0"?><worksheet xmlns="${MAIN_NS}"><sheetData>${rows}</sheetData></worksheet>`);
  });
  files["xl/workbook.xml"] = workbookXml(names.map((name, i) => [name, `rId${i + 1}`]));
  files["xl/_rels/workbook.xml.rels"] = relsXml(names.map((_, i) => [`rId${i + 1}`, `worksheets/sheet${i + 1}.xml`]));
  if (options.sharedStrings !== false) {
    files["xl/sharedStrings.xml"] = strToU8(`<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${shared.map((text) => `<si><t>${text}</t></si>`).join("")}</sst>`);
  }
  return Buffer.from(zipSync(files));
}

const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const WORKSHEET_TYPE = `${REL_NS}/worksheet`;

function workbookXml(sheets: Array<[name: string, relId: string]>) {
  return strToU8(`<?xml version="1.0"?><workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><sheets>${sheets.map(([name, relId], i) => `<sheet name="${name}" sheetId="${i + 1}" r:id="${relId}"/>`).join("")}</sheets></workbook>`);
}

function relsXml(rels: Array<[id: string, target: string, mode?: string]>) {
  return strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.map(([id, target, mode]) => `<Relationship Id="${id}" Type="${WORKSHEET_TYPE}" Target="${target}"${mode ? ` TargetMode="${mode}"` : ""}/>`).join("")}</Relationships>`);
}

/** 인라인 문자열 셀로 된 시트 XML */
export function sheetXml(rows: string[][]) {
  const col = (index: number) => String.fromCharCode(65 + index);
  return `<?xml version="1.0"?><worksheet xmlns="${MAIN_NS}"><sheetData>${rows.map((row, r) => `<row r="${r + 1}">${row.map((cell, c) => `<c r="${col(c)}${r + 1}" t="inlineStr"><is><t>${cell}</t></is></c>`).join("")}</row>`).join("")}</sheetData></worksheet>`;
}

/** 시트 이름·관계·파트를 직접 지정하는 xlsx (관계 매핑과 거부 사례 시험용) */
export function rawWorkbook(spec: { sheets: Array<[string, string]>; rels: Array<[string, string, string?]>; parts: Record<string, string | Uint8Array> }) {
  const files: Record<string, Uint8Array> = {
    "xl/workbook.xml": workbookXml(spec.sheets),
    "xl/_rels/workbook.xml.rels": relsXml(spec.rels.map(([id, target, mode]) => [id, target, mode])),
  };
  for (const [name, content] of Object.entries(spec.parts)) files[name] = typeof content === "string" ? strToU8(content) : content;
  return Buffer.from(zipSync(files));
}
