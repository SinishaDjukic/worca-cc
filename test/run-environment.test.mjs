// test/run-environment.test.mjs
// The run environment (process audit §8, performance audit §4/§7): the Machine load setting, the run
// queue's slot files, the test-worker cap in every agent's env, the node_modules clone at checkout
// creation, the retention sweep's branch guard, the size-capped mount rescue and the load-scaled budget.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { join } from 'node:path';

import { DEFAULT_RUN_LIMITS, runLimits, setRunLimits, assertRunLimitsInput, testWorkerCap } from '../src/core/settings.mjs';
import { composeSpawnEnv } from '../src/core/engines/spawn.mjs';
import { acquireRunSlot, liveRunSlots } from '../src/core/run-slots.mjs';
import { seedRefusal, seedNodeModules } from '../src/core/dep-seed.mjs';
import { keptBranches, onlyOnThisBranch } from '../src/core/run-retention.mjs';
import { rescueModifiedMounts } from '../src/core/run-manifest.mjs';
import { loadFactor, loadBudget } from './helpers/load-budget.mjs';
import { templateRepo } from './helpers/git-dir.mjs';
import { worcaHome } from '../src/core/projects.mjs';

const POSIX = { skip: process.platform === 'win32' ? 'POSIX cp/git paths' : false };
const rmOpts = { recursive: true, force: true, maxRetries: 10, retryDelay: 50 };
const tmp = [];
const mk = (p = 'worca-runenv-') => { const d = mkdtempSync(join(tmpdir(), p)); tmp.push(d); return d; };

let home; const prev = {};
before(() => {
  home = mk('worca-runenv-home-');
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_HOME']) { prev[k] = process.env[k]; process.env[k] = home; }
});
after(() => {
  for (const k of Object.keys(prev)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  for (const d of tmp) rmSync(d, rmOpts);
});

test('runLimits: 3 runs at once by default, workers and retention unset; a patch stores its keys, null resets; bad input refused', async () => {
  assert.deepEqual(runLimits(), DEFAULT_RUN_LIMITS);
  assert.deepEqual(DEFAULT_RUN_LIMITS, { maxConcurrentRuns: 3, testWorkers: null, keepRunsDays: null });
  assert.equal(testWorkerCap(), Math.max(1, Math.floor(availableParallelism() / 2)), 'unset = half the cores');
  assert.deepEqual(await setRunLimits({ maxConcurrentRuns: 1, testWorkers: 4 }), { maxConcurrentRuns: 1, testWorkers: 4, keepRunsDays: null });
  assert.equal(testWorkerCap(), 4);
  assert.deepEqual(await setRunLimits({ testWorkers: null, keepRunsDays: 30 }), { maxConcurrentRuns: 1, testWorkers: null, keepRunsDays: 30 });
  assert.deepEqual(await setRunLimits(null), DEFAULT_RUN_LIMITS);
  assert.throws(() => assertRunLimitsInput({ maxConcurrentRuns: 0 }), /runLimits\.maxConcurrentRuns must be a whole number from 1 to 20/);
  assert.throws(() => assertRunLimitsInput({ testWorkers: 2.5 }), /runLimits\.testWorkers/);
  assert.throws(() => assertRunLimitsInput({ keepRunsDays: -1 }), /runLimits\.keepRunsDays/);
  assert.throws(() => assertRunLimitsInput({ other: 1 }), /unknown runLimits setting: other/);
  assert.throws(() => assertRunLimitsInput([]), /runLimits must be an object/);
});

test('every agent env carries WORCA_TEST_CONCURRENCY (the setting, else half the cores); a value already set wins', async () => {
  await setRunLimits({ testWorkers: 3 });
  try {
    assert.equal(composeSpawnEnv({}).env.WORCA_TEST_CONCURRENCY, '3');
    assert.equal(composeSpawnEnv({ overlay: { WORCA_TEST_CONCURRENCY: '7' } }).env.WORCA_TEST_CONCURRENCY, '7');
  } finally { await setRunLimits(null); }
});

test('run slots: at most max runs hold one, the next waits until a release, a dead process frees its slot, a check can end the wait', async () => {
  const a = await acquireRunSlot({ id: 'run-a', max: 2 });
  const b = await acquireRunSlot({ id: 'run-b', max: 2 });
  assert.deepEqual(liveRunSlots().map((s) => s.id), ['run-a', 'run-b']);
  const waits = [];
  const c = acquireRunSlot({ id: 'run-c', max: 2, pollMs: 20, onWait: (n) => waits.push(n) });
  await new Promise((r) => setTimeout(r, 120));
  assert.ok(waits.length && waits.every((n) => n === 2), 'run-c waited with both slots in use');
  a.release();
  const got = await c;
  assert.equal(got.waited, true);
  assert.deepEqual(liveRunSlots().map((s) => s.id).sort(), ['run-b', 'run-c']);
  // A slot whose process is gone (a crash, kill -9) is free.
  const dead = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
  writeFileSync(join(worcaHome(), 'run-slots', 'run-b.json'), JSON.stringify({ id: 'run-b', pid: Number(dead.stdout), at: 0 }));
  const d = await acquireRunSlot({ id: 'run-d', max: 2 });
  assert.equal(d.waited, false);
  assert.equal(existsSync(join(worcaHome(), 'run-slots', 'run-b.json')), false, 'the dead slot file was removed');
  // A stop while waiting ends the wait with the check's error.
  let stop = false;
  const e = acquireRunSlot({ id: 'run-e', max: 2, pollMs: 20, check: () => { if (stop) throw Object.assign(new Error('stopped'), { name: 'AbortError' }); } });
  await new Promise((r) => setTimeout(r, 60));
  stop = true;
  await assert.rejects(e, /stopped/);
  assert.equal(existsSync(join(worcaHome(), 'run-slots', 'run-e.json')), false, 'a run that never got a slot leaves no file');
  got.release(); d.release();
  assert.deepEqual(readdirSync(join(worcaHome(), 'run-slots')), []);
});

test('dep seed: refuses without node_modules, with one already there, without a lockfile or with a different one; clones when they match and the checkout ignores node_modules', POSIX, async () => {
  const project = mk('worca-seed-proj-');
  const files = { 'package.json': '{}', 'package-lock.json': '{"v":1}', '.gitignore': 'node_modules/\n' };
  const wt = templateRepo('seed-wt', { branch: 'main', user: true, files });
  tmp.push(wt);
  for (const [f, c] of Object.entries(files)) writeFileSync(join(project, f), c);
  assert.equal(seedRefusal(project, wt), 'the project has no node_modules');
  mkdirSync(join(project, 'node_modules', 'left-pad'), { recursive: true });
  writeFileSync(join(project, 'node_modules', 'left-pad', 'index.js'), 'module.exports = 1;\n');
  writeFileSync(join(project, 'package-lock.json'), '{"v":2}');
  assert.equal(seedRefusal(project, wt), 'package-lock.json differs from the project\'s');
  writeFileSync(join(project, 'package-lock.json'), '{"v":1}');
  writeFileSync(join(project, 'yarn.lock'), 'x');
  assert.equal(seedRefusal(project, wt), 'yarn.lock differs from the project\'s', 'a lockfile only one side has differs');
  rmSync(join(project, 'yarn.lock'));
  assert.equal(seedRefusal(project, wt), null);
  const r = await seedNodeModules({ projectDir: project, worktreeDir: wt });
  assert.equal(r.seeded, true, JSON.stringify(r));
  assert.equal(readFileSync(join(wt, 'node_modules', 'left-pad', 'index.js'), 'utf8'), 'module.exports = 1;\n');
  assert.equal(spawnSync('git', ['status', '--porcelain'], { cwd: wt, encoding: 'utf8' }).stdout, '', 'the clone never shows in git');
  assert.equal(seedRefusal(project, wt), 'the checkout already has node_modules');
  // A checkout that does not ignore node_modules never gets it: it would reach the commit.
  const open = templateRepo('seed-open', { branch: 'main', user: true, files: { 'package.json': '{}', 'package-lock.json': '{"v":1}' } });
  tmp.push(open);
  const r2 = await seedNodeModules({ projectDir: project, worktreeDir: open });
  assert.deepEqual(r2, { seeded: false, reason: 'the checkout does not ignore node_modules' });
  assert.equal(existsSync(join(open, 'node_modules')), false);
});

test('retention guard: a branch whose tip is on no other ref would lose commits; one contained elsewhere, or gone, would not', POSIX, async () => {
  const repo = templateRepo('ret', { branch: 'main', user: true, files: { 'a.txt': 'a\n' } });
  tmp.push(repo);
  const git = (...a) => { const r = spawnSync('git', a, { cwd: repo, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  git('branch', 'merged');                               // same tip as main
  git('checkout', '-q', '-b', 'lonely');
  writeFileSync(join(repo, 'b.txt'), 'b\n');
  git('add', 'b.txt'); git('commit', '-q', '-m', 'only here');
  git('checkout', '-q', 'main');
  assert.equal(await onlyOnThisBranch(repo, 'merged'), false);
  assert.equal(await onlyOnThisBranch(repo, 'lonely'), true);
  assert.equal(await onlyOnThisBranch(repo, 'no-such-branch'), false);
  git('update-ref', 'refs/remotes/origin/lonely', 'lonely');   // pushed
  assert.equal(await onlyOnThisBranch(repo, 'lonely'), false);
  assert.deepEqual(keptBranches({ projectDir: '/p', branch: { feature: 'f' } }), [['/p', 'f']]);
  assert.deepEqual(keptBranches({ target: 'workspace', projects: [{ projectKey: 'a', projectDir: '/a' }, { projectKey: 'b', projectDir: '/b' }],
    branches: { a: { feature: 'fa' }, b: { source: 'main' } } }), [['/a', 'fa']]);
  assert.deepEqual(keptBranches(null), []);
});

test('mount rescue copies only the changed files: never node_modules or .git, never a file over 5 MB (named instead)', async () => {
  const base = mk('worca-rescue-base-');
  const source = mk('worca-rescue-src-');
  const pipelineDir = mk('worca-rescue-pipe-');
  const skill = join(base, '.claude', 'skills', 'big');
  for (const root of [source, skill]) {
    mkdirSync(join(root, 'node_modules', 'dep'), { recursive: true });
    writeFileSync(join(root, 'SKILL.md'), 'same\n');
    writeFileSync(join(root, 'node_modules', 'dep', 'index.js'), 'dep\n');
    if (process.platform !== 'win32') symlinkSync('node_modules', join(root, 'deps'));   // a link to a dir: same target, no change
  }
  writeFileSync(join(skill, 'node_modules', 'dep', 'index.js'), 'changed dep\n');   // never compared
  writeFileSync(join(skill, 'notes.md'), 'the agent wrote this\n');
  writeFileSync(join(skill, 'blob.bin'), Buffer.alloc(6 * 1024 * 1024));
  const warnings = await rescueModifiedMounts({ baseDir: base, entries: [{ path: '.claude/skills/big', source, kind: 'skill' }], pipelineDir, scope: 'p' });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /rescued the 2 changed file\(s\)/);
  assert.match(warnings[0], /not copied: over 5 MB or unreadable: `blob\.bin`/);
  const dest = join(pipelineDir, 'stray', 'p', '.claude', 'skills', 'big');
  assert.deepEqual(readdirSync(dest), ['notes.md']);
  // An untouched mount (node_modules aside) is no change at all.
  rmSync(join(skill, 'notes.md')); rmSync(join(skill, 'blob.bin'));
  assert.deepEqual(await rescueModifiedMounts({ baseDir: base, entries: [{ path: '.claude/skills/big', source, kind: 'skill' }], pipelineDir, scope: 'q' }), []);
});

test('loadBudget: CI keeps the strict budget; locally it never shrinks below it', () => {
  assert.equal(loadFactor({ CI: 'true' }), 1);
  assert.equal(loadBudget(2000, { CI: 'true' }), 2000);
  assert.ok(loadFactor({}) >= 1);
  assert.ok(loadBudget(2000, {}) >= 2000);
});

test('the harness holds a run slot only while it runs, and never queues a mock run', async () => {
  const { createOrchestrator } = await import('../src/core/orchestrator.mjs');
  const orch = createOrchestrator({ projectDir: mk(), prompt: 'x', claude: { mock: true } });
  orch.pipeline = { id: 'mockrun1', dir: mk() };
  await orch._takeRunSlot();
  assert.equal(orch._runSlot, null, 'mock runs never queue');
  await setRunLimits({ maxConcurrentRuns: 1 });
  try {
    const real = createOrchestrator({ projectDir: mk(), prompt: 'x', claude: { mock: false } });
    real.pipeline = { id: 'realrun1', dir: mk() };
    await real._takeRunSlot();
    assert.deepEqual(liveRunSlots().map((s) => s.id), ['realrun1']);
    const next = createOrchestrator({ projectDir: mk(), prompt: 'x', claude: { mock: false } });
    next.pipeline = { id: 'realrun2', dir: mk() };
    const stages = [];
    next._setupStage = (s) => stages.push(s);
    const waiting = next._takeRunSlot();
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(stages, ['Waiting for a free run slot (1 of 1 in use)']);
    next.abort.abort();
    next.state.status = 'stopped';
    await assert.rejects(waiting, (err) => err.name === 'AbortError');
    real._runSlot.release();
  } finally { await setRunLimits(null); }
});
