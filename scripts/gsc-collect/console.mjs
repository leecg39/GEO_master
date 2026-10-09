// 전용 Chrome 프로필로 Search Console 실적 화면의 "내보내기 → Excel 다운로드"를 수행한다.
// 사용자가 매일 쓰는 브라우저는 건드리지 않는다. 로그인은 사람이 --login으로 한 번만 직접 한다.
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import { exportFileName, isGoogleLoginUrl, performanceUrl, propertyMismatch, validateDownload } from "./lib.mjs";

export class CollectError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const EXPORT_BUTTON = /^(내보내기|export)$/i;
const EXCEL_ITEM = /^(excel 다운로드|download excel)$/i;

/** 전용 프로필로 Chrome을 띄운다. 자동화 배너 플래그는 빼서 일반 프로필과 같은 쿠키·세션을 쓴다 */
export async function openProfile(profileDir, { headless = true, chromePath } = {}) {
  await fs.mkdir(profileDir, { recursive: true, mode: 0o700 });
  try {
    return await chromium.launchPersistentContext(profileDir, {
      ...(chromePath ? { executablePath: chromePath } : { channel: "chrome" }),
      headless,
      acceptDownloads: true,
      ignoreDefaultArgs: ["--enable-automation"],
      locale: "ko-KR",
      viewport: { width: 1440, height: 900 },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/ProcessSingleton|SingletonLock|already in use|user data directory is already in use/i.test(message)) {
      throw new CollectError("PROFILE_IN_USE", `전용 프로필(${profileDir})이 다른 Chrome 창에서 열려 있습니다. --login 창을 닫은 뒤 다시 실행하세요.`);
    }
    throw new CollectError("BROWSER_LAUNCH_FAILED", `Chrome을 실행하지 못했습니다: ${message.split("\n")[0]}`);
  }
}

async function firstOf(page, exportButton, timeoutMs) {
  // 어느 쪽이 먼저 오든 나머지 대기의 거부가 처리되지 않은 채 남지 않도록 각각 결과값으로 바꾼다
  return Promise.race([
    exportButton.waitFor({ state: "visible", timeout: timeoutMs }).then(() => "ready", () => "timeout"),
    page.waitForURL((url) => isGoogleLoginUrl(url.toString()), { timeout: timeoutMs }).then(() => "login", () => "timeout"),
  ]);
}

/**
 * 속성 하나의 실적 보고서를 Excel로 내려받아 runDir에 저장한다.
 * 로그인 만료·다른 속성으로 이동·메뉴 없음은 각각 다른 코드로 실패시킨다(빈 데이터로 기록하지 않음).
 */
export async function exportProperty(page, property, { runDir, date, consoleBase, timeoutMs = 45_000 }) {
  await page.goto(performanceUrl(property.resourceId, consoleBase), { waitUntil: "domcontentloaded", timeout: timeoutMs });
  const exportButton = page.getByRole("button", { name: EXPORT_BUTTON }).first();
  const state = await firstOf(page, exportButton, timeoutMs);
  if (state === "login" || isGoogleLoginUrl(page.url())) {
    throw new CollectError("NOT_LOGGED_IN", "전용 프로필의 Google 로그인이 없거나 만료되었습니다. `npm run gsc:login`으로 직접 로그인한 뒤 다시 실행하세요.");
  }
  if (propertyMismatch(page.url(), property.resourceId)) {
    throw new CollectError("PROPERTY_UNAVAILABLE", `콘솔이 요청한 속성(${property.resourceId}) 대신 다른 화면을 보여 줍니다. 로그인한 계정에 이 속성 권한이 있는지 확인하세요.`);
  }
  if (state !== "ready") throw new CollectError("EXPORT_BUTTON_NOT_FOUND", "실적 화면에서 '내보내기' 버튼을 찾지 못했습니다. 콘솔 화면 구성이 바뀌었을 수 있습니다.");

  await exportButton.click({ timeout: 15_000 });
  const excelItem = page.getByRole("menuitem", { name: EXCEL_ITEM }).first();
  try {
    await excelItem.waitFor({ state: "visible", timeout: 15_000 });
  } catch {
    throw new CollectError("EXPORT_MENU_NOT_FOUND", "'Excel 다운로드' 메뉴를 찾지 못했습니다. 콘솔 화면 구성이 바뀌었을 수 있습니다.");
  }
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: timeoutMs }), excelItem.click()]);
  const failure = await download.failure();
  if (failure) throw new CollectError("DOWNLOAD_FAILED", `내려받기에 실패했습니다: ${failure}`);

  await fs.mkdir(runDir, { recursive: true, mode: 0o700 });
  const file = path.join(runDir, exportFileName(property.label, date, property.resourceId));
  await download.saveAs(file);
  await fs.chmod(file, 0o600);
  const bytes = new Uint8Array(await fs.readFile(file));
  try {
    validateDownload(bytes);
  } catch (error) {
    throw new CollectError("INVALID_DOWNLOAD", error instanceof Error ? error.message : String(error));
  }
  return { file, bytes };
}
