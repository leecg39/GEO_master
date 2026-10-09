// Run with bare Node on every supported runtime; no TS loader, browser or Google account.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { exportProperty } from "./console.mjs";
import { exportFileName, parseCollectConfig, performanceUrl } from "./lib.mjs";

const cli = fileURLToPath(new URL("../gsc-console-collect.mjs", import.meta.url));
const property = { label: "IG @foo", resourceId: "sc-creator-profile:instagram.com/foo" };
const date = "2026-10-09";

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gsc-regression-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const config = { profileDir: path.join(dir, "profile"), outDir: path.join(dir, "out"), properties: [property] };
  const configPath = path.join(dir, "config.json");
  const write = () => fs.writeFile(configPath, JSON.stringify(config));
  await write();
  const run = (...args) => spawnSync(process.execPath, [cli, "--config", configPath, ...args], {
    encoding: "utf8", timeout: 15_000,
    env: { ...process.env, NODE_OPTIONS: "", PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH}` },
  });
  return { dir, config, write, run };
}

test("bare Node dry-run loads the CLI without a TypeScript loader", async (t) => {
  const { config, run } = await fixture(t);
  const result = run("--dry-run");
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).properties, [property]);
  await assert.rejects(fs.access(config.profileDir));
});

test("launchd output uses this Node executable without loader flags", async (t) => {
  const { run } = await fixture(t);
  const result = run("--print-launchd");
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`<string>${process.execPath}</string>`));
  assert.ok(result.stdout.includes(`<string>${cli}</string>`));
});

test("same resource with a different label is rejected before collection", async (t) => {
  const { config, write, run } = await fixture(t);
  config.properties.push({ ...property, label: "Another label", resourceId: ` ${property.resourceId} ` });
  await write();
  const result = run("--no-upload");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /CONFIG_INVALID.*식별자가 중복/);
  await assert.rejects(fs.access(config.profileDir));
});

test("label uniqueness remains case insensitive", () => {
  assert.throws(() => parseCollectConfig({ properties: [property, { label: "ig @FOO", resourceId: "sc-domain:other.com" }] }, { homeDir: "/tmp" }), /이름이 중복/);
});

test("distinct case-sensitive resource paths are not incorrectly merged", () => {
  const properties = [{ label: "A", resourceId: "https://example.com/A/" }, { label: "B", resourceId: "https://example.com/a/" }];
  assert.equal(parseCollectConfig({ properties }, { homeDir: "/tmp" }).properties.length, 2);
});

for (const [first, second] of [["IG @foo", "IG foo"], ["@@@", "!!!"], ["a".repeat(80) + "x", "a".repeat(80) + "y"], ["가", "가"]]) {
  test(`filename collisions are separated: ${first.slice(0, 20)}`, () => {
    const a = exportFileName(first, date, "sc-domain:a.com");
    const b = exportFileName(second, date, "sc-domain:b.com");
    assert.notEqual(a, b);
    assert.equal(a, exportFileName(first, date, "sc-domain:a.com"));
    assert.equal(path.basename(a), a);
  });
}

function fakePage(bytes) {
  let url;
  const locator = { first() { return this; }, async waitFor() {}, async click() {} };
  return {
    async goto(value) { url = value; }, url: () => url,
    getByRole: () => locator,
    waitForURL: () => new Promise(() => {}),
    async waitForEvent() {
      return { async failure() { return null; }, async saveAs(file) { await fs.writeFile(file, bytes); } };
    },
  };
}

test("exportProperty preserves both downloads when labels normalize identically", async (t) => {
  const { dir } = await fixture(t);
  const firstBytes = Buffer.from([0x50, 0x4b, 3, 4, 1]);
  const secondBytes = Buffer.from([0x50, 0x4b, 3, 4, 2]);
  const a = await exportProperty(fakePage(firstBytes), property, { runDir: dir, date });
  const b = await exportProperty(fakePage(secondBytes), { label: "IG foo", resourceId: "sc-domain:other.com" }, { runDir: dir, date });
  assert.notEqual(a.file, b.file);
  assert.deepEqual(await fs.readFile(a.file), firstBytes);
  assert.deepEqual(await fs.readFile(b.file), secondBytes);
  assert.equal((await fs.stat(a.file)).mode & 0o777, 0o600);
  assert.equal((await fs.stat(b.file)).mode & 0o777, 0o600);
});

for (const [name, body, status, error] of [
  ["success", "process.exit(0)", 0, null],
  ["nonzero exit", "process.exit(7)", 2, /BROWSER_LOGIN_FAILED.*7/],
  ["signal exit", 'process.kill(process.pid, "SIGTERM")', 2, /BROWSER_LOGIN_FAILED.*SIGTERM/],
  ["spawn failure", null, 2, /BROWSER_LAUNCH_FAILED/],
]) {
  test(`login ${name} reports the correct status and releases its lock`, async (t) => {
    const { dir, config, write, run } = await fixture(t);
    config.chromePath = path.join(dir, "fake-chrome");
    if (body !== null) await fs.writeFile(config.chromePath, `#!/usr/bin/env node\n${body}\n`, { mode: 0o700 });
    await write();
    const result = run("--login");
    assert.equal(result.status, status, result.stderr);
    if (error) {
      assert.match(result.stderr, error);
      assert.doesNotMatch(result.stdout, /이제.*수집할 수/);
    } else assert.match(result.stdout, /이제.*수집할 수/);
    await assert.rejects(fs.access(`${config.profileDir}.collect.lock`));
  });
}

test("the mock download uses the requested resource URL", async (t) => {
  const { dir } = await fixture(t);
  const page = fakePage(Buffer.from([0x50, 0x4b, 3, 4]));
  await exportProperty(page, property, { runDir: dir, date });
  assert.equal(page.url(), performanceUrl(property.resourceId));
});

test("long Korean labels stay within filesystem filename byte limits", () => {
  const file = exportFileName("한".repeat(120), date, property.resourceId);
  assert.ok(Buffer.byteLength(file) <= 255);
});
