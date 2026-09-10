import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
const { chromium } = await import(
  process.env.GEO_PLAYWRIGHT_MODULE || "playwright"
);
const base = process.env.GEO_QA_BASE_URL || "http://127.0.0.1:3317";
if (new URL(base).hostname !== "127.0.0.1")
  throw new Error("QA requires an isolated loopback server/database.");
const output = path.resolve("docs/qshop/evidence");
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  const sub = await page.request.get(`${base}/api/semforge/subscription`);
  const subscription = await sub.json();
  if (!subscription.subscription?.active)
    await page.request.post(`${base}/api/semforge/subscription/trial`, {
      data: {},
    });
  await page.goto(`${base}/site-audit`);
  const name = `큐샵 통합 QA ${Date.now()}`;
  await page.getByLabel("캠페인 이름", { exact: true }).fill(name);
  await page.getByLabel("도메인", { exact: true }).fill("example.com");
  const created = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/site-audit") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "캠페인 추가" }).click();
  assert.equal((await created).status(), 201);
  await page
    .getByRole("button", { name: new RegExp(name) })
    .first()
    .click();
  const workbench = page.getByRole("region", { name: "페이지 SEO GEO 작업대" });
  await workbench.getByLabel("공개 페이지 URL").fill("https://example.com/");
  const capture = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/site-ops") &&
      r.request().postDataJSON()?.action === "capture",
  );
  await workbench
    .getByRole("button", { name: "페이지 수집", exact: true })
    .click();
  const captured = await (await capture).json();
  console.log(
    JSON.stringify({
      capture: captured.snapshot
        ? {
            status: captured.snapshot.statusCode,
            state: captured.snapshot.fetchState,
            error: captured.snapshot.errorCode,
          }
        : captured,
    }),
  );
  await page.screenshot({
    path: path.join(output, "01-page-capture.png"),
    fullPage: true,
  });
  assert.equal(captured.snapshot.fetchState, "fetched");
  await workbench
    .getByLabel("페이지 제목 수정 제안", { exact: true })
    .fill("Example Domain — GEO 검증 초안");
  await workbench
    .getByLabel("변경 이유")
    .fill("공개 페이지 제목을 수정하는 수동 적용 절차 QA");
  await workbench
    .getByRole("button", { name: "변경안 저장", exact: true })
    .click();
  await workbench.getByText("초안", { exact: true }).waitFor();
  await workbench.getByLabel("승인자 기록").fill("로컬 QA 운영자");
  await workbench.getByRole("button", { name: "검토한 수정안 승인" }).click();
  await workbench.getByText("승인됨", { exact: true }).waitFor();
  const downloadPromise = page.waitForEvent("download");
  await workbench.getByRole("button", { name: "적용 안내 다운로드" }).click();
  const download = await downloadPromise;
  await download.saveAs(path.join(output, "qshop-delivery-example.md"));
  await workbench.getByRole("button", { name: "공개 URL 재검증" }).click();
  await workbench.getByText("반영 대기", { exact: true }).waitFor();
  await page.screenshot({
    path: path.join(output, "02-delivery-verification.png"),
    fullPage: true,
  });
  await page.reload();
  await page
    .getByRole("button", { name: new RegExp(name) })
    .first()
    .click();
  await page.getByText("반영 대기", { exact: true }).waitFor();
  await page
    .getByRole("region", { name: "페이지 SEO GEO 작업대" })
    .getByRole("button")
    .filter({ hasText: "https://example.com/" })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: path.join(output, "03-mobile.png"),
    fullPage: true,
  });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
    "mobile horizontal overflow",
  );
  await page.setViewportSize({ width: 1440, height: 1080 });
  let releaseSettings;
  const settingsGate = new Promise((resolve) => {
    releaseSettings = resolve;
  });
  await page.route("**/api/settings", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await settingsGate;
    await route.fulfill({
      response,
      json: {
        ...body,
        settings: {
          ...body.settings,
          brandName: "늦게 도착한 기본 브랜드",
          category: "기본 카테고리",
        },
      },
    });
  });
  const settingsRequest = page.waitForRequest("**/api/settings");
  await page.goto(`${base}/llms`);
  await settingsRequest;
  await page.getByLabel("사이트·브랜드명").fill("Example Domain");
  await page.getByLabel("공식 사이트 URL").fill("https://example.com/");
  await page.getByLabel("게시 경로").fill("/docs/llms.txt");
  await page.getByLabel("한 줄 요약").fill("사용자가 지울 요약");
  await page.getByLabel("한 줄 요약").fill("");
  const settingsResponse = page.waitForResponse("**/api/settings");
  releaseSettings();
  await settingsResponse;
  await page.waitForLoadState("networkidle");
  assert.equal(
    await page.getByLabel("사이트·브랜드명").inputValue(),
    "Example Domain",
  );
  assert.equal(await page.getByLabel("한 줄 요약").inputValue(), "");
  await page.unroute("**/api/settings");
  await page
    .getByLabel(/핵심 문서/)
    .fill("홈 | https://example.com/ | 공개 예시 도메인");
  await page.getByRole("button", { name: "초안 생성" }).click();
  await page.getByLabel("llms.txt 내용").waitFor();
  await page.getByRole("button", { name: "문서 저장" }).click();
  await page
    .getByRole("button", { name: /공식 llms.txt/ })
    .first()
    .waitFor();
  await page.screenshot({
    path: path.join(output, "04-ai-files.png"),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  const report = {
    capturedAt: new Date().toISOString(),
    result: "PASS",
    target: "https://example.com/",
    externalWrites: false,
    checks: [
      "실제 HTML 수집",
      "수정안 저장",
      "승인 시 재수집",
      "수동 전달 파일 다운로드",
      "실제 미반영→반영 대기",
      "새로고침 후 상태 보존",
      "390px 가로 넘침 없음",
      "요약 없는 경로별 llms.txt 생성·저장",
      "늦은 설정 응답에도 사용자 입력 보존",
      "브라우저 예외 없음",
    ],
  };
  await fs.writeFile(
    path.join(output, "browser-qa.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} catch (error) {
  await page.screenshot({
    path: path.join(output, "qa-failure.png"),
    fullPage: true,
  });
  console.log(
    JSON.stringify({
      alerts: await page.getByRole("alert").allTextContents(),
      url: page.url(),
    }),
  );
  throw error;
} finally {
  await browser.close();
}
