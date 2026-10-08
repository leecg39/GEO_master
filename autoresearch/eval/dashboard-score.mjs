#!/usr/bin/env node
/**
 * Frozen Metric — DO NOT modify from target experiments.
 * Composite score for GEO Master dashboard autoresearch loop.
 */
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function run(cmd) {
  try {
    execSync(cmd, { cwd: root, stdio: "pipe", encoding: "utf8" });
    return { ok: true, out: "" };
  } catch (error) {
    const out = error.stdout?.toString?.() ?? error.message ?? "";
    const err = error.stderr?.toString?.() ?? "";
    return { ok: false, out: `${out}\n${err}`.trim() };
  }
}

function scoreGuard(name, ok, weight) {
  return { name, ok, weight, points: ok ? weight : 0 };
}

function scoreLayoutSource() {
  const path = join(root, "src/components/DashboardView.tsx");
  if (!existsSync(path)) return { points: 0, max: 25, details: ["DashboardView missing"] };

  const src = readFileSync(path, "utf8");
  let points = 0;
  const details = [];
  const checks = [
    ["SplitPanelHeader", /SplitPanelHeader/, 5],
    ["left 전체 언급율", /title:\s*"전체 언급율"/, 4],
    ["right AI 모델", /title:\s*"AI 모델 언급율"/, 4],
    ["2-col body grid", /grid lg:grid-cols-2 lg:items-stretch/, 4],
    ["ModelComparisonSection", /ModelComparisonSection/, 3],
    ["compact stacked layout", /ModelComparisonSection compact/, 5],
    ["AreaChart overall", /dataKey="overall"/, 4],
  ];

  for (const [label, pattern, weight] of checks) {
    if (pattern.test(src)) {
      points += weight;
      details.push(`+${weight} ${label}`);
    } else {
      details.push(`0 ${label}`);
    }
  }

  const max = checks.reduce((sum, [, , weight]) => sum + weight, 0);
  return { points, max, details };
}

function scoreApi() {
  const max = 15;
  try {
    const raw = execSync("curl -sf http://127.0.0.1:3000/api/dashboard", {
      cwd: root,
      encoding: "utf8",
      timeout: 8000,
    });
    const json = JSON.parse(raw);
    const dash = json.dashboard ?? json;
    const hasModels = Array.isArray(dash.models) && dash.models.length > 0;
    const hasRuns = dash.project?.recentRunCount > 0;
    let points = 0;
    if (hasRuns) points += 8;
    if (hasModels) points += 7;
    return { points, max, ok: true, project: dash.project?.name ?? "?" };
  } catch {
    return { points: 0, max, ok: false, project: null };
  }
}

const lint = scoreGuard("lint", run("npm run lint").ok, 20);
const typecheck = scoreGuard("typecheck", run("npm run typecheck").ok, 20);
const test = scoreGuard(
  "annatar-test",
  run("npm test -- tests/annatar-mock.integration.test.ts").ok,
  20,
);
const layout = scoreLayoutSource();
const api = scoreApi();

const total =
  lint.points +
  typecheck.points +
  test.points +
  layout.points +
  api.points;
const maxTotal = 20 + 20 + 20 + layout.max + api.max;

const result = {
  score: total,
  maxScore: maxTotal,
  pct: Math.round((total / maxTotal) * 1000) / 10,
  guards: { lint: lint.ok, typecheck: typecheck.ok, test: test.ok },
  layout: layout.details,
  api: { project: api.project, points: api.points },
};

console.log(JSON.stringify(result, null, 2));
process.exit(lint.ok && typecheck.ok && test.ok ? 0 : 1);
