// test/workflow-test-before-run.test.mjs — workflow tests 3b, Task 9 (D74, D75): the command on the start commit, in its own clone
// of Worca's copy; kept per start point, setup and command; made again when the copy is; and a try's own command run reads every
// line of its output.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { templateRepo } from './helpers/git-dir.mjs';
import { repoSnapshot } from './helpers/repo-snapshot.mjs';

let home, real, key, pin, copyDir, mod, pc, shell, result;
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
// A tiny suite in the project: TAP, "rounds" passes while state.txt says pass.
const CHECK_JS = "const ok=require('fs').readFileSync('state.txt','utf8').trim()==='pass';"
  + "console.log(['TAP version 13','ok 1 - adds',(ok?'ok':'not ok')+' 2 - rounds','1..2','# pass '+(ok?2:1),'# fail '+(ok?0:1)].join('\\n'));"
  + 'process.exitCode=ok?0:1;\n';
const spec = (over = {}) => ({ key, startCommit: pin.startCommit, setupCmd: null, cmd: 'node check.js', timeoutMin: 1, ...over });
const runFolders = () => (existsSync(pc.beforeRoot()) ? readdirSync(pc.beforeRoot()).filter((n) => n.startsWith('run-') && !n.endsWith('.owner.json')) : []);

before(async () => {
  home = mkdtempSync(join(tmpdir(), 'worca-cc-wftbefore-'));
  _resetForTests();
  process.env.WORCA_HOME = home;
  real = templateRepo('wftbefore', { branch: 'main', user: true, files: { 'check.js': CHECK_JS, 'state.txt': 'pass\n', 'README.md': '# hi\n' } });
  key = (await import('../src/core/store.mjs')).projectKey(real);
  pc = await import('../src/core/workflow-tests/project-copy.mjs');
  pin = await pc.pinStart({ key, name: 'tickets', projectDir: real });
  copyDir = join(home, '.worca-cc', 'workflow-tests', 'repos', key);   // worcaHome() is <WORCA_HOME>/.worca-cc
  mod = await import('../src/core/workflow-tests/before-run.mjs');
  shell = await import('../src/core/workflow-tests/shell-step.mjs');
  result = await import('../src/core/workflow-tests/result.mjs');
});
after(() => { _resetForTests(); delete process.env.WORCA_HOME; for (const d of [home, real]) rmSync(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); });

test('runShellStep hands every line to onLine and still keeps only the tail', async () => {
  const seen = [];
  const r = await shell.runShellStep({ command: 'node -e "for(let i=0;i<100;i++)console.log(\'line \'+i)"', cwd: home, env: shell.tryShellEnv(),
    timeoutMs: 60_000, onLine: (l) => seen.push(l) });
  assert.equal(r.ok, true);
  assert.equal(seen.length, 100);
  assert.equal(r.tail.split('\n').length, shell.TAIL_LINES);
  assert.equal(seen[0], 'line 0');
});

test('runCommandCheck reads the test names in the whole output, with its exit code and time', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-wftcmd-'));
  try {
    writeFileSync(join(dir, 'check.js'), CHECK_JS);
    writeFileSync(join(dir, 'state.txt'), 'fail\n');
    const r = await result.runCommandCheck({ cmd: 'node check.js', timeoutMin: 1 }, { cwd: dir });
    assert.deepEqual([r.met, r.exitCode, r.value], [false, 1, '1 passed, 1 failed']);
    assert.equal(typeof r.ms, 'number');
    assert.deepEqual([r.tests.format, r.tests.pass, r.tests.fail], ['tap', ['adds'], ['rounds']]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a fresh run: its own clone of the copy at the start commit, no remote, removed after; nothing registered in the copy; the project only read', async () => {
  const was = repoSnapshot(real);
  const wtBefore = git(copyDir, 'worktree', 'list', '--porcelain');
  const phases = [];
  let inClone = null;
  const r = await mod.beforeRun(spec(), { onPhase: (p) => phases.push(p), run: async (o) => {
    inClone = inClone || { cwd: o.cwd, remotes: git(o.cwd, 'remote'), head: git(o.cwd, 'rev-parse', 'HEAD'), ref: git(o.cwd, 'rev-parse', '--abbrev-ref', 'HEAD') };
    return shell.runShellStep(o);
  } });
  assert.deepEqual([r.ran, r.ok, r.exitCode, r.cached, r.timedOut], [true, true, 0, false, false]);
  assert.deepEqual([r.tests.format, r.tests.pass, r.tests.fail], ['tap', ['adds', 'rounds'], []]);
  assert.equal(r.summary, '2 passed');
  assert.deepEqual(phases, ['copy', 'command'], 'no setup to run');
  assert.deepEqual([inClone.remotes, inClone.head, inClone.ref], ['', pin.startCommit, 'HEAD'], 'no remote, detached at the start commit');
  assert.ok(inClone.cwd.startsWith(pc.beforeRoot()), 'under <worcaHome>/workflow-tests/before');
  assert.equal(existsSync(inClone.cwd), false, 'the clone is removed');
  assert.deepEqual(runFolders(), []);
  assert.equal(git(copyDir, 'worktree', 'list', '--porcelain'), wtBefore, 'nothing registered in the copy');
  assert.equal(repoSnapshot(real), was, 'the person\'s repository is only read');
});

test('kept: the same start point, setup and command reuse it; a new setup, a new copy stamp or a week make a fresh run', async () => {
  const again = await mod.beforeRun(spec());
  assert.equal(again.cached, true);
  assert.equal(again.ok, true);
  const phases = [];
  const withSetup = await mod.beforeRun(spec({ setupCmd: 'node -e "require(\'fs\').writeFileSync(\'setup-ran.txt\',\'1\')"' }), { onPhase: (p) => phases.push(p) });
  assert.deepEqual([withSetup.cached, phases], [false, ['copy', 'setup', 'command']]);
  writeFileSync(join(copyDir, '.git', pc.COPY_STAMP_FILE), 'made again\n');
  assert.equal((await mod.beforeRun(spec())).cached, false, 'the copy was made again');
  assert.equal((await mod.beforeRun(spec())).cached, true);
  const kept = join(pc.beforeRoot(), 'cache', key, `${mod.beforeHash(spec())}.json`);
  const rec = JSON.parse(readFileSync(kept, 'utf8'));
  writeFileSync(kept, JSON.stringify({ ...rec, at: new Date(Date.now() - 8 * 24 * 60 * 60_000).toISOString() }));
  assert.equal(await mod.readBefore(spec()), null, 'older than a week');
  assert.equal((await mod.beforeRun(spec())).cached, false);
});

test('not kept: a setup that fails, a time-out, a stop, an error; each leaves no clone', async () => {
  const s1 = spec({ setupCmd: 'node -e "process.exit(3)"' });
  assert.deepEqual(await mod.beforeRun(s1), { ran: false, reason: 'setup' });
  assert.equal(await mod.readBefore(s1), null);
  const s2 = spec({ timeoutMin: 5 });
  const t = await mod.beforeRun(s2, { run: async (o) => (o.command === 'node check.js' ? { ok: false, exitCode: null, timedOut: true, ms: 5, tail: '' } : shell.runShellStep(o)) });
  assert.deepEqual([t.ran, t.timedOut], [true, true]);
  assert.equal(await mod.readBefore(s2), null, 'a run its time limit stopped is not kept');
  const ac = new AbortController();
  ac.abort();
  assert.deepEqual(await mod.beforeRun(spec({ timeoutMin: 10 }), { signal: ac.signal }), { ran: false, reason: 'stopped' });
  assert.deepEqual(await mod.beforeRun(spec({ timeoutMin: 30 }), { clone: async () => { throw new Error('boom\nmore'); } }), { ran: false, reason: 'error', text: 'boom' });
  assert.deepEqual(runFolders(), []);
});

test('the boot sweep: a dead owner\'s clone goes, a live one stays, a stale heartbeat goes, old kept results go', async () => {
  const root = pc.beforeRoot();
  const mk = (name, owner) => { mkdirSync(join(root, name), { recursive: true }); writeFileSync(join(root, name, 'x.txt'), 'x'); writeFileSync(join(root, `${name}.owner.json`), JSON.stringify(owner)); };
  const now = Date.now();
  mk('run-aaaaaaaaaaaa', { pid: 999_999_999, at: new Date(now).toISOString() });
  mk('run-bbbbbbbbbbbb', { pid: process.pid, at: new Date(now).toISOString() });
  mk('run-cccccccccccc', { pid: process.pid, at: new Date(now - 60 * 60_000).toISOString() });
  const old = join(root, 'cache', key, 'old.json');
  writeFileSync(old, '{}');
  const t = (now - 8 * 24 * 60 * 60_000) / 1000;
  utimesSync(old, t, t);
  const out = await mod.sweepBeforeRuns({ now, alive: (pid) => pid === process.pid });
  assert.deepEqual(out, { runs: 2, kept: 1 });
  assert.deepEqual(runFolders(), ['run-bbbbbbbbbbbb']);
  assert.equal(existsSync(old), false);
  rmSync(join(root, 'run-bbbbbbbbbbbb'), { recursive: true, force: true });
  rmSync(join(root, 'run-bbbbbbbbbbbb.owner.json'), { force: true });
});

test('checkTry: a command result carries the before and after, its time, and the first failing names', async () => {
  const ex = { basics: { noError: false, noHelp: false, maxCostUsd: null, maxSentBack: null }, checks: [{ id: 'c_1', kind: 'command', cmd: 'npm test', timeoutMin: 10 }] };
  const outcome = { pipelineId: null, facts: { status: 'done', costUsd: 0, help: [] }, text: null, files: [], logFile: null,
    project: { touched: [], total: 0, checkoutDir: '/x' } };
  const tap = (pass, fail) => ({ format: 'tap', pass, fail, skip: [], passListed: true, counts: null, truncated: false });
  const v = await result.checkTry(ex, outcome, {
    runCommand: async () => ({ met: false, value: '1 passed, 1 failed', output: 'x', exitCode: 1, ms: 1234, tests: tap(['adds'], ['rounds']) }),
    beforeOf: (c) => (c.id === 'c_1' ? { ran: true, ok: true, exitCode: 0, timedOut: false, tests: tap(['adds', 'rounds'], []), at: '2026-10-28T09:00:00.000Z', cached: true } : null),
  });
  const c = v.checks[0];
  assert.deepEqual([c.ms, c.failed, c.failedCount], [1234, ['rounds'], 1]);
  assert.deepEqual([c.before.level, c.before.broke, c.before.stillPass, c.before.cached], ['tests', { n: 1, names: ['rounds'] }, { n: 1 }, true]);
  const none = await result.checkTry(ex, outcome, { runCommand: async () => ({ met: true, value: 'Met', output: '' }) });
  assert.equal('before' in none.checks[0], false, 'no before run: no before');
  assert.equal('failed' in none.checks[0], false);
});

test('checkTry: "breaks nothing that passed before" is met on the before run\'s evidence, and says why (D82)', async () => {
  const tap = (pass, fail) => ({ format: 'tap', pass, fail, skip: [], passListed: true, counts: null, truncated: false });
  const ex = (metWhen) => ({ basics: { noError: false, noHelp: false, maxCostUsd: null, maxSentBack: null },
    checks: [{ id: 'c_1', kind: 'command', cmd: 'npm test', timeoutMin: 10, ...(metWhen ? { metWhen } : {}) }] });
  const outcome = { pipelineId: null, facts: { status: 'done', costUsd: 0, help: [] }, text: null, files: [], logFile: null,
    project: { touched: [], total: 0, checkoutDir: '/x' } };
  const runCommand = async () => ({ met: false, value: '2 passed, 1 failed', output: 'x', exitCode: 1, ms: 5, tests: tap(['adds', 'rounds'], ['a new test']) });
  const beforeOf = () => ({ ran: true, ok: true, exitCode: 0, timedOut: false, tests: tap(['adds', 'rounds'], []), at: '2026-10-28T09:00:00.000Z', cached: false });
  const met = (await result.checkTry(ex('breaks-nothing'), outcome, { runCommand, beforeOf })).checks[0];
  assert.deepEqual([met.met, met.metWhen, met.metWhy], [true, 'breaks-nothing', { why: 'nothing-broke' }], 'a new test that fails broke nothing that passed before');
  assert.equal(met.label, 'The command npm test breaks nothing that passed before');
  const plain = (await result.checkTry(ex(null), outcome, { runCommand, beforeOf })).checks[0];
  assert.deepEqual([plain.met, 'metWhen' in plain, 'metWhy' in plain], [false, false, false], 'the default: the exit code');
  const noBefore = (await result.checkTry(ex('breaks-nothing'), outcome, { runCommand })).checks[0];
  assert.deepEqual([noBefore.met, noBefore.metWhy], [false, { why: 'no-before' }]);
  const broke = (await result.checkTry(ex('breaks-nothing'), outcome, { beforeOf,
    runCommand: async () => ({ met: false, value: '1 passed, 1 failed', output: 'x', exitCode: 1, ms: 5, tests: tap(['adds'], ['rounds']) }) })).checks[0];
  assert.deepEqual([broke.met, broke.metWhy], [false, { why: 'broke', n: 1 }]);
});

// Task 9 fix round 1 (review I1): callers of the same before run share it, but not each other's stop or progress.
const until = async (ok, ms = 20_000) => { const end = Date.now() + ms; while (!ok()) { if (Date.now() > end) throw new Error('timed out waiting'); await new Promise((r) => setTimeout(r, 10)); } };
// A wait that cannot hang the file: what has not settled in 10 s reads 'still waiting'.
const within = (p, ms = 10_000) => Promise.race([p, new Promise((r) => { setTimeout(() => r('still waiting'), ms).unref(); })]);
const gatedRun = () => {
  const g = { signal: null, calls: 0 };
  g.gate = new Promise((r) => { g.release = r; });
  g.run = async (o) => {
    if (o.command !== 'node check.js') return shell.runShellStep(o);
    g.calls += 1;
    g.signal = o.signal;
    await g.gate;
    return o.signal && o.signal.aborted ? { ok: false, exitCode: null, timedOut: false, ms: 1, tail: '' } : shell.runShellStep(o);
  };
  return g;
};

test('shared: the first of three callers stops; the others still get the real result, and each sees the phases (a late one from where it joined)', async () => {
  const g = gatedRun();
  const ph = [[], [], []];
  const ac1 = new AbortController();
  const p1 = mod.beforeRun(spec({ timeoutMin: 2 }), { signal: ac1.signal, run: g.run, onPhase: (p) => ph[0].push(p) });
  const p2 = mod.beforeRun(spec({ timeoutMin: 2 }), { signal: new AbortController().signal, onPhase: (p) => ph[1].push(p) });
  await until(() => g.signal);
  const p3 = mod.beforeRun(spec({ timeoutMin: 2 }), { onPhase: (p) => ph[2].push(p) });
  ac1.abort();
  try {
    assert.deepEqual(await within(p1), { ran: false, reason: 'stopped' }, 'the caller that stopped is told so at once');
    assert.equal(g.signal.aborted, false, 'the shared run goes on for the others');
  } finally { g.release(); }
  const [r2, r3] = await Promise.all([p2, p3]);
  assert.deepEqual([r2.ran, r2.ok, r2.cached, r3.ran, r3.ok, r3.cached], [true, true, false, true, true, false]);
  assert.equal(g.calls, 1, 'one run for all three');
  assert.deepEqual(ph, [['copy', 'command'], ['copy', 'command'], ['command']]);
  await until(() => runFolders().length === 0);
});

test('shared: when every caller stops, the run stops; a caller that comes after starts a new one', async () => {
  const g = gatedRun();
  const acA = new AbortController();
  const acB = new AbortController();
  const s = spec({ timeoutMin: 3 });
  const pA = mod.beforeRun(s, { signal: acA.signal, run: g.run });
  const pB = mod.beforeRun(s, { signal: acB.signal });
  await until(() => g.signal);
  acA.abort();
  assert.equal(g.signal.aborted, false);
  acB.abort();
  try { assert.equal(g.signal.aborted, true, 'nobody waits for it any more'); } finally { g.release(); }
  assert.deepEqual([await within(pA), await within(pB)], [{ ran: false, reason: 'stopped' }, { ran: false, reason: 'stopped' }]);
  await until(() => runFolders().length === 0);
  assert.equal(await mod.readBefore(s), null, 'a stopped run is not kept');
  const again = await mod.beforeRun(s);
  assert.deepEqual([again.ran, again.ok, again.cached], [true, true, false]);
});

test('never rejects: a before folder that cannot be made is an error result', async () => {
  const root = pc.beforeRoot();
  const aside = `${root}.aside`;
  renameSync(root, aside);
  writeFileSync(root, 'not a folder');
  try {
    const r = await mod.beforeRun(spec({ timeoutMin: 4 })).catch((e) => ({ rejected: e.message }));
    assert.deepEqual([r.ran, r.reason, typeof r.text], [false, 'error', 'string']);
    assert.ok(r.text.length > 0);
  } finally {
    rmSync(root, { force: true });
    renameSync(aside, root);
  }
});
