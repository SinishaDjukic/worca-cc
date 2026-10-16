// test/readiness-cli.test.mjs — `worca readiness` end to end through the real CLI process.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { execSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { useTempHome } from './helpers/temp-home.mjs';
import { writeProjectSettings } from '../src/core/settings-cascade.mjs';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli', 'worca-cc.mjs');
const home = useTempHome(after);
const scratch = [];

function runCli(args, { env = {}, cwd = process.cwd() } = {}) {
  return new Promise((res) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, WORCA_HOME: home, WORCA_READINESS: '1', ...env },
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => (stdout += b.toString()));
    child.stderr.on('data', (b) => (stderr += b.toString()));
    child.on('exit', (code) => res({ code: code ?? 0, stdout, stderr }));
  });
}

function tmp() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ready-cli-')));
  scratch.push(dir);
  return dir;
}

function gitRepo({ files = {} } = {}) {
  const dir = tmp();
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  execSync('git init -q && git config user.email "t@t" && git config user.name "T" && git add -A && git commit --allow-empty -m init -q', { cwd: dir, stdio: 'ignore' });
  return dir;
}

after(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true }); });

describe('worca readiness', () => {
  let ready;
  let notReady;
  before(() => {
    ready = gitRepo({ files: { 'AGENTS.md': '# Project\n\nRun `npm test` to test.\n', 'CLAUDE.md': '@AGENTS.md\n', 'package.json': '{"scripts":{"test":"jest"}}' } });
    notReady = gitRepo();
  });

  it('exits 0 for a partial repo (warnings only) and lists the warnings', async () => {
    const r = await runCli(['readiness', '--project', ready]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /^Project: .*\nJudged: Claude Code \(runs use it\)\nResult: Partly ready\. 1 should fix\. \d+ of \d+ checks pass\./m);
    assert.match(r.stdout, /Warnings:\n  deps\.lockfile: /);
    assert.doesNotMatch(r.stdout, /Blocker failures/);
  });

  it('exits 2 and prints blocker failures with their fix for a repo without instructions', async () => {
    const r = await runCli(['readiness', '--project', notReady]);
    assert.equal(r.code, 2, r.stderr);
    assert.match(r.stdout, /Blocker failures:/);
    assert.match(r.stdout, /^Result: Not ready\. 1 must fix/m);
    assert.match(r.stdout, /instructions\.present \(Claude Code\): /);
    assert.match(r.stdout, /instructions\.present \(Claude Code\): Add AGENTS\.md \(OpenAI Codex and GitHub Copilot read it too\) or CLAUDE\.md\./);
  });

  it('applies the project readiness.ignore list, so a muted blocker no longer fails the exit code', async () => {
    const muted = gitRepo();
    const before = await runCli(['readiness', '--project', muted]);
    assert.equal(before.code, 2, before.stderr);
    writeProjectSettings({ projectDir: muted }, { 'readiness.ignore': ['instructions.present'] });
    const after = await runCli(['readiness', '--project', muted]);
    assert.equal(after.code, 0, after.stdout + after.stderr);
    assert.doesNotMatch(after.stdout, /instructions\.present/);
  });

  it('exits 2 for a directory that is not a git repo', async () => {
    const r = await runCli(['readiness', '--project', tmp()]);
    assert.equal(r.code, 2, r.stderr);
    assert.match(r.stdout, /git\.repo: Runs check out a git worktree/);
  });

  it('--json prints the report', async () => {
    const r = await runCli(['readiness', '--project', ready, '--json']);
    assert.equal(r.code, 0, r.stderr);
    const report = JSON.parse(r.stdout);
    assert.equal(typeof report.catalogVersion, 'number');
    assert.ok(report.engines.claude);
    assert.ok(Array.isArray(report.checks));
  });

  it('--json keeps the not-ready exit code', async () => {
    const r = await runCli(['readiness', '--project', notReady, '--json']);
    assert.equal(r.code, 2);
    const report = JSON.parse(r.stdout);
    assert.equal(report.level, 'not-ready');
    assert.equal(report.engines.claude.level, 'not-ready');
    assert.equal(report.engines.codex.level, 'unused');
  });

  it('--engine judges only the named engine', async () => {
    const r = await runCli(['readiness', '--project', notReady, '--engine', 'codex']);
    assert.equal(r.code, 2, r.stderr);
    assert.match(r.stdout, /^Judged: OpenAI Codex$/m);
    assert.doesNotMatch(r.stdout, /Claude Code/);
  });

  it('--engine repeats: every named engine is judged, and either one not ready exits 2', async () => {
    // Copilot reads CLAUDE.md; Codex does not.
    const claudeOnly = gitRepo({ files: { 'CLAUDE.md': '# c\n' } });
    const r = await runCli(['readiness', '--project', claudeOnly, '--engine', 'codex', '--engine', 'copilot']);
    assert.equal(r.code, 2, r.stderr);
    assert.match(r.stdout, /^Judged: OpenAI Codex, GitHub Copilot$/m);
    assert.match(r.stdout, /instructions\.present \(OpenAI Codex\)/);
    assert.doesNotMatch(r.stdout, /instructions\.present \(GitHub Copilot\)/);
  });

  it('judges only the run engine by default: a repo with CLAUDE.md only is ready', async () => {
    const claudeOnly = gitRepo({ files: { 'CLAUDE.md': '# c\n' } });
    const r = await runCli(['readiness', '--project', claudeOnly]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^Judged: Claude Code \(runs use it\)$/m);
    assert.match(r.stdout, /^Result: Ready\./m);
    assert.doesNotMatch(r.stdout, /OpenAI Codex/);
  });

  it('--engine with an unknown name exits 1', async () => {
    const r = await runCli(['readiness', '--project', ready, '--engine', 'nope']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /unknown engine "nope"/);
  });

  it('defaults to the current directory', async () => {
    const r = await runCli(['readiness'], { cwd: ready });
    assert.equal(r.code, 0, r.stderr);
    assert.ok(r.stdout.includes(ready));
  });

  it('resolves a registered project by name', async () => {
    const dir = gitRepo({ files: { 'AGENTS.md': '# x\n', 'CLAUDE.md': '@AGENTS.md\n' } });
    const added = await runCli(['add', 'ready-by-name', '--path', dir]);
    assert.equal(added.code, 0, added.stderr);
    const r = await runCli(['readiness', '--project', 'ready-by-name']);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /Project: ready-by-name/);
  });

  it('exits 1 for a project that does not exist', async () => {
    const r = await runCli(['readiness', '--project', join(tmpdir(), 'no-such-dir-ready-cli')]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /not found|does not exist/);
  });

  it('exits 1 for an unknown option', async () => {
    const r = await runCli(['readiness', '--bogus']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /--bogus/);
  });

  it('honors the kill switch unless --force', async () => {
    const off = { env: { WORCA_READINESS: '0' } };
    const skipped = await runCli(['readiness', '--project', notReady], off);
    assert.equal(skipped.code, 0);
    assert.match(skipped.stdout, /disabled/);
    assert.doesNotMatch(skipped.stdout, /Blocker failures/);

    const forced = await runCli(['readiness', '--project', notReady, '--force'], off);
    assert.equal(forced.code, 2);
    assert.match(forced.stdout, /Blocker failures:/);
  });
});
