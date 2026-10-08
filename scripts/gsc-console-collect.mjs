#!/usr/bin/env node
// Search Console 콘솔 내보내기 수집기 (공개 API가 SNS 플랫폼 속성을 제공하지 않아 콘솔 Excel을 대신 수집)
//
//   npm run gsc:login                 전용 Chrome 창을 열어 사용자가 직접 Google에 로그인 (최초 1회·만료 시)
//   npm run gsc:collect               속성마다 Excel을 내려받아 로컬 GEO Master에 가져오기
//   npm run gsc:collect -- --dry-run  설정만 검증하고 실행 계획을 출력
//   npm run gsc:collect -- --no-upload   내려받기만 하고 앱에는 올리지 않음
//   npm run gsc:collect -- --print-launchd  매일 실행용 LaunchAgent plist 출력(설치는 하지 않음)
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { CollectError, exportProperty, openProfile } from "./gsc-collect/console.mjs";
import { classifyUpload, launchdPlist, lockIsStale, parseCollectConfig, uploadBody } from "./gsc-collect/lib.ts";

const DEFAULT_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function localDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

async function loadConfig(configPath) {
  let raw;
  try {
    raw = JSON.parse(await fs.readFile(configPath, "utf8"));
  } catch (error) {
    throw new CollectError("CONFIG_UNREADABLE", `설정 파일을 읽지 못했습니다(${configPath}): ${error instanceof Error ? error.message : error}. gsc-collect.config.example.json을 복사해 만드세요.`);
  }
  try {
    return parseCollectConfig(raw, { homeDir: os.homedir() });
  } catch (error) {
    throw new CollectError("CONFIG_INVALID", `설정이 올바르지 않습니다: ${error instanceof Error ? error.message : error}`);
  }
}

const lockPath = (config) => `${config.profileDir}.collect.lock`;

async function login(config) {
  await fs.mkdir(config.profileDir, { recursive: true, mode: 0o700 });
  const release = await acquireLock(lockPath(config));
  const chrome = config.chromePath ?? DEFAULT_CHROME;
  console.log(`전용 Chrome 프로필(${config.profileDir})을 엽니다. 이 창에서 직접 Google에 로그인하고 Search Console 실적 화면이 보이면 창을 닫으세요.`);
  const child = spawn(chrome, [`--user-data-dir=${config.profileDir}`, "--no-first-run", "--no-default-browser-check", "https://search.google.com/search-console"], { stdio: "ignore" });
  const code = await new Promise((resolve, reject) => {
    child.once("error", (error) => reject(new CollectError("BROWSER_LAUNCH_FAILED", `Chrome을 실행하지 못했습니다(${chrome}): ${error.message}`)));
    child.once("exit", resolve);
  }).finally(release);
  console.log(code === 0 ? "로그인 창을 닫았습니다. 이제 `npm run gsc:collect`로 수집할 수 있습니다." : `Chrome이 코드 ${code}로 종료되었습니다.`);
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === "EPERM"; }
}

/** 수집·로그인이 같은 전용 프로필을 동시에 쓰지 않도록 잠근다. 기록된 PID가 죽었으면 남은 잠금을 치운다 */
async function acquireLock(lockFile) {
  try {
    if (lockIsStale(await fs.readFile(lockFile, "utf8"), processAlive)) await fs.rm(lockFile, { force: true });
  } catch { /* 잠금 없음 */ }
  try {
    const handle = await fs.open(lockFile, "wx", 0o600);
    await handle.writeFile(String(process.pid));
    await handle.close();
  } catch {
    throw new CollectError("ALREADY_RUNNING", `전용 프로필을 다른 수집 또는 로그인 창이 쓰고 있습니다(${lockFile}). 끝난 뒤 다시 실행하세요.`);
  }
  return () => fs.rm(lockFile, { force: true });
}

async function upload(appUrl, fileName, label, bytes) {
  try {
    const response = await fetch(`${appUrl}/api/search-console/imports`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(uploadBody(fileName, label, bytes)),
      signal: AbortSignal.timeout(30_000),
    });
    let body = null;
    try { body = await response.json(); } catch { /* JSON이 아닌 응답 */ }
    return classifyUpload(response.status, body);
  } catch (error) {
    return { status: "failed", error: `GEO Master(${appUrl})에 연결하지 못했습니다: ${error instanceof Error ? error.message : error}` };
  }
}

async function collect(config, { upload: shouldUpload }) {
  const date = localDate();
  const runDir = path.join(config.outDir, date);
  const release = await acquireLock(lockPath(config));
  const results = [];
  let context;
  try {
    context = await openProfile(config.profileDir, { headless: config.headless, chromePath: config.chromePath });
    const page = context.pages()[0] ?? await context.newPage();
    for (const property of config.properties) {
      const result = { label: property.label, resourceId: property.resourceId };
      try {
        const { file, bytes } = await exportProperty(page, property, { runDir, date });
        result.file = file;
        result.upload = shouldUpload ? await upload(config.appUrl, path.basename(file), property.label, bytes) : { status: "skipped" };
      } catch (error) {
        result.error = error instanceof CollectError ? `${error.code}: ${error.message}` : `UNEXPECTED: ${error instanceof Error ? error.message.split("\n")[0] : error}`;
        results.push(result);
        // 로그인이 없으면 나머지 속성도 같은 이유로 실패하므로 바로 멈춘다
        if (error instanceof CollectError && error.code === "NOT_LOGGED_IN") break;
        continue;
      }
      results.push(result);
    }
  } finally {
    await context?.close().catch(() => {});
    await release();
  }
  await fs.mkdir(runDir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await fs.writeFile(path.join(runDir, `result-${stamp}.json`), `${JSON.stringify({ date, results }, null, 2)}\n`, { mode: 0o600 });
  return results;
}

function report(results, total) {
  for (const item of results) {
    if (item.error) console.log(`✗ ${item.label} — ${item.error}`);
    else if (item.upload.status === "failed") console.log(`✗ ${item.label} — 내려받음(${item.file}), 가져오기 실패: ${item.upload.error}`);
    else if (item.upload.status === "skipped") console.log(`• ${item.label} — 내려받음(${item.file}), 업로드 생략`);
    else console.log(`✓ ${item.label} — ${item.upload.status === "duplicate" ? "이미 가져온 파일" : "가져옴"}${item.upload.hasData ? "" : " · 노출 0(데이터 없음)"}`);
  }
  const ok = results.filter((item) => !item.error && item.upload.status !== "failed").length;
  if (results.length < total) console.log(`… 나머지 ${total - results.length}개 속성은 실행하지 않았습니다.`);
  return ok === total;
}

async function main() {
  const { values } = parseArgs({
    options: {
      config: { type: "string" },
      login: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      "no-upload": { type: "boolean", default: false },
      "print-launchd": { type: "boolean", default: false },
    },
  });
  const configPath = path.resolve(values.config ?? process.env.GSC_COLLECT_CONFIG ?? "gsc-collect.config.json");
  const config = await loadConfig(configPath);

  if (values.login) return login(config);
  if (values["print-launchd"]) {
    const logDir = path.join(os.homedir(), ".geo-master", "logs");
    process.stdout.write(launchdPlist({
      label: "com.geo-master.gsc-collect", nodePath: process.execPath, scriptPath: path.resolve(import.meta.dirname, "gsc-console-collect.mjs"),
      configPath, workingDir: path.resolve(import.meta.dirname, ".."), logDir, ...config.schedule,
    }));
    console.error(`\n# 설치하려면: mkdir -p ${logDir} && 위 내용을 ~/Library/LaunchAgents/com.geo-master.gsc-collect.plist로 저장 후 launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.geo-master.gsc-collect.plist`);
    return;
  }
  if (values["dry-run"]) {
    console.log(JSON.stringify({ configPath, appUrl: config.appUrl, profileDir: config.profileDir, outDir: config.outDir, schedule: config.schedule, properties: config.properties }, null, 2));
    return;
  }
  const results = await collect(config, { upload: !values["no-upload"] });
  if (!report(results, config.properties.length)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof CollectError ? `${error.code}: ${error.message}` : error);
  process.exitCode = 2;
});
