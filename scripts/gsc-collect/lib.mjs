// Search Console 콘솔 내보내기 수집기의 순수 로직(브라우저·네트워크 없음).
// @ts-check
// 일반 ESM으로 Node 22.0부터 로더 없이 실행하며 JSDoc으로 타입을 검사한다.
import { createHash } from "node:crypto";
import { z } from "zod";

export const MAX_EXPORT_BYTES = 2 * 1024 * 1024;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const RESOURCE_ID = /^(sc-creator-profile:[^\s]+|sc-domain:[a-z0-9.-]+|https?:\/\/[^\s]+)$/i;

const propertySchema = z.object({
  label: z.string().trim().min(1).max(120),
  resourceId: z.string().trim().max(300).regex(RESOURCE_ID, "Search Console 속성 식별자 형식이 아닙니다."),
}).strict();

const configSchema = z.object({
  appUrl: z.string().default("http://127.0.0.1:3000"),
  allowRemoteApp: z.boolean().default(false),
  profileDir: z.string().min(1).default("~/.geo-master/gsc-chrome-profile"),
  outDir: z.string().min(1).default("~/.geo-master/gsc-exports"),
  chromePath: z.string().min(1).optional(),
  // Google이 헤드리스 세션을 막으면 false로 바꿔 전용 창을 띄워 수집한다(일상 브라우저와는 분리)
  headless: z.boolean().default(true),
  schedule: z.object({ hour: z.number().int().min(0).max(23), minute: z.number().int().min(0).max(59) }).strict().default({ hour: 9, minute: 0 }),
  properties: z.array(propertySchema).min(1).max(20),
}).strict();

/** @typedef {z.infer<typeof propertySchema>} CollectProperty */
/** @typedef {z.infer<typeof configSchema>} CollectConfig */

/** @param {string} value @param {string} homeDir */
function expandHome(value, homeDir) {
  return value === "~" ? homeDir : value.startsWith("~/") ? `${homeDir}/${value.slice(2)}` : value;
}

/** @param {string} value @param {boolean} allowRemote */
function normalizeAppUrl(value, allowRemote) {
  /** @type {URL} */
  let url;
  try { url = new URL(value); } catch { throw new Error(`appUrl이 올바른 URL이 아닙니다: ${value}`); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("appUrl은 http 또는 https여야 합니다.");
  if (url.username || url.password) throw new Error("appUrl에 인증 정보를 넣을 수 없습니다.");
  if (!allowRemote && !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error("appUrl은 로컬 GEO Master(127.0.0.1/localhost)만 허용합니다. 원격 앱으로 보내려면 allowRemoteApp: true를 명시하세요.");
  }
  return url.origin;
}

/** 설정 파일(JSON 객체)을 검증하고 기본값·~ 경로를 채운다 */
/** @param {unknown} raw @param {{homeDir: string}} options @returns {CollectConfig} */
export function parseCollectConfig(raw, { homeDir }) {
  const parsed = configSchema.parse(raw);
  const seen = new Set();
  const resources = new Set();
  for (const item of parsed.properties) {
    const key = item.label.toLowerCase();
    if (seen.has(key)) throw new Error(`속성 이름이 중복되었습니다: ${item.label}`);
    seen.add(key);
    if (resources.has(item.resourceId)) throw new Error(`속성 식별자가 중복되었습니다: ${item.resourceId}`);
    resources.add(item.resourceId);
  }
  return {
    ...parsed,
    appUrl: normalizeAppUrl(parsed.appUrl, parsed.allowRemoteApp),
    profileDir: expandHome(parsed.profileDir, homeDir),
    outDir: expandHome(parsed.outDir, homeDir),
    chromePath: parsed.chromePath ? expandHome(parsed.chromePath, homeDir) : undefined,
  };
}

/** 잠금 파일에 기록된 프로세스가 더는 없으면 남은 잠금(강제 종료 등)으로 본다 */
/** @param {string} content @param {(pid: number) => boolean} isAlive */
export function lockIsStale(content, isAlive) {
  const pid = Number(content.trim());
  return !Number.isInteger(pid) || pid <= 0 || !isAlive(pid);
}

/** @param {string} resourceId @param {string} [base] */
export function performanceUrl(resourceId, base = "https://search.google.com") {
  return `${base}/search-console/performance/search-analytics?resource_id=${encodeURIComponent(resourceId)}`;
}

/** Google 로그인 화면이나 로그아웃 상태의 Search Console 소개 페이지(/search-console/about)인지 */
/** @param {string} value */
export function isGoogleLoginUrl(value) {
  try {
    const url = new URL(value);
    return url.hostname === "accounts.google.com" || url.pathname.startsWith("/search-console/about");
  } catch {
    return false;
  }
}

/** 콘솔이 요청한 속성이 아닌 다른 화면(권한 없음·기본 속성)으로 보냈는지 */
/** @param {string} pageUrl @param {string} resourceId */
export function propertyMismatch(pageUrl, resourceId) {
  try { return new URL(pageUrl).searchParams.get("resource_id") !== resourceId; } catch { return true; }
}

/** @param {string} label @param {string} date @param {string} resourceId */
export function exportFileName(label, date, resourceId) {
  const slug = label.toLowerCase().normalize("NFC").replace(/[^a-z0-9가-힣]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50).replace(/-+$/g, "");
  const id = createHash("sha256").update(resourceId).digest("hex");
  return `${slug || "property"}-${id}-${date}.xlsx`;
}

/** @param {Uint8Array} bytes */
export function validateDownload(bytes) {
  if (bytes.length === 0) throw new Error("내려받은 파일이 비어 있습니다.");
  if (bytes.length > MAX_EXPORT_BYTES) throw new Error("내려받은 파일이 2MB를 넘어 가져올 수 없습니다.");
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error("내려받은 파일이 xlsx(zip) 형식이 아닙니다. 로그인 화면이나 오류 페이지가 저장되었을 수 있습니다.");
}

/** @param {string} fileName @param {string} propertyLabel @param {Uint8Array} bytes */
export function uploadBody(fileName, propertyLabel, bytes) {
  return { fileName, propertyLabel, contentBase64: Buffer.from(bytes).toString("base64") };
}

/** @typedef {{status: "imported" | "duplicate", importId: number, hasData: boolean, warning: string | null} | {status: "failed", error: string}} UploadOutcome */

const successSchema = z.looseObject({
  import: z.looseObject({ id: z.number().int(), hasData: z.boolean() }),
  duplicate: z.boolean(),
  warning: z.string().nullable().optional(),
});

/** 가져오기 API 응답을 해석한다. 형식이 다르면 성공으로 보지 않는다 */
/** @param {number} status @param {unknown} body @returns {UploadOutcome} */
export function classifyUpload(status, body) {
  if (status === 200 || status === 201) {
    const parsed = successSchema.safeParse(body);
    if (!parsed.success) return { status: "failed", error: `예상하지 못한 응답 형식(HTTP ${status})` };
    return { status: parsed.data.duplicate ? "duplicate" : "imported", importId: parsed.data.import.id, hasData: parsed.data.import.hasData, warning: parsed.data.warning ?? null };
  }
  const error = z.object({ error: z.string(), code: z.string().optional() }).safeParse(body);
  return { status: "failed", error: error.success ? `${error.data.code ?? `HTTP_${status}`}: ${error.data.error}` : `HTTP ${status}` };
}

/** @param {string} value */
const xml = (value) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** 매일 정해진 시각에 수집기를 실행하는 macOS LaunchAgent. 로드 즉시 실행(RunAtLoad)은 넣지 않는다 */
/** @param {{label: string, nodePath: string, scriptPath: string, configPath: string, workingDir: string, logDir: string, hour: number, minute: number}} input */
export function launchdPlist(input) {
  const args = [input.nodePath, input.scriptPath, "--config", input.configPath].map((arg) => `    <string>${xml(arg)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(input.label)}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(input.workingDir)}</string>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>${input.hour}</integer>
    <key>Minute</key>
    <integer>${input.minute}</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>${xml(`${input.logDir}/gsc-collect.log`)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(`${input.logDir}/gsc-collect.err.log`)}</string>
</dict>
</plist>
`;
}
