// test/cli-auto.test.mjs
// Spawn harness = test/cli-args.test.mjs (temp repo + useTempHome + spawnSync) and the
// interactive pipe driver of test/cli-interactive.test.mjs (inlined, minimal). A piped
// child has no TTY, so the CLI prints NO ANSI colour codes and the cues below match.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb } from '../src/core/db.mjs';
import { listSubAgents } from '../src/core/artifacts.mjs';

const CLI = resolve(fileURLToPath(import.meta.url), '..', '..', 'src', 'cli', 'worca-cc.mjs');
const home = useTempHome(after, 'worca-cc-cliauto-home-');
const scratch = [];
after(() => Promise.all(scratch.map((d) => rm(d, { recursive: true, force: true }))));

function freshRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-cliauto-repo-'));
  scratch.push(dir);
  const g = (a) => spawnSync('git', a, { cwd: dir });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  writeFileSync(join(dir, 'seed.txt'), 'seed\n'); g(['add', '-A']); g(['commit', '-qm', 'init']);
  return dir;
}
const runCli = (args) => spawnSync(process.execPath, [CLI, ...args], { env: { ...process.env, WORCA_HOME: home, WORCA_MOCK: '1' }, encoding: 'utf8' });
const newestRow = () => getDb().prepare('SELECT id, status, stepper FROM pipelines ORDER BY started_at DESC, rowid DESC LIMIT 1').get();

function driveCli(args, script, { timeoutMs = 60000 } = {}) {
  return new Promise((res) => {
    const child = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, WORCA_HOME: home, WORCA_MOCK: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdin.on('error', () => {});
    let stdout = ''; let stderr = ''; let pos = 0; let sent = 0;
    const pump = () => {
      while (sent < script.length) {
        const { cue, send } = script[sent];
        const m = cue.exec(stdout.slice(pos));
        if (!m) break;
        pos += m.index + m[0].length; sent += 1; child.stdin.write(send);
      }
    };
    child.stdout.on('data', (b) => { stdout += b.toString(); pump(); });
    child.stderr.on('data', (b) => { stderr += b.toString(); });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('exit', (code) => { clearTimeout(timer); res({ code, stdout, stderr, sent }); });
  });
}

test('--workflow auto --yes runs the Auto workflow non-interactively to done', () => {
  const r = runCli(['--project', freshRepo(), '--prompt', 'demo task', '--workflow', 'auto', '--yes']);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const row = newestRow();
  assert.equal(row.status, 'done');
  const st = JSON.parse(row.stepper);
  assert.equal(st.auto.status, 'decided');
  assert.equal(st.auto.humanInLoop, false);
  assert.ok(listSubAgents(row.id).some((s) => s.subagentType === 'auto-classify'));
});

test('--no-human without --yes: no proposal prompt, the run completes; on a saved workflow it warns; --help documents both flags', () => {
  const r = runCli(['--project', freshRepo(), '--prompt', 'demo task', '--workflow', 'wf_auto', '--no-human']);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.ok(!/Choose \[a\/r\/c\]/.test(r.stdout));
  assert.equal(JSON.parse(newestRow().stepper).auto.humanInLoop, false);
  const saved = runCli(['--project', freshRepo(), '--prompt', 'demo task', '--workflow', 'wf_default', '--no-human', '--yes']);
  assert.equal(saved.status, 0, saved.stderr + saved.stdout);
  assert.match(saved.stdout, /--no-human only affects the Auto workflow/);
  const h = runCli(['--help']);
  assert.match(h.stdout, /--workflow <id>\s+Saved pipeline template to run \(default: wf_default — the built-in graph\)/);
  assert.match(h.stdout, /auto \(= wf_auto\) lets worca pick the workflow per task/);
  assert.match(h.stdout, /--no-human\s+Auto workflow only: no proposal, no clarify, no agent questions \(loop-budget, recovery, cost and error pauses still apply\)/);
});

test('interactive: the proposal renders, revise re-asks, accept runs; cancel stops', async () => {
  const r = await driveCli(['--project', freshRepo(), '--prompt', 'demo task', '--workflow', 'auto'], [
    { cue: /Choose \[a\/r\/c\]:/, send: 'r\n' },
    { cue: /What should change\?/, send: 'make it a quick fix\n' },
    { cue: /Choose \[a\/r\/c\]:/, send: '\n' },            // empty = accept
  ]);
  assert.equal(r.sent, 3, r.stdout);
  assert.equal(r.code, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /\? Auto proposes a workflow · round 1/);
  assert.match(r.stdout, /\? Auto proposes a workflow · round 2/);
  assert.match(r.stdout, /stages: /);
  const row = newestRow();
  assert.equal(row.status, 'done');
  assert.equal(JSON.parse(row.stepper).auto.rounds, 2);
  assert.deepEqual(listSubAgents(row.id).filter((s) => s.subagentType === 'auto-classify').map((s) => s.id), ['auto-classify-1', 'auto-classify-2']);

  const c = await driveCli(['--project', freshRepo(), '--prompt', 'demo task', '--workflow', 'auto'], [
    { cue: /Choose \[a\/r\/c\]:/, send: 'c\n' },
  ]);
  assert.equal(c.sent, 1, c.stdout);
  assert.notEqual(c.code, 0, 'a cancelled run is a stopped run (exit 1, like any non-done run)');
  assert.equal(newestRow().status, 'stopped');
});

test('finding 4: --no-human with an unanswerable stdin is refused BEFORE any row exists, and the refusal names both flags', () => {
  const rows = () => getDb().prepare('SELECT count(*) AS n FROM pipelines').get().n;
  const before = rows();
  const r = spawnSync(process.execPath, [CLI, '--project', freshRepo(), '--prompt', 'ci run', '--workflow', 'auto', '--no-human'], {
    env: { ...process.env, WORCA_HOME: home, WORCA_MOCK: '1' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(r.status, 2, `expected the fail() exit code\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  assert.equal(
    r.stderr.trim(),
    'worca: stdin cannot answer prompts (it is /dev/null or closed) — --no-human leaves the loop-budget and recovery gates interactive; pass --yes for a non-interactive run.',
  );
  assert.equal(rows(), before, 'refused before start(): no pipelines row');
});
