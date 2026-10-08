/** @vitest-environment jsdom */
import { act, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MonitoringClient } from "@/components/monitoring/MonitoringClient";
import { MONITORING_PROVIDERS, type MonitoringData, type MonitoringResponses } from "@/lib/monitoring-types";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(useSyncExternalStore((listener) => {
    window.addEventListener("popstate", listener);
    return () => window.removeEventListener("popstate", listener);
  }, () => window.location.search, () => "")),
}));
vi.mock("@/components/monitoring/MonitoringCharts", () => ({
  percent: (value: number | null | undefined) => value == null ? "—" : `${value.toFixed(1)}%`,
  rank: (value: number | null | undefined) => value == null ? "—" : `${value}위`,
  runDate: (value?: string | null) => value ?? "—",
  brandColor: () => "green",
  WeeklyChart: () => <div>주별 차트</div>,
  ProviderRadar: () => <div>4축 레이더</div>,
  BrandTrendChart: ({ visible, selectedRunId, onSelectRun }: { visible: string[]; selectedRunId: number; onSelectRun: (id: number) => void }) => <div data-visible={visible.join(",")} data-run={selectedRunId}><button onClick={() => onSelectRun(1)}>차트 첫 실행</button></div>,
}));
const firstQuestion = "배달용으로 전기자전거를 렌탈하는데 어디서 렌탈하면 좋을지 알려줘";
const key = "a".repeat(64);
const metric = { succeeded: 4, failed: 0, refused: 0, mentions: 2, share: 50, providerCount: 2, averageRank: 1.5 };
const comparison = { baseline: metric, current: metric, delta: 0 };
function fixture(projectId = 1, selected = false): MonitoringData {
  const question = { key, text: firstQuestion, registrations: [{ id: 11, questionSetId: 1, setName: "대표 질문", updatedAt: "version-1" }], measuredRuns: 2, ...comparison };
  return {
    project: { id: projectId, name: `프로젝트 ${projectId}`, brandName: "라이클" },
    range: { start: "2026-06-01", end: "2026-06-30", timezone: "Asia/Seoul" },
    questionSets: [{ id: 1, name: "대표 질문" }], runCount: 2,
    conditions: { mode: "all", referenceRun: null, baseline: null, current: null, differences: [], excludedRuns: 0 },
    endpoints: { baseline: { id: 1, at: "2026-06-01T00:00:00Z" }, current: { id: 2, at: "2026-06-08T00:00:00Z" } },
    monthlyRuns: [{ month: "2026-06", count: 2 }], overview: { ...comparison, period: metric },
    providers: MONITORING_PROVIDERS.map((item) => ({ ...item, ...comparison })),
    weeks: [{ week: "2026-06-01", runs: 2, metric }], questions: [question], selectionMissing: false,
    selected: selected ? { question, brands: Array.from({ length: 13 }, (_, i) => ({ id: i === 0 ? "own" : `b_${i}`, name: i === 0 ? "라이클" : `경쟁사 ${i}`, own: i === 0, ...comparison })), trends: [] } : null,
  };
}
let root: Root;
let host: HTMLDivElement;
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset().mockImplementation(async (input) => {
    const url = new URL(String(input), "http://localhost");
    return Response.json(fixture(Number(url.searchParams.get("projectId") ?? 1), Boolean(url.searchParams.get("question"))));
  });
  window.history.replaceState(null, "", "/monitoring");
  const replace = window.history.replaceState.bind(window.history);
  vi.spyOn(window.history, "replaceState").mockImplementation((...args) => { replace(...args); window.dispatchEvent(new PopStateEvent("popstate")); });
  const push = window.history.pushState.bind(window.history);
  vi.spyOn(window.history, "pushState").mockImplementation((...args) => { push(...args); window.dispatchEvent(new PopStateEvent("popstate")); });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function render(projectId = 1, canConfigure = true) { await act(async () => root.render(<MonitoringClient projectId={projectId} canConfigure={canConfigure} />)); }
async function click(text: string) {
  const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === text || item.getAttribute("aria-label") === text);
  expect(button, text).toBeTruthy();
  await act(async () => button!.click());
}
async function navigate(search: string) { await act(async () => window.history.pushState(null, "", `/monitoring${search}`)); }

it("renders exactly the four existing providers and restores selection from URL and back navigation", async () => {
  await render();
  const table = host.querySelector('table[aria-label="AI 모델별 기준과 현재 언급률"]')!;
  expect(table.querySelectorAll("tbody tr")).toHaveLength(4);
  expect(table.textContent).not.toMatch(/perplexity/i);
  await click(`질문 보기: ${firstQuestion}`);
  expect(window.location.search).toContain(key);
  expect(host.querySelector('table[aria-label="질문별 브랜드 언급 현황"]')).not.toBeNull();
  await navigate(""); // Equivalent popstate received when returning to the overview URL.
  expect(host.querySelector('table[aria-label="AI 모델별 기준과 현재 언급률"]')).not.toBeNull();
});

it("starts with own plus top five brands, pins own and expands more competitors", async () => {
  await navigate(`?question=${key}`); await render();
  expect(host.querySelector("[data-visible]")?.getAttribute("data-visible")).toBeUndefined(); // Empty trend series has an explicit empty state.
  expect(host.querySelectorAll('table[aria-label="질문별 브랜드 언급 현황"] tbody tr')).toHaveLength(10);
  const checks = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
  expect(checks.filter((item) => item.checked)).toHaveLength(6);
  expect(checks[0].disabled).toBe(true);
  await click("3개 브랜드 더보기 ");
  expect(host.querySelectorAll('table[aria-label="질문별 브랜드 언급 현황"] tbody tr')).toHaveLength(13);
});

it("ignores an old project response even when it resolves after the newer request", async () => {
  let finishOld!: (response: Response) => void;
  fetchMock.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }));
  await render(1); await render(2);
  expect(host.textContent).toContain("프로젝트 2");
  await act(async () => finishOld(Response.json(fixture(1))));
  expect(host.textContent).not.toContain("프로젝트 1");
  expect(host.textContent).toContain("프로젝트 2");
});

it("refreshes after same-project settings events instead of staying in a loading state", async () => {
  await render();
  await act(async () => window.dispatchEvent(new Event("geo-master:project-changed")));
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(host.textContent).toContain("프로젝트 1");
});

it("shows API errors and recovers on retry", async () => {
  fetchMock.mockImplementationOnce(async () => Response.json({ error: "잠시 후 다시 시도" }, { status: 503 }));
  await render();
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("잠시 후 다시 시도");
  await click("다시 시도");
  expect(host.textContent).toContain("프로젝트 1");
});

it("shows CSV failure and exports with explicit displayed dates and the selected question", async () => {
  await navigate(`?question=${key}`); await render();
  fetchMock.mockImplementationOnce(async () => Response.json({ error: "내보내기 오류" }, { status: 500 }));
  await click("기간 CSV 내보내기");
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("내보내기 오류");
  const url = new URL(String(fetchMock.mock.calls.at(-1)![0]), "http://localhost");
  expect(Object.fromEntries(url.searchParams)).toMatchObject({ start: "2026-06-01", end: "2026-06-30", question: key, format: "csv", projectId: "1" });
});

it("reuses the question PATCH API with its optimistic concurrency version", async () => {
  await render(); await click(`질문 수정: ${firstQuestion}`);
  const input = document.querySelector<HTMLTextAreaElement>("dialog textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "새로운 질문으로 바꿉니다");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  fetchMock.mockImplementationOnce(async () => Response.json({ error: "다른 곳에서 수정되었습니다." }, { status: 409 }));
  await act(async () => document.querySelector("dialog form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  const [url, options] = fetchMock.mock.calls.at(-1)!;
  expect(url).toBe("/api/questions/11");
  expect(options?.method).toBe("PATCH");
  expect(JSON.parse(String(options?.body))).toEqual({ text: "새로운 질문으로 바꿉니다", expectedUpdatedAt: "version-1" });
  expect(document.querySelector('dialog [role="alert"]')?.textContent).toBe("다른 곳에서 수정되었습니다.");
});

it("hides project settings for guests and exposes mobile question list state", async () => {
  await render(1, false);
  expect(host.querySelector('a[href="/settings"]')).toBeNull();
  const toggle = host.querySelector<HTMLButtonElement>('[aria-controls="monitoring-question-list"]')!;
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  await act(async () => toggle.click());
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
});

it("does not continue question creation after the editor was invalidated by a project change", async () => {
  fetchMock.mockImplementationOnce(async () => Response.json({ ...fixture(), questionSets: [] }));
  await render(); await click("새 질문 추가");
  await act(async () => {
    const input = document.querySelector("dialog textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "저장 중 프로젝트가 전환되는 질문");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  let finishSet!: (response: Response) => void;
  fetchMock.mockImplementationOnce(() => new Promise((resolve) => { finishSet = resolve; }));
  await act(async () => document.querySelector("dialog form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await act(async () => window.dispatchEvent(new Event("geo-master:project-changed")));
  await click("새 질문 추가");
  await act(async () => finishSet(Response.json({ questionSet: { id: 99 } })));
  expect(fetchMock.mock.calls.some(([url]) => url === "/api/question-sets/99/questions")).toBe(false);
  expect(document.querySelector("dialog[open]")).not.toBeNull();
});

function withTrends(): MonitoringData {
  const data = fixture(1, true);
  data.selected!.trends = [1, 2].map((id) => ({ id, at: `2026-06-${id === 1 ? "01" : "08"}T00:00:00Z`, brands: { own: metric } }));
  data.conditions.current = { known: true, signature: "known", questionCount: 1, questions: [key], models: ["openai: test"], searchModes: ["openai: web"], repetitions: ["1"], requestedSearchMode: "web" };
  return data;
}
function evidence(runId: number): MonitoringResponses {
  return {
    project: { id: 1, name: "프로젝트 1" }, question: { key, text: firstQuestion },
    run: { id: runId, at: `2026-06-${runId === 1 ? "01" : "08"}T00:00:00Z`, requestedSearchMode: "web", rawAnswerCount: 3 },
    interpretation: "current_brand_settings", summary: { ...metric, share: runId === 1 ? 25 : 50, mentionedProviderCount: 1, measuredProviderCount: 1 },
    providers: MONITORING_PROVIDERS.map((p, index) => ({ ...p, ...metric, resultCount: index ? 0 : 3, mentions: index ? 0 : 2, succeeded: index ? 0 : 3,
      mentionedBrands: index ? [] : [{ id: "own", name: "라이클", own: true }], groups: index ? [] : [
        { searchMode: "web", models: ["test-v1"], returnedModels: ["test-v1-real"], resultCount: 2 },
        { searchMode: "off", models: ["test-v1"], returnedModels: [], resultCount: 1 },
      ] })),
    items: [1, 2, 3].map((id) => ({ id, provider: "openai", model: "test-v1", returnedModel: "test-v1-real", repetition: id, slotStatus: "succeeded", slotError: null,
      response: `라이클 실행 ${runId} 반복 ${id} <img src=x onerror=alert(1)>`, searchMode: id === 3 ? "off" : "web", searchPerformed: id !== 3,
      mentions: [{ brandId: "own", name: "라이클", own: true, start: 0, end: 3 }],
      sources: [{ id, url: "https://example.com/evidence", title: "측정 출처", domain: "example.com", kind: "cited", storedCategory: "own" }],
    })), page: { hasMore: false, nextCursor: null },
  };
}
function mockEvidence(aggregate = withTrends()) {
  fetchMock.mockImplementation(async (input) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname.endsWith("/responses")) return Response.json(evidence(Number(url.searchParams.get("runId"))));
    return Response.json({ ...aggregate, conditions: { ...aggregate.conditions, mode: url.searchParams.get("comparison") ?? "all" } });
  });
}
async function select(label: string, value: string) {
  await act(async () => {
    const input = host.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
    expect(input).toBeTruthy(); input.value = value; input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
it("restores the run URL and replaces run history without refetching the period aggregate", async () => {
  mockEvidence(); await navigate(`?question=${key}&run=2`); await render();
  expect(host.querySelector("[data-run]")?.getAttribute("data-run")).toBe("2");
  const pushes = vi.mocked(window.history.pushState).mock.calls.length;
  await click("차트 첫 실행");
  expect(window.location.search).toContain("run=1");
  expect(vi.mocked(window.history.pushState).mock.calls).toHaveLength(pushes);
  expect(host.textContent).toContain("25.0%");
  expect(host.querySelector('table[aria-label="질문별 브랜드 언급 현황"]')?.textContent).toContain("50.0%");
  const aggregateCalls = fetchMock.mock.calls.filter(([url]) => !String(url).includes("/responses"));
  expect(aggregateCalls).toHaveLength(1);
  expect(String(aggregateCalls[0][0])).not.toContain("run=");
  await select("응답을 볼 측정 시점", "2");
  expect(window.location.search).toContain("run=2");
});
it("does not silently replace an invalid run and defaults to the latest measured question run", async () => {
  const aggregate = withTrends(); aggregate.selected!.trends[1].brands.own = null;
  mockEvidence(aggregate); await navigate(`?question=${key}&run=999`); await render();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("비교 조건 밖");
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/responses"))).toBe(false);
  await click("최근 실행 응답 보기");
  expect(host.textContent).toContain("가장 최근에 측정된 실행");
  expect(host.querySelector("[data-run]")?.getAttribute("data-run")).toBe("1");
});
it("ignores a late response from a previous run", async () => {
  mockEvidence(); const defaultFetch = fetchMock.getMockImplementation()!;
  let finishOld!: (response: Response) => void;
  fetchMock.mockImplementation((input, options) => String(input).includes("/responses") && new URL(String(input), "http://localhost").searchParams.get("runId") === "1"
    ? new Promise((resolve) => { finishOld = resolve; }) : defaultFetch(input, options));
  await navigate(`?question=${key}&run=1`); await render();
  await select("응답을 볼 측정 시점", "2");
  await act(async () => finishOld(Response.json(evidence(1))));
  expect(host.textContent).toContain("실행 #2의 응답");
  expect(host.textContent).not.toContain("실행 #1의 응답");
});
it("opens provider evidence lazily, changes conditions and repetitions, and escapes raw markup", async () => {
  mockEvidence(); await navigate(`?question=${key}`); await render();
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes("provider="))).toBe(false);
  const card = host.querySelector('article[aria-label="ChatGPT 응답"]')!;
  await act(async () => card.querySelector("button")!.click());
  expect(String(fetchMock.mock.calls.at(-1)![0])).toContain("provider=openai");
  expect(card.querySelector("mark")?.textContent).toBe("라이클");
  expect(card.querySelector("img")).toBeNull();
  expect(card.textContent).toContain("<img src=x onerror=alert(1)>");
  expect(card.textContent).toContain("명시 인용 · 저장 당시 분류: 자사");
  expect(card.querySelector('a[target="_blank"]')?.getAttribute("rel")).toContain("noopener");
  await select("ChatGPT 반복 응답", "2"); expect(card.textContent).toContain("실행 2 반복 2");
  await select("ChatGPT 응답 조건", "off"); expect(card.textContent).toContain("일반 응답으로 수집");
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  await click("ChatGPT 원문 복사");
  expect(writeText).toHaveBeenCalledWith(evidence(2).items[2].response);
  expect(card.textContent).toContain("원문을 복사했습니다.");
  const missing = host.querySelector('article[aria-label="Gemini 응답"]')!;
  await act(async () => missing.querySelector("button")!.click());
  expect(missing.textContent).toContain("이 서비스는 측정되지 않았습니다");
});
it("keeps question search local and sorts unmeasured questions after zero mentions", async () => {
  const aggregate = withTrends(); const original = aggregate.questions[0];
  aggregate.questions.push({ ...original, key: "b".repeat(64), text: "미측정 질문", current: null, delta: null });
  aggregate.questions.push({ ...original, key: "c".repeat(64), text: "하락 질문", current: { ...metric, share: 0 }, delta: -50 });
  mockEvidence(aggregate); await navigate(`?question=${key}`); await render();
  const calls = fetchMock.mock.calls.length;
  await act(async () => {
    const sort = host.querySelector<HTMLSelectElement>("#monitoring-question-list select")!;
    sort.value = "current"; sort.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect([...host.querySelectorAll('[aria-label^="질문 보기:"]')].map((e) => e.getAttribute("aria-label"))).toEqual([`질문 보기: ${firstQuestion}`, "질문 보기: 하락 질문", "질문 보기: 미측정 질문"]);
  await act(async () => {
    const input = host.querySelector('input[type="search"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "하락");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(fetchMock.mock.calls).toHaveLength(calls);
  expect(host.textContent).toContain("선택한 질문이 목록 필터에 숨겨져");
  expect(host.textContent).toContain("감소 -50.0%p");
  expect(host.querySelector('table[aria-label="질문별 브랜드 언급 현황"]')).not.toBeNull();
});
it("propagates same-condition mode to the URL, aggregate, evidence and CSV without a selected run", async () => {
  mockEvidence(); await navigate(`?question=${key}&run=1`); await render();
  await select("측정 비교 조건", "same");
  expect(window.location.search).toContain("comparison=same");
  expect(window.location.search).not.toContain("run=");
  expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith("/api/monitoring?") && String(url).includes("comparison=same"))).toBe(true);
  expect(String(fetchMock.mock.calls.at(-1)![0])).toContain("comparison=same");
  fetchMock.mockImplementationOnce(async () => Response.json({ error: "CSV 테스트 오류" }, { status: 500 }));
  await click("기간 CSV 내보내기");
  const csv = new URL(String(fetchMock.mock.calls.at(-1)![0]), "http://localhost");
  expect(csv.searchParams.get("comparison")).toBe("same");
  expect(csv.searchParams.has("run")).toBe(false);
});
