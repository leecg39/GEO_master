// Frozen benchmark runner: verifies the evaluator hashes, runs the scenarios and writes the score.
// Usage (from the repository root): node autoresearch/signup/eval/prepare.mjs <run-label>
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { CATEGORIES, outerScore } from "../meta_eval/outer-score.mjs";

const EXPECTED_TESTS = 27;
const base = path.resolve("autoresearch/signup");
const label = process.argv[2] ?? "latest";
if (!/^[a-z0-9-]+$/.test(label)) throw new Error("Use a simple run label");

const manifest = JSON.parse(fs.readFileSync(path.join(base, "eval/frozen.json"), "utf8"));
for (const [file, expected] of Object.entries(manifest)) {
  const actual = crypto.createHash("sha256").update(fs.readFileSync(path.join(base, file))).digest("hex");
  if (actual !== expected) throw new Error(`Frozen evaluator changed: ${file}`);
}

fs.mkdirSync(path.join(base, "results"), { recursive: true });
const report = path.join(base, "results", `${label}-tests.json`);
const run = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--config", "autoresearch/signup/eval/vitest.config.mts", "--reporter=json", `--outputFile=${report}`], { encoding: "utf8", timeout: 180000 });
fs.writeFileSync(path.join(base, "results", `${label}-run.log`), (run.stdout ?? "") + (run.stderr ?? ""));
if (run.error || !fs.existsSync(report)) throw run.error ?? new Error("No test report");

const result = JSON.parse(fs.readFileSync(report, "utf8"));
const tests = result.testResults.flatMap((item) => item.assertionResults);
if (tests.length !== EXPECTED_TESTS || tests.some((item) => !["passed", "failed"].includes(item.status))) {
  throw new Error(`Incomplete benchmark: ${tests.length}/${EXPECTED_TESTS} scenarios reported`);
}

const groups = Object.fromEntries(CATEGORIES.map((category) => [category, { passed: 0, total: 0 }]));
for (const test of tests) {
  const group = groups[test.ancestorTitles[0]];
  if (!group) throw new Error(`Unknown category: ${test.ancestorTitles[0]}`);
  group.total += 1;
  if (test.status === "passed") group.passed += 1;
}
const passed = tests.filter((item) => item.status === "passed").length;
const summary = {
  passed,
  total: tests.length,
  metric: Math.round((passed / tests.length) * 1000) / 10,
  outerScore: Math.round(outerScore(groups) * 10) / 10,
  groups,
  failed: tests.filter((item) => item.status !== "passed").map((item) => item.fullName),
};
fs.writeFileSync(path.join(base, "results", `${label}-score.json`), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify({ label, metric: summary.metric, passed, total: summary.total, outerScore: summary.outerScore, groups }));
