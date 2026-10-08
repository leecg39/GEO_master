import { getDatabase } from "./db";
import { requireActiveProject } from "./projects";
import { monitoringMatcher, monitoringQuestionKey } from "./monitoring-matching";
import { count, metric, round, tally, type MonitoringTally as Tally } from "./monitoring-metrics";
import { monitoringRuns } from "./monitoring-runs";
import { monitoringQuerySchema, monitoringRange } from "./monitoring-query";
import { MONITORING_PROVIDERS, type MonitoringComparison, type MonitoringData, type MonitoringProvider, type MonitoringRegistration } from "./monitoring-types";

export { monitoringQuestionKey } from "./monitoring-matching";
export { monitoringQuerySchema, monitoringRange } from "./monitoring-query";
const DAY = 86_400_000;
const KST = 9 * 3_600_000;
const providerIds = MONITORING_PROVIDERS.map((provider) => provider.id);
const providerPlaceholders = providerIds.map(() => "?").join(",");
function isoDay(time: number) { return new Date(time).toISOString().slice(0, 10); }
function weekOf(date: string) {
  const time = Date.parse(date.slice(0, 10));
  return isoDay(time - ((new Date(time).getUTCDay() + 6) % 7) * DAY);
}
function compare(first: Tally | undefined, last: Tally | undefined, brand = "own"): MonitoringComparison {
  const baseline = first ? metric(first, brand) : null;
  const current = last ? metric(last, brand) : null;
  return { baseline, current, delta: baseline?.share != null && current?.share != null ? round(current.share - baseline.share) : null };
}

interface ResultRow { runId: number; questionText: string; provider: MonitoringProvider; response: string; status: string }
interface RegistrationRow extends MonitoringRegistration { text: string }

/** A read-only projection of raw answers; no stored metrics or historical prompts are rewritten. */
export function getMonitoringData(input: unknown, now = new Date()): MonitoringData {
  const query = monitoringQuerySchema.parse(input);
  const range = monitoringRange(query.start, query.end, now);
  const { sqlite } = getDatabase();
  return sqlite.transaction(() => {
    const project = requireActiveProject(query.projectId);
    const { brands, match } = monitoringMatcher(project);
    const from = `${range.start}T00:00:00+09:00`;
    const through = `${range.end}T00:00:00+09:00`;
    const { runs, comparison: conditions } = monitoringRuns(sqlite, project.id, range, query.comparison);
    const questionSets = sqlite.prepare("SELECT id, name FROM question_sets WHERE project_id = ? ORDER BY id").all(project.id) as { id: number; name: string }[];
    const registered = sqlite.prepare(`SELECT q.id, q.text, q.question_set_id AS questionSetId, s.name AS setName, q.updated_at AS updatedAt
      FROM questions q JOIN question_sets s ON s.id = q.question_set_id
      WHERE s.project_id = ? ORDER BY s.id, q.position, q.id`).all(project.id) as RegistrationRow[];
    const questions = new Map<string, { text: string; registrations: MonitoringRegistration[]; measuredRuns: Set<number> }>();
    for (const { text, ...registration } of registered) {
      const item = questions.get(text) ?? { text, registrations: [], measuredRuns: new Set<number>() };
      item.registrations.push(registration);
      questions.set(text, item);
    }
    const runStats = new Map(runs.map((run) => [run.id, { all: tally(), models: new Map<string, Tally>(), questions: new Map<string, Tally>() }]));
    const weeks = new Map<string, { runs: number; total: Tally }>();
    for (let day = Date.parse(weekOf(range.start)); day <= Date.parse(range.end); day += DAY * 7) {
      weeks.set(isoDay(day), { runs: 0, total: tally() });
    }
    const months = new Map<string, number>();
    const lastDay = Date.parse(range.end);
    // Iterate timestamps: slicing an extended ISO year (10000) can repeat the same month forever.
    for (const date = new Date(`${range.start.slice(0, 7)}-01T00:00:00Z`); date.getTime() <= lastDay;) {
      months.set(date.toISOString().slice(0, 7), 0);
      date.setUTCMonth(date.getUTCMonth() + 1);
    }
    const runWeeks = new Map<number, string>();
    for (const run of runs) {
      const day = isoDay(Date.parse(run.at) + KST);
      const week = weekOf(day);
      runWeeks.set(run.id, week);
      weeks.get(week)!.runs++;
      const month = day.slice(0, 7);
      months.set(month, (months.get(month) ?? 0) + 1);
    }
    const period = tally();
    // Iterate instead of materializing every raw answer in an additional array.
    const rows = sqlite.prepare(`SELECT r.run_id AS runId, r.question_text AS questionText, r.provider, r.response, r.slot_status AS status
      FROM measure_results r JOIN measure_runs m ON m.id = r.run_id
      WHERE m.project_id = ? AND m.status = 'completed'
        AND julianday(COALESCE(m.completed_at, m.created_at)) >= julianday(?)
        AND julianday(COALESCE(m.completed_at, m.created_at)) < julianday(?) + 1
        AND r.provider IN (${providerPlaceholders})`).iterate(project.id, from, through, ...providerIds);
    for (const raw of rows) {
      const row = raw as ResultRow;
      const run = runStats.get(row.runId);
      if (!run) continue;
      const question = questions.get(row.questionText) ?? { text: row.questionText, registrations: [], measuredRuns: new Set<number>() };
      question.measuredRuns.add(row.runId);
      questions.set(row.questionText, question);
      const model = run.models.get(row.provider) ?? tally();
      const questionTally = run.questions.get(row.questionText) ?? tally();
      const positions = row.status === "succeeded" ? match(row.response).firstPositions : new Map<string, number>();
      for (const target of [period, run.all, model, questionTally, weeks.get(runWeeks.get(row.runId)!)!.total]) {
        count(target, row.status, row.provider, positions);
      }
      run.models.set(row.provider, model);
      run.questions.set(row.questionText, questionTally);
    }
    const baselineRun = runs.length > 1 ? runs[0]! : null;
    const currentRun = runs.at(-1) ?? null;
    const baseline = baselineRun ? runStats.get(baselineRun.id) : undefined;
    const current = currentRun ? runStats.get(currentRun.id) : undefined;
    const questionList = [...questions.values()].map((question) => ({
      key: monitoringQuestionKey(question.text), text: question.text, registrations: question.registrations,
      measuredRuns: question.measuredRuns.size,
      ...compare(baseline?.questions.get(question.text), current?.questions.get(question.text)),
    }));
    const selectedQuestion = query.question ? questionList.find((question) => question.key === query.question) : undefined;
    const selected = selectedQuestion ? {
      question: selectedQuestion,
      brands: brands.map((brand) => ({ ...brand, ...compare(baseline?.questions.get(selectedQuestion.text), current?.questions.get(selectedQuestion.text), brand.id) }))
        .sort((a, b) => Number(b.own) - Number(a.own) || (b.current?.share ?? -1) - (a.current?.share ?? -1) || a.name.localeCompare(b.name, "ko")),
      trends: runs.map((run) => {
        const value = runStats.get(run.id)!.questions.get(selectedQuestion.text);
        return { ...run, brands: Object.fromEntries(brands.map((brand) => [brand.id, value ? metric(value, brand.id) : null])) };
      }),
    } : null;
    return {
      project: { id: project.id, name: project.name, brandName: project.brandName }, range, questionSets,
      runCount: runs.length, conditions, endpoints: { baseline: baselineRun, current: currentRun },
      monthlyRuns: [...months].map(([month, count]) => ({ month, count })),
      overview: { ...compare(baseline?.all, current?.all), period: metric(period) },
      providers: MONITORING_PROVIDERS.map((provider) => ({ ...provider, ...compare(baseline?.models.get(provider.id), current?.models.get(provider.id)) })),
      weeks: [...weeks].map(([week, value]) => ({ week, runs: value.runs, metric: metric(value.total) })),
      questions: questionList, selected, selectionMissing: Boolean(query.question && !selected),
    };
  })();
}

function csvCell(value: unknown) {
  let text = value == null ? "" : String(value);
  if (/^[\s\uFEFF]*[=+\-@]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
/** Both JSON and export use the same projection, including nulls, filters and provider allowlist. */
export function monitoringCsv(data: MonitoringData) {
  const rows: unknown[][] = [
    ["프로젝트", data.project.name, "기간", data.range.start, data.range.end, "시간대", data.range.timezone],
    ["집계 기준", "현재 브랜드 설정 기준 재집계", "LLM", ...MONITORING_PROVIDERS.map((provider) => provider.name)],
    ["기준 실행", data.endpoints.baseline?.at, "현재 실행", data.endpoints.current?.at],
    ["비교 조건", data.conditions.mode === "same" ? "최근 실행과 같은 조건" : "전체 조건", "제외 실행", data.conditions.excludedRuns],
    ["조건 안내", ...data.conditions.differences],
    ["설명", "성공 응답만 분모에 포함. 평균 순위는 등록 브랜드의 첫 등장 순서. 빈 값은 미측정. 주 시작은 월요일."],
    ["구분", "질문", "브랜드 / 모델", "시점", "기준 언급률(%)", "현재 언급률(%)", "변화(%p)", "언급 모델 수", "평균 등장 순위", "성공", "언급", "실패", "거절"],
  ];
  function add(kind: string, question: string, name: string, at: string, comparison: MonitoringComparison) {
    const value = comparison.current;
    rows.push([kind, question, name, at, comparison.baseline?.share, value?.share, comparison.delta, value?.providerCount,
      value?.averageRank, value?.succeeded, value?.mentions, value?.failed, value?.refused]);
  }
  if (data.selected) {
    const { question, brands, trends } = data.selected;
    for (const brand of brands) add("질문 브랜드", question.text, brand.name, "", brand);
    for (const point of trends) for (const brand of brands) {
      add("실행 추이", question.text, brand.name, point.at, { baseline: null, current: point.brands[brand.id] ?? null, delta: null });
    }
  } else {
    add("전체", "", data.project.brandName, "", data.overview);
    for (const provider of data.providers) add("모델", "", provider.name, "", provider);
    for (const week of data.weeks) add("주별", "", data.project.brandName, week.week, { baseline: null, current: week.metric, delta: null });
    for (const question of data.questions) add("질문", question.text, data.project.brandName, "", question);
  }
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
