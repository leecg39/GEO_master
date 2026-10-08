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
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(`<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`);
  });
  files["xl/workbook.xml"] = strToU8(`<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets>${names.map((name, i) => `<sheet name="${name}" sheetId="${i + 1}"/>`).join("")}</sheets></workbook>`);
  if (options.sharedStrings !== false) {
    files["xl/sharedStrings.xml"] = strToU8(`<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${shared.map((text) => `<si><t>${text}</t></si>`).join("")}</sst>`);
  }
  return Buffer.from(zipSync(files));
}
