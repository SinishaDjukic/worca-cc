// test/cli-sigterm.test.mjs — #441: a SIGTERM to a headless CLI run (docker stop, a pod eviction, a CI
// cancel) PAUSES it, the way the first Ctrl+C does, instead of killing it with no resume point. The CLI
// waits for the pause to land, exits 143, ignores a second SIGTERM, and still exits when the pause wedges.
//
// These spawn the real CLI: the handler lives in worca-cc.mjs's attachAndDrive, which runs main() on
// import. The run is held mid-step by a stub `claude` that sleeps on the Clarify node, so the signal
// always lands while an agent child is in flight.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { useTempHome } from './helpers/temp-home.mjs';
import { templateRepo } from './helpers/git-dir.mjs';
import { getDb } from '../src/core/db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, '..', 'src', 'cli', 'worca-cc.mjs');
const home = useTempHome(after, 'worca-cc-clisig-home-');
const scratch = [];
after(() => Promise.all(scratch.map((d) => rm(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }))));

// The stub is a POSIX shell script, and child.kill('SIGTERM') is TerminateProcess on Windows.
const POSIX = { skip: process.platform === 'win32' ? 'a POSIX stub and a deliverable SIGTERM' : false, timeout: 60000 };

/**
 * A stub `claude` whose Clarify spawn marks `started` and sleeps; every other spawn (the title job, the
 * capabilities probe) exits 1 at once. `wedge` makes the sleeper ignore SIGTERM, so the pause cannot land.
 */
function sleepyClaude({ wedge = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-clisig-bin-'));
  scratch.push(dir);
  const started = join(dir, 'started');
  const bin = join(dir, 'claude');
  writeFileSync(bin, `#!/bin/sh
case "$*" in
  *"# Task: Clarify"*) : > "${started}"; ${wedge ? "trap '' TERM; " : ''}exec sleep 15 ;;
esac
exit 1
`);
  chmodSync(bin, 0o755);
  return { bin, started };
}

/** Spawn the CLI; SIGTERM it once the stub's Clarify spawn is up, and with `again` once more after it printed that it is pausing. */
function driveSigterm(args, stub, { env = {}, again = false } = {}) {
  return new Promise((res) => {
    const childEnv = { ...process.env, WORCA_HOME: home, WORCA_CLAUDE_BIN: stub.bin,
      // PATH prefix: the capabilities probe bare-PATH-looks-up `claude` (see cli-interactive.test.mjs).
      PATH: `${dirname(stub.bin)}:${process.env.PATH}`, ...env };
    delete childEnv.WORCA_MOCK;
    const child = spawn(process.execPath, [CLI, ...args], { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let sentAt = null;
    let sentAgain = false;
    child.stdout.on('data', (b) => {
      stdout += b;
      if (again && !sentAgain && /SIGTERM received/.test(stdout)) { sentAgain = true; child.kill('SIGTERM'); }
    });
    child.stderr.on('data', (b) => { stderr += b; });
    const poll = setInterval(() => {
      if (!existsSync(stub.started)) return;
      clearInterval(poll);
      sentAt = Date.now();
      child.kill('SIGTERM');
    }, 50);
    const timer = setTimeout(() => child.kill('SIGKILL'), 45000);
    child.on('exit', (code, signal) => {
      clearInterval(poll);
      clearTimeout(timer);
      res({ code, signal, stdout, stderr, sentAt, exitedAfterMs: sentAt == null ? null : Date.now() - sentAt });
    });
  });
}

function freshRepo() {
  const dir = templateRepo('clisig-repo', { branch: 'main', user: true, files: { 'seed.txt': 'seed\n' }, prefix: 'worca-cc-clisig-repo-' });
  scratch.push(dir);
  return dir;
}

const row = (id) => getDb().prepare('SELECT status, resume_point FROM pipelines WHERE id = ?').get(id);
const pipelineIdFrom = (stdout) => /worca resume ([0-9a-f]{8})/.exec(stdout)?.[1] || null;

test('SIGTERM pauses a --yes run mid-step: exit 143, a v2 resume point, and `worca resume` finishes it', POSIX, async () => {
  const repo = freshRepo();
  const stub = sleepyClaude();
  // A second SIGTERM while the first pause lands is ignored: never a stop, never a second pause.
  const r = await driveSigterm(['--project', repo, '--prompt', 'sigterm pause e2e', '--yes'], stub, { again: true });
  assert.ok(r.sentAt, `the Clarify step never started:\n${r.stdout}\n${r.stderr}`);
  assert.equal(r.signal, null, 'the CLI handled SIGTERM instead of dying of it');
  assert.equal(r.code, 143, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  assert.equal(r.stdout.match(/^SIGTERM received — pausing the run…$/gm)?.length, 1, r.stdout);
  assert.match(r.stdout, /Pipeline paused: worca was stopped — the process received SIGTERM/);
  assert.doesNotMatch(r.stdout, /Pipeline stopped\./, 'the second SIGTERM did not turn the pause into a stop');
  const id = pipelineIdFrom(r.stdout);
  assert.ok(id, `no resume hint in:\n${r.stdout}`);
  const saved = row(id);
  assert.equal(saved.status, 'paused');
  const rp = JSON.parse(saved.resume_point);
  assert.equal(rp.version, 2);
  assert.equal(rp.pauseReason, 'terminated');

  // The pause is resumable as is: the mock engine carries the run on to the end.
  const resumed = await new Promise((res) => {
    const child = spawn(process.execPath, [CLI, 'resume', id, '--mock', '--yes'], {
      cwd: repo, env: { ...process.env, WORCA_HOME: home }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (b) => { out += b; });
    child.stderr.on('data', (b) => { out += b; });
    child.on('exit', (code) => res({ code, out }));
  });
  assert.equal(resumed.code, 0, resumed.out);
  assert.match(resumed.out, /Pipeline complete\./);
  assert.equal(row(id).status, 'done');
});

test('SIGTERM with a wedged pause still exits 143 once WORCA_SIGTERM_GRACE_MS runs out', POSIX, async () => {
  const repo = freshRepo();
  const stub = sleepyClaude({ wedge: true });
  const r = await driveSigterm(['--project', repo, '--prompt', 'sigterm wedge e2e', '--yes'], stub, {
    // The runner's SIGKILL escalation comes long after the CLI's own grace: only the grace can end it.
    env: { WORCA_SIGTERM_GRACE_MS: '1500', WORCA_SIGKILL_GRACE_MS: '60000' },
  });
  assert.ok(r.sentAt, `the Clarify step never started:\n${r.stdout}\n${r.stderr}`);
  assert.equal(r.signal, null);
  assert.equal(r.code, 143, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  assert.match(r.stderr, /the run did not pause within 2 s of SIGTERM; exiting/);
  assert.ok(r.exitedAfterMs < 15000, `exited ${r.exitedAfterMs} ms after the signal, not at the grace`);
});
