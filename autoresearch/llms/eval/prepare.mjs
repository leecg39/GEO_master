import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { outerScore } from '../meta_eval/outer-score.mjs';
const base = path.resolve('autoresearch/llms');
const label = process.argv[2] ?? 'latest';
if (!/^[a-z0-9-]+$/.test(label)) throw new Error('Use a simple run label');
const manifest = JSON.parse(fs.readFileSync(path.join(base, 'eval/frozen.json'), 'utf8'));
for (const [file, expected] of Object.entries(manifest)) {
  const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(base, file))).digest('hex');
  if (actual !== expected) throw new Error(`Frozen evaluator changed: ${file}`);
}
fs.mkdirSync(path.join(base, 'results'), { recursive: true });
const report = path.join(base, 'results', `${label}-tests.json`);
const run = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'autoresearch/llms/eval/', '--reporter=json', `--outputFile=${report}`], { encoding: 'utf8', timeout: 60000 });
fs.writeFileSync(path.join(base, 'results', `${label}-run.log`), (run.stdout ?? '') + (run.stderr ?? ''));
if (run.error || !fs.existsSync(report)) throw run.error ?? new Error('No test report');
const result = JSON.parse(fs.readFileSync(report, 'utf8'));
const tests = result.testResults.flatMap(item => item.assertionResults);
if (tests.length !== 25 || tests.some(item => !['passed', 'failed'].includes(item.status))) throw new Error('Incomplete benchmark');
const groups = {};
for (const test of tests) {
  const group = test.ancestorTitles[0];
  groups[group] ??= { passed: 0, total: 0 };
  groups[group].total++;
  if (test.status === 'passed') groups[group].passed++;
}
const passed = tests.filter(item => item.status === 'passed').length;
const summary = { passed, total: tests.length, metric: passed / tests.length * 100, outerScore: outerScore(groups), groups, failed: tests.filter(item => item.status !== 'passed').map(item => item.fullName) };
fs.writeFileSync(path.join(base, 'results', `${label}-score.json`), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
