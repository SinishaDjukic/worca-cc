// test/run-harness-sync.test.mjs
// #527 Phase C: the run harness's Sync bookend stage. Each world is a bare origin, clone A
// (the run's projectDir, on `dev`) and a teammate clone B that pushes. Sync is OFF unless
// opts.sync.members[projectKey].enabled (D4). The diff base (checkpointRefs) is always the
// worktree's start (a reused branch: its fork point vs `<remote>/<source>`).
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync, mkdirSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { spawnSync } from 'node:child_process';

import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { readPipelineForResume } from '../src/core/artifacts.mjs';
import { projectKey } from '../src/core/store.mjs';
import { _testing as gitSync } from '../src/core/git-sync.mjs';
import { getDb } from '../src/core/db.mjs';
import { writeGraphWorkflow } from '../src/core/workflows.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { checkRows } from './helpers/rows.mjs';
import { templateWorld } from './helpers/git-dir.mjs';

useTempHome(after);

// Sandbox HOME (settings.json lives under it) and git's global config.
const scratch = mkdtempSync(join(tmpdir(), 'worca-cc-rhs-'));
const envKeys = ['HOME', 'USERPROFILE', 'WORCA_RUN_ROOT', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM'];
const prevEnv = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
writeFileSync(join(scratch, 'gitconfig'), '[user]\n\tname = t\n\temail = t@t\n[init]\n\tdefaultBranch = dev\n');
process.env.HOME = scratch;
process.env.USERPROFILE = scratch;
process.env.WORCA_RUN_ROOT = 'legacy';
process.env.GIT_CONFIG_GLOBAL = join(scratch, 'gitconfig');
process.env.GIT_CONFIG_NOSYSTEM = '1';
after(() => {
  for (const k of envKeys) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  rmSync(scratch, { recursive: true, force: true });
});

// Count git-sync's fetches (and optionally delay them) through its runner seam.
let fetches = 0;
let fetchDelayMs = 0;
function installRunner() {
  gitSync.setRunner(async (args, o) => {
    if (args[0] === 'fetch') {
      fetches += 1;
      if (fetchDelayMs) await new Promise((r) => setTimeout(r, fetchDelayMs));
    }
    return gitSync.defaultRun(args, o);
  });
}
installRunner();
afterEach(() => { gitSync.reset(); fetches = 0; fetchDelayMs = 0; installRunner(); });
/** The fetches up to the run's done frame (`.n`): the post-run base check (#620) fetches again after teardown. */
function fetchesUntilDone(orch) {
  const box = { n: null };
  orch.on('done', () => { box.n = fetches; });
  return box;
}
after(() => gitSync.reset());

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} (${cwd}): ${r.stderr}`);
  return r.stdout.trim();
}
const sha = (cwd, ref) => git(cwd, ['rev-parse', ref]);
let n = 0;

/** The template: bare origin + clone A (`proj`, on dev) + teammate clone B. */
function buildWorld(root) {
  const origin = join(root, 'origin.git');
  const a = join(root, 'proj');
  git(root, ['init', '-q', '--bare', '-b', 'dev', origin]);
  mkdirSync(a);
  git(a, ['init', '-q', '-b', 'dev']);
  writeFileSync(join(a, 'seed.txt'), 'seed\n');
  git(a, ['add', '-A']); git(a, ['commit', '-qm', 'seed']);
  git(a, ['remote', 'add', 'origin', origin]);
  git(a, ['push', '-q', '-u', 'origin', 'dev']);
  git(root, ['clone', '-q', origin, join(root, 'teammate')]);
}
const worlds = [];
after(() => { for (const d of worlds) rmSync(d, { recursive: true, force: true, maxRetries: 3 }); });
/** bare origin + clone A (projectDir `proj<n>`, on dev) + teammate clone B, copied from the template. */
function world() {
  const root = templateWorld('run-harness-sync', buildWorld, 'rhs');
  worlds.push(root);
  const a = join(root, `proj${++n}`);
  renameSync(join(root, 'proj'), a); // nothing in git metadata names A's own path
  return { root, origin: join(root, 'origin.git'), a, b: join(root, 'teammate'), key: projectKey(a) };
}
/** Teammate commits `files` on `branch` (created off dev when new) and pushes. */
function teammate(w, files, branch = 'dev') {
  git(w.b, ['fetch', '-q', 'origin']);
  const exists = spawnSync('git', ['rev-parse', '--verify', '-q', `origin/${branch}`], { cwd: w.b }).status === 0;
  git(w.b, ['checkout', '-q', '-B', branch, exists ? `origin/${branch}` : 'origin/dev']);
  for (const f of files) {
    writeFileSync(join(w.b, f), `${f}\n`);
    git(w.b, ['add', '-A']); git(w.b, ['commit', '-qm', `add ${f}`]);
  }
  git(w.b, ['push', '-q', 'origin', `${branch}:${branch}`]);
  return sha(w.b, 'HEAD');
}
function localCommit(dir, file) {
  writeFileSync(join(dir, file), `${file}\n`);
  git(dir, ['add', '-A']); git(dir, ['commit', '-qm', `local ${file}`]);
}
const on = (key, extra = {}) => ({ members: { [key]: { enabled: true, ...extra } } });
/** Task -> implementer -> End. Sync, the checkpoint and the diff base are setup work, the same
 *  under any graph; the mock implementer still writes files, so every run has a real diff. */
const SYNC_WF = {
  id: 'wf_rhs_sync', name: 'Sync demo', domain: 'coding',
  nodes: [
    { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_impl', kind: 'agent', key: 'implementer', x: 200, y: 0, config: {} },
    { id: 'n_end', kind: 'end', x: 400, y: 0, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_impl', port: 'plan' } },
    { id: 'w2', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_end', port: 'result' } },
  ],
};
before(() => writeGraphWorkflow(SYNC_WF));
function orchFor(w, extra = {}) {
  return createOrchestrator({ projectDir: w.a, prompt: 'sync demo', auto: true, claude: { mock: true }, workflowId: SYNC_WF.id, ...extra });
}
/** Everything the run persisted as its diff (results.json + diff-patch.patch), as one string. */
function diffText(pipelineDir) {
  return ['results.json', 'diff-patch.patch'].map((f) => join(pipelineDir, f))
    .filter((p) => existsSync(p)).map((p) => readFileSync(p, 'utf8')).join('\n');
}
const syncRow = (orch) => orch.getState().steps.find((s) => s.key === 'x:sync:1');
/** Block createWorktree: under legacy the worktree path is <projectDir>/.worca-cc/worktrees/<id>. */
function blockWorktree(orch, w) {
  const p = join(w.a, '.worca-cc', 'worktrees', orch.pipeline.id);
  mkdirSync(p, { recursive: true });
  writeFileSync(join(p, 'block'), 'x');
  return p;
}
/** Prepare a harness the way run() does up to the worktree step (for direct _setupRunRoot calls),
 *  as test/graph-build.test.mjs does: a hand-set pipeline, then the real checkpoint. */
async function upToSetup(orch) {
  const dir = mkdtempSync(join(scratch, 'pipe-'));
  orch.pipeline = { id: `p${++n}${Date.now().toString(16).slice(-6)}`, dir, promptText: 'x' };
  orch.state.id = orch.pipeline.id;
  orch.state.pipelineDir = dir;
  if (orch.isWorkspace) await orch._ensureGitCheckpointAll(); else await orch._ensureGitCheckpoint();
}
const auditText = (id) => getDb().prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ?').all(id).map((r) => r.text).join('\n');

// ── single project ──────────────────────────────────────────────────────────
test('behind + sync on: fast-forwards dev, moves the diff base, records the sync (fetch time charged to x:sync:1), keeps preflight ticking', { timeout: 60000 }, async () => {
  const w = world();
  const pre = sha(w.a, 'HEAD');
  const tip = teammate(w, ['mate1.txt', 'mate2.txt']);
  fetchDelayMs = 300;
  const orch = orchFor(w, { sync: on(w.key) });
  let seen = null;
  const real = orch._setupRunRoot.bind(orch);
  orch._setupRunRoot = async (...a) => {
    const out = await real(...a);
    const row = orch.state.steps.find((s) => s.key === 'x:preflight:1');
    seen = { status: row?.status, ticking: row?.runningSince != null, stage: orch.state.setupStage };
    return out;
  };
  let preflightAfterSync = null;
  let syncDone = false;
  orch.on('state', (s) => {
    const row = s.steps?.find((x) => x.key === 'x:sync:1');
    if (!syncDone && row?.status === 'done') {
      syncDone = true;
      const p = s.steps.find((x) => x.key === 'x:preflight:1');
      preflightAfterSync = p ? p.runningSince != null : null;
    }
  });
  const res = await orch.run();
  await checkRows([
    { name: 'behind + sync on: fast-forwards dev, moves the diff base, records the sync, keeps preflight ticking', run: () => {
      assert.equal(res.status, 'done', JSON.stringify(res));
      const st = orch.getState();
      assert.equal(st.branch.sync.result, 'fast-forwarded');
      assert.equal(st.branch.sync.commits, 2);
      assert.equal(st.branch.baseSha, tip);
      assert.equal(sha(w.a, 'dev'), tip, 'local dev fast-forwarded to origin/dev');
      assert.notEqual(pre, tip);
      assert.equal(st.checkpointRef, st.branch.baseSha, 'C3: the diff base is the start');
      const diff = diffText(res.pipelineDir);
      assert.doesNotMatch(diff, /mate1\.txt|mate2\.txt/, 'no teammate file in the run\'s diff');
      assert.equal(syncRow(orch)?.status, 'done');
      assert.deepEqual(seen, { status: 'start', ticking: true, stage: 'Creating the worktree' });
      assert.equal(preflightAfterSync, true, 'the first state after Sync turns done shows preflight running');
      assert.ok(fetches >= 1);
    } },
    { name: 'sync row time: the fetch is charged to x:sync:1', run: () => {
      assert.equal(res.status, 'done', JSON.stringify(res));
      assert.ok(syncRow(orch).activeMs >= 250, `activeMs ${syncRow(orch).activeMs}`);
    } },
  ]);
});

test('up to date + sync on: no Sync row, result up-to-date, baseSha set', { timeout: 60000 }, async () => {
  const w = world();
  const orch = orchFor(w, { sync: on(w.key) });
  const res = await orch.run();
  assert.equal(res.status, 'done', JSON.stringify(res));
  const st = orch.getState();
  assert.equal(syncRow(orch), undefined);
  assert.equal(st.branch.sync.result, 'up-to-date');
  assert.equal(st.branch.baseSha, sha(w.a, 'dev'));
});

test('sync off (no opts.sync): nothing is fetched or moved; baseSha still recorded', { timeout: 60000 }, async () => {
  const w = world();
  const before = sha(w.a, 'dev');
  teammate(w, ['m.txt']);
  const orch = orchFor(w);
  const seen = fetchesUntilDone(orch);
  const res = await orch.run();
  assert.equal(res.status, 'done', JSON.stringify(res));
  const st = orch.getState();
  assert.equal(sha(w.a, 'dev'), before);
  assert.equal('sync' in st.branch, false);
  assert.equal(st.branch.baseSha, before);
  assert.equal(st.checkpointRef, before);
  assert.equal(seen.n, 0);
  assert.equal(syncRow(orch), undefined);
});

// RC1: the diff base used to be the PROJECT CHECKOUT's HEAD. With the checkout on another branch than
// sourceBranch, every commit between the two showed up as the run's own change.
test('checkout on another branch than the source: the diff base is the worktree start, not the checkout HEAD', { timeout: 90000 }, async () => {
  const onOther = () => {
    const w = world();
    git(w.a, ['checkout', '-q', '-b', 'other']);
    localCommit(w.a, 'other.txt');                     // the checkout now sits one commit off dev
    return w;
  };
  await checkRows([
    { name: 'sync off: base = dev, other.txt never appears', run: async () => {
      const w = onOther();
      const start = sha(w.a, 'dev');
      const orch = orchFor(w, { branch: { source: 'dev' } });
      const res = await orch.run();
      assert.equal(res.status, 'done', JSON.stringify(res));
      const st = orch.getState();
      assert.equal(st.branch.baseSha, start);
      assert.equal(st.checkpointRef, start, 'the diff base is where the worktree started');
      assert.equal(st.checkpointRefs[w.key], start);
      assert.doesNotMatch(diffText(res.pipelineDir), /other\.txt/, 'a commit of the user\'s checkout is not the run\'s change');
    } },
    { name: 'sync on + up to date: base = dev, other.txt never appears', run: async () => {
      gitSync.reset(); fetches = 0; fetchDelayMs = 0; installRunner();
      const w = onOther();
      const start = sha(w.a, 'dev');
      const orch = orchFor(w, { branch: { source: 'dev' }, sync: on(w.key) });
      const res = await orch.run();
      assert.equal(res.status, 'done', JSON.stringify(res));
      const st = orch.getState();
      assert.equal(st.branch.sync.result, 'up-to-date');
      assert.equal(st.checkpointRef, start);
      assert.doesNotMatch(diffText(res.pipelineDir), /other\.txt/);
    } },
  ]);
});

// RC1 / sourceFromPrevious: the source is the previous run's LOCAL feature branch (no origin copy →
// sync `no-upstream`). The previous run's commits are its own diff, never this run's.
test('source = the previous run\'s local feature branch (sync on, no-upstream): its commits are not in this run\'s diff', { timeout: 60000 }, async () => {
  const w = world();
  git(w.a, ['checkout', '-q', '-b', 'worca-cc/prev-run']);
  localCommit(w.a, 'prev.txt');
  const prevTip = sha(w.a, 'HEAD');
  git(w.a, ['checkout', '-q', 'dev']);                 // the user's checkout is back on dev
  const orch = orchFor(w, { branch: { source: 'worca-cc/prev-run' }, sync: on(w.key) });
  const res = await orch.run();
  assert.equal(res.status, 'done', JSON.stringify(res));
  const st = orch.getState();
  assert.equal(st.branch.sync.result, 'no-upstream');
  assert.equal(st.branch.source, 'worca-cc/prev-run');
  assert.equal(st.branch.baseSha, prevTip);
  assert.equal(st.checkpointRef, prevTip);
  assert.doesNotMatch(diffText(res.pipelineDir), /prev\.txt/, 'the previous run\'s commit is not this run\'s change');
});

test('diverged + onDiverged fail: terminal error, dev untouched, the record is kept', { timeout: 60000 }, async () => {
  const w = world();
  teammate(w, ['m.txt']);
  localCommit(w.a, 'local.txt');
  const before = sha(w.a, 'dev');
  const orch = orchFor(w, { sync: on(w.key, { onDiverged: 'fail' }) });
  const res = await orch.run();
  assert.equal(res.status, 'error', JSON.stringify(res));
  assert.match(res.error, /diverged/);
  assert.equal(sha(w.a, 'dev'), before);
  const st = orch.getState();
  assert.equal(st.branch.sync.result, 'diverged');
  assert.equal(st.branch.worktreeDir, undefined);
  assert.equal(syncRow(orch)?.status, 'error');
});

test('diverged + onDiverged origin: remote start from origin/dev, dev untouched, source stays dev', { timeout: 60000 }, async () => {
  const w = world();
  const tip = teammate(w, ['mate.txt']);
  localCommit(w.a, 'local.txt');
  const before = sha(w.a, 'dev');
  const orch = orchFor(w, { sync: on(w.key, { onDiverged: 'origin' }) });
  let wtHead = null;
  orch.on('state', (s) => { if (!wtHead && s.branch?.worktreeDir && existsSync(s.branch.worktreeDir)) wtHead = sha(s.branch.worktreeDir, 'HEAD'); });
  const res = await orch.run();
  assert.equal(res.status, 'done', JSON.stringify(res));
  const st = orch.getState();
  assert.equal(wtHead, tip, 'the worktree starts at origin/dev');
  assert.equal(sha(w.a, 'dev'), before);
  assert.equal(st.branch.source, 'dev');
  assert.equal(st.branch.startRef, tip);
  assert.equal(st.branch.sync.policy, 'origin');
  assert.equal(st.branch.sync.result, 'remote-start');
  assert.equal(st.checkpointRef, tip);
  assert.doesNotMatch(diffText(res.pipelineDir), /mate\.txt|local\.txt/);
});

test('dirty checked-out dev: remote start (dirty), the dirty file stays in the project dir only', { timeout: 60000 }, async () => {
  const w = world();
  teammate(w, ['mate.txt']);
  writeFileSync(join(w.a, 'seed.txt'), 'seed\nuncommitted\n');
  const orch = orchFor(w, { sync: on(w.key) });
  let wtSeed = null;
  orch.on('state', (s) => {
    if (wtSeed == null && s.branch?.worktreeDir && existsSync(s.branch.worktreeDir)) wtSeed = readFileSync(join(s.branch.worktreeDir, 'seed.txt'), 'utf8');
  });
  const res = await orch.run();
  assert.equal(res.status, 'done', JSON.stringify(res));
  const st = orch.getState();
  assert.equal(st.branch.sync.result, 'remote-start');
  assert.equal(st.branch.sync.reason, 'dirty');
  assert.equal(wtSeed, 'seed\n', 'the uncommitted change did not leak into the worktree');
  assert.equal(readFileSync(join(w.a, 'seed.txt'), 'utf8'), 'seed\nuncommitted\n');
});

test('remote-only source (sync off): a local tracking branch is created and the diff base moves to it', { timeout: 60000 }, async () => {
  const w = world();
  const tip = teammate(w, ['new1.txt', 'new2.txt'], 'feat/new');
  git(w.a, ['fetch', '-q', 'origin']);
  const orch = orchFor(w, { branch: { source: 'feat/new' } });
  const res = await orch.run();
  assert.equal(res.status, 'done', JSON.stringify(res));
  assert.equal(sha(w.a, 'refs/heads/feat/new'), tip);
  assert.equal(git(w.a, ['rev-parse', '--abbrev-ref', 'feat/new@{upstream}']), 'origin/feat/new');
  const st = orch.getState();
  assert.equal(st.branch.source, 'feat/new');
  assert.equal(st.checkpointRef, tip);
  assert.doesNotMatch(diffText(res.pipelineDir), /new1\.txt|new2\.txt/);
});

test('source first seen by the Sync fetch: result created, diff base at origin/feat/late', { timeout: 60000 }, async () => {
  const w = world();
  const tip = teammate(w, ['late.txt'], 'feat/late');   // pushed after A's last fetch
  const orch = orchFor(w, { branch: { source: 'feat/late' }, sync: on(w.key) });
  // _ensureLocalSource's view is stale: its miss fetch answers without fetching.
  const realEnsure = orch._ensureLocalSource.bind(orch);
  orch._ensureLocalSource = async () => {};
  const res = await orch.run();
  orch._ensureLocalSource = realEnsure;
  assert.equal(res.status, 'done', JSON.stringify(res));
  const st = orch.getState();
  assert.equal(st.branch.sync.result, 'created');
  assert.equal(st.checkpointRef, tip);
  assert.doesNotMatch(diffText(res.pipelineDir), /late\.txt/);
});

test('feature == source is refused: before any fetch when behind, and on the remote-start path (terminal, dev untouched)', { timeout: 60000 }, async () => {
  await checkRows([
    { name: 'remote start keeps the feature != source guard (terminal)', run: async () => {
      const w = world();
      teammate(w, ['mate.txt']);
      localCommit(w.a, 'local.txt');
      const before = sha(w.a, 'dev');
      const orch = orchFor(w, { branch: { source: 'dev', feature: 'dev' }, sync: on(w.key, { onDiverged: 'origin' }) });
      const res = await orch.run();
      assert.equal(res.status, 'error', JSON.stringify(res));
      assert.match(res.error, /must differ/);
      assert.equal(sha(w.a, 'dev'), before);
      const list = git(w.a, ['worktree', 'list', '--porcelain']);
      assert.equal((list.match(/branch refs\/heads\/dev$/gm) || []).length, 1, 'dev is checked out only in the project dir');
    } },
    { name: 'feature == source + sync on + behind: refused before the sync (0 fetches, dev not moved)', run: async () => {
      gitSync.reset(); fetches = 0; fetchDelayMs = 0; installRunner();   // the file's afterEach, once per former test
      const w = world();
      teammate(w, ['mate.txt']);
      const before = sha(w.a, 'dev');
      const orch = orchFor(w, { branch: { source: 'dev', feature: 'dev' }, sync: on(w.key) });
      const res = await orch.run();
      assert.equal(res.status, 'error', JSON.stringify(res));
      assert.match(res.error, /must differ/);
      assert.equal(sha(w.a, 'dev'), before);
      assert.equal(fetches, 0);
    } },
  ]);
});

test('reused feature branch + behind + sync on: base moves, diff base = the fork point', { timeout: 60000 }, async () => {
  const w = world();
  git(w.a, ['branch', 'feat/x']);                       // off the old dev
  teammate(w, ['mate1.txt', 'mate2.txt']);
  const orch = orchFor(w, { branch: { source: 'dev', feature: 'feat/x' }, sync: on(w.key) });
  let preSync = null;
  const realCp = orch._ensureGitCheckpoint.bind(orch);
  orch._ensureGitCheckpoint = async () => { await realCp(); preSync = orch.checkpointRef; };
  const res = await orch.run();
  assert.equal(res.status, 'done', JSON.stringify(res));
  const st = orch.getState();
  assert.equal(st.branch.sync.result, 'fast-forwarded');
  assert.equal(st.branch.reusedExisting, true);
  assert.equal(st.branch.baseSha, undefined);
  assert.equal(st.branch.startRef, undefined);
  assert.equal(st.checkpointRef, preSync);
  assert.equal(st.branch.diffBase, preSync, 'fork point of feat/x vs origin/dev');
  assert.doesNotMatch(diffText(res.pipelineDir), /mate1\.txt|mate2\.txt/);
});

// RC2: a reused branch's diff = every unmerged change on it vs <remote>/<source> (+ uncommitted work).
// dev moving on after the fork must never read as deletions by this run.
test('reused feature branch: base = merge-base(feature, origin/dev); earlier unmerged work shows, newer dev commits do not', { timeout: 90000 }, async () => {
  await checkRows([
    { name: 'reused branch, dev moved on (pushed), sync off: diffBase = fork point vs origin/dev', run: async () => {
      const w = world();
      git(w.a, ['checkout', '-q', '-b', 'feat/x']); localCommit(w.a, 'x1.txt'); git(w.a, ['checkout', '-q', 'dev']);
      const fork = sha(w.a, 'dev');
      localCommit(w.a, 'later.txt'); git(w.a, ['push', '-q', 'origin', 'dev']);
      const orch = orchFor(w, { branch: { source: 'dev', feature: 'feat/x' } });
      const res = await orch.run();
      assert.equal(res.status, 'done', JSON.stringify(res));
      const st = orch.getState();
      assert.equal(st.branch.reusedExisting, true);
      assert.equal(st.branch.baseSha, undefined, 'baseSha stays the fresh-start proof only');
      assert.equal(st.branch.diffBase, fork);
      assert.equal(st.branch.diffBaseFrom, 'origin/dev');
      assert.equal(st.checkpointRef, fork);
      const diff = diffText(res.pipelineDir);
      assert.match(diff, /x1\.txt/, 'the branch\'s unmerged earlier work is part of its diff');
      assert.doesNotMatch(diff, /later\.txt/, 'a newer dev commit is not a deletion by this run');
    } },
    { name: 'reused branch, no remote: falls back to the local source', run: async () => {
      const w = world();
      git(w.a, ['remote', 'remove', 'origin']);
      git(w.a, ['checkout', '-q', '-b', 'feat/x']); localCommit(w.a, 'x1.txt'); git(w.a, ['checkout', '-q', 'dev']);
      const fork = sha(w.a, 'dev');
      localCommit(w.a, 'later.txt');
      const orch = orchFor(w, { branch: { source: 'dev', feature: 'feat/x' } });
      const res = await orch.run();
      assert.equal(res.status, 'done', JSON.stringify(res));
      const st = orch.getState();
      assert.equal(st.branch.diffBase, fork);
      assert.equal(st.branch.diffBaseFrom, 'dev');
      assert.doesNotMatch(diffText(res.pipelineDir), /later\.txt/);
    } },
  ]);
});

test('tag source + sync on: never synced, no branch named after the tag', { timeout: 60000 }, async () => {
  const w = world();
  git(w.a, ['tag', 'v1']);
  git(w.b, ['checkout', '-q', '-b', 'v1']); git(w.b, ['push', '-q', 'origin', 'v1:refs/heads/v1']);
  git(w.a, ['fetch', '-q', 'origin']);
  const orch = orchFor(w, { branch: { source: 'v1' }, sync: on(w.key) });
  const logs = [];
  orch.on('log', (e) => logs.push(e));
  const seen = fetchesUntilDone(orch);
  const res = await orch.run();
  assert.equal(res.status, 'done', JSON.stringify(res));
  assert.equal(seen.n, 0);
  assert.equal(spawnSync('git', ['rev-parse', '--verify', '-q', 'refs/heads/v1'], { cwd: w.a }).status, 1);
  assert.equal('sync' in orch.getState().branch, false);
  const syncLines = logs.filter((e) => e.source === 'sync');
  assert.equal(syncLines.length, 1);
  assert.match(syncLines[0].text, /a tag or commit, not a branch/);
  assert.doesNotMatch(auditText(orch.getState().id), /Sync `/);
});

test('no remote + sync on: no Sync row, no record, no audit line', { timeout: 60000 }, async () => {
  const w = world();
  git(w.a, ['remote', 'remove', 'origin']);
  const orch = orchFor(w, { sync: on(w.key) });
  const res = await orch.run();
  assert.equal(res.status, 'done', JSON.stringify(res));
  assert.equal(syncRow(orch), undefined);
  assert.equal('sync' in orch.getState().branch, false);
  assert.doesNotMatch(auditText(orch.getState().id), /Sync `/);
});

test('memory-defrag and scan runs never fetch or create branches even with the member enabled', { timeout: 60000 }, async () => {
  await checkRows([
    { name: 'memory-defrag run with sync enabled: no fetch', run: async () => {
      const w = world();
      teammate(w, ['m.txt']);
      const orch = orchFor(w, { sync: on(w.key) });
      orch.memoryScope = 'project';
      await upToSetup(orch);
      const r = await orch._syncMemberBase(orch.members[0], 'dev');
      assert.deepEqual(r, {});
      await orch._ensureLocalSource(orch.members[0], 'feat/none');
      assert.equal(fetches, 0);
    } },
    { name: 'scan run: no fetch and no branch creation even with the member enabled', run: async () => {
      gitSync.reset(); fetches = 0; fetchDelayMs = 0; installRunner();   // the file's afterEach, once per former test
      const w1 = world();
      teammate(w1, ['late.txt'], 'feat/late');
      git(w1.a, ['fetch', '-q', 'origin']);
      const orch = createOrchestrator({ ...wsOpts([w1.a]), prompt: 'x', auto: true, claude: { mock: true }, sync: on(w1.key) });
      orch._isWorkspaceScan = () => true;
      await upToSetup(orch);
      const m = orch.members[0];
      assert.deepEqual(await orch._syncMemberBase(m, 'dev'), {});
      await orch._ensureLocalSource(m, 'feat/late');
      assert.equal(fetches, 0);
      assert.equal(spawnSync('git', ['rev-parse', '--verify', '-q', 'refs/heads/feat/late'], { cwd: w1.a }).status, 1);
    } },
  ]);
});

// ── paused setup and replay ─────────────────────────────────────────────────
test('paused setup keeps the re-pointed diff base; replay never fetches', { timeout: 60000 }, async () => {
  const w = world();
  const tip = teammate(w, ['mate.txt']);
  const orch = orchFor(w, { sync: on(w.key) });
  const realCp = orch._ensureGitCheckpoint.bind(orch);
  let blocker = null;
  orch._ensureGitCheckpoint = async () => { await realCp(); blocker = blockWorktree(orch, w); };
  const res = await orch.run();
  assert.equal(res.status, 'paused', JSON.stringify(res));
  const st = orch.getState();
  assert.equal(st.checkpointRef, tip);
  assert.equal(st.checkpointRefs[w.key], tip);
  assert.equal(st.branch.source, 'dev');
  assert.equal(st.branch.baseMoved, true);
  assert.equal(st.branch.worktreeDir, undefined);
  rmSync(blocker, { recursive: true, force: true });
  fetches = 0;
  await orch._setupRunRoot({ replay: true });
  assert.equal(fetches, 0);
  const after = orch.getState();
  assert.equal(sha(after.branch.worktreeDir, 'HEAD'), tip);
  assert.equal(after.checkpointRefs[w.key], tip);
  await orch._teardownRunRoot?.().catch(() => {});
});

test('replay of a paused remote start: reuses the first attempt\'s branch at startRef, 0 fetches', { timeout: 60000 }, async () => {
  const w = world();
  const tip = teammate(w, ['mate.txt']);
  localCommit(w.a, 'local.txt');
  const before = sha(w.a, 'dev');
  const orch = orchFor(w, { sync: on(w.key, { onDiverged: 'origin' }) });
  const realCp = orch._ensureGitCheckpoint.bind(orch);
  let blocker = null;
  orch._ensureGitCheckpoint = async () => { await realCp(); blocker = blockWorktree(orch, w); };
  const res = await orch.run();
  assert.equal(res.status, 'paused', JSON.stringify(res));
  assert.equal(orch.getState().branch.reuse, false);
  rmSync(blocker, { recursive: true, force: true });
  fetches = 0;
  await orch._setupRunRoot({ replay: true });
  const st = orch.getState();
  assert.equal(sha(st.branch.worktreeDir, 'HEAD'), tip);
  assert.equal(st.checkpointRefs[w.key], tip);
  assert.equal(st.branch.startRef, tip);
  assert.equal(st.branch.baseSha, tip);
  assert.equal(st.branch.source, 'dev');
  assert.equal(sha(w.a, 'dev'), before);
  assert.equal(fetches, 0);
  await orch._teardownRunRoot?.().catch(() => {});
});

test('replay when no feature branch survived: createWorktree gets the pending startRef, source from the record', { timeout: 60000 }, async () => {
  const w = world();
  git(w.a, ['branch', 'release']);
  localCommit(w.a, 'later.txt');
  const start = sha(w.a, 'release');
  const orch = orchFor(w);
  await upToSetup(orch);
  orch.state.branch = { source: 'release', startRef: start, baseMoved: true, runRootMode: 'legacy' };
  orch.state.branches = {};
  orch.branchOpts.source = null;
  await orch._setupRunRoot({ replay: true });
  const st = orch.getState();
  assert.equal(sha(st.branch.worktreeDir, 'HEAD'), start);
  assert.equal(st.checkpointRefs[w.key], st.branches[w.key].baseSha);
  assert.equal(st.branches[w.key].source, 'release');
  await orch._teardownRunRoot?.().catch(() => {});
});

test('paused setup with a pre-existing feature branch: diff base never moves; a real resume stays on it', { timeout: 90000 }, async () => {
  const w = world();
  git(w.a, ['branch', 'feat/x']);
  teammate(w, ['mate1.txt']);
  const orch = orchFor(w, { branch: { source: 'dev', feature: 'feat/x' }, sync: on(w.key) });
  const realCp = orch._ensureGitCheckpoint.bind(orch);
  let blocker = null;
  let preSync = null;
  orch._ensureGitCheckpoint = async () => { await realCp(); preSync = orch.checkpointRef; blocker = blockWorktree(orch, w); };
  const res = await orch.run();
  assert.equal(res.status, 'paused', JSON.stringify(res));
  const st = orch.getState();
  assert.equal(st.checkpointRefs[w.key], preSync);
  assert.equal(st.branch.reuse, true);
  assert.equal(st.branch.plannedFeature, 'feat/x');
  assert.equal(st.branch.diffBase, preSync);
  rmSync(blocker, { recursive: true, force: true });
  const saved = readPipelineForResume(st.id);
  const orch2 = createOrchestrator({ projectDir: w.a, auto: true, claude: { mock: true }, resume: saved });
  let wtBranch = null;
  orch2.on('state', (s) => { if (!wtBranch && s.branch?.worktreeDir && existsSync(s.branch.worktreeDir)) wtBranch = git(s.branch.worktreeDir, ['rev-parse', '--abbrev-ref', 'HEAD']); });
  const res2 = await orch2.resume();
  assert.equal(res2.status, 'done', JSON.stringify(res2));
  assert.equal(wtBranch, 'feat/x');
  assert.equal(orch2.getState().checkpointRef, preSync);
  assert.doesNotMatch(diffText(res2.pipelineDir || res.pipelineDir), /mate1\.txt/);
});

// ── workspace ───────────────────────────────────────────────────────────────
function wsOpts(dirs, { branch = { source: 'dev' } } = {}) {
  const projects = dirs.map((d) => ({ projectDir: d, projectKey: projectKey(d), projectName: basename(d) }))
    .sort((x, y) => (x.projectKey < y.projectKey ? -1 : x.projectKey > y.projectKey ? 1 : 0));
  const id = `wks-sync-${projects.map((p) => p.projectKey).join('').slice(0, 8)}`;
  return { workspace: { id, key: id, name: 'Sync WS', description: '', projects: projects.map((p) => ({ ...p, branch })) }, branch, workflowId: SYNC_WF.id };
}

// RC1 / workspace: every member's base is ITS OWN worktree start — including a member that fell back to
// its default branch because its named source exists nowhere.
test('workspace: each member diffs from its own worktree start (checkout elsewhere; fallback member)', { timeout: 90000 }, async () => {
  const w1 = world(); const w2 = world();
  git(w1.a, ['checkout', '-q', '-b', 'other']); localCommit(w1.a, 'other1.txt');
  git(w2.a, ['checkout', '-q', '-b', 'tmp']); localCommit(w2.a, 'other2.txt'); git(w2.a, ['checkout', '-q', '--detach', 'tmp']);
  const ws = wsOpts([w1.a, w2.a]);
  ws.workspace.projects.find((p) => p.projectDir === w2.a).branch = { source: 'feat/ghost' };   // falls back (sync off: no fetch)
  const orch = createOrchestrator({ ...ws, prompt: 'x', auto: true, claude: { mock: true } });
  const res = await orch.run();
  assert.equal(res.status, 'done', JSON.stringify(res));
  const st = orch.getState();
  for (const w of [w1, w2]) {
    assert.equal(st.branches[w.key].source, 'dev');
    assert.equal(st.branches[w.key].baseSha, sha(w.a, 'dev'));
    assert.equal(st.checkpointRefs[w.key], st.branches[w.key].baseSha, `${w.key}: base = its worktree start`);
  }
  assert.doesNotMatch(diffText(res.pipelineDir), /other1\.txt|other2\.txt/);
});

test('workspace: per-member Sync — enabled members behind are fast-forwarded under ONE Sync row; a disabled member is untouched', { timeout: 90000 }, async () => {
  const w1 = world(); const w2 = world(); const w3 = world();
  teammate(w1, ['a1.txt']); teammate(w2, ['b1.txt']); teammate(w3, ['c1.txt']);
  const before3 = sha(w3.a, 'dev');
  const orch = createOrchestrator({ ...wsOpts([w1.a, w2.a, w3.a]), prompt: 'x', auto: true, claude: { mock: true },
    sync: { members: { [w1.key]: { enabled: true }, [w2.key]: { enabled: true } } } });
  const res = await orch.run();
  const st = orch.getState();
  await checkRows([
    { name: 'workspace: two members behind, both enabled → both fast-forwarded, one Sync row', run: () => {
      assert.equal(res.status, 'done', JSON.stringify(res));
      assert.equal(st.branches[w1.key].sync.result, 'fast-forwarded');
      assert.equal(st.branches[w2.key].sync.result, 'fast-forwarded');
      assert.equal(st.steps.filter((s) => s.key === 'x:sync:1').length, 1);
      assert.equal(syncRow(orch).status, 'done');
    } },
    { name: 'workspace: one member enabled, one not → only the enabled one syncs', run: () => {
      assert.equal(res.status, 'done', JSON.stringify(res));
      assert.equal(st.branches[w1.key].sync.result, 'fast-forwarded');
      assert.equal('sync' in st.branches[w3.key], false);
      assert.equal(sha(w3.a, 'dev'), before3);
    } },
  ]);
});

test('workspace: a terminal member failure wins over a pausable one', { timeout: 90000 }, async () => {
  const w1 = world(); const w2 = world();
  const ws = wsOpts([w1.a, w2.a]);
  const [A, B] = ws.workspace.projects[0].projectDir === w1.a ? [w1, w2] : [w2, w1];
  teammate(B, ['m.txt']); localCommit(B.a, 'l.txt');
  const orch = createOrchestrator({ ...ws, prompt: 'x', auto: true, claude: { mock: true }, sync: on(B.key, { onDiverged: 'fail' }) });
  const realCp = orch._ensureGitCheckpointAll.bind(orch);
  orch._ensureGitCheckpointAll = async () => { await realCp(); blockWorktree(orch, A); };
  const res = await orch.run();
  assert.equal(res.status, 'error', JSON.stringify(res));
  const saved = readPipelineForResume(orch.getState().id);
  const meta = typeof saved.workspace_meta === 'string' ? JSON.parse(saved.workspace_meta) : saved.workspace_meta;
  const branches = meta?.branches || orch.getState().branches;
  assert.equal(branches[B.key].sync.result, 'diverged');
});

test('workspace member whose named source exists nowhere: one miss fetch, no Sync fetch, a fallback log line', { timeout: 90000 }, async () => {
  const w1 = world();
  const orch = createOrchestrator({ ...wsOpts([w1.a], { branch: { source: 'feat/ghost' } }), prompt: 'x', auto: true, claude: { mock: true }, sync: on(w1.key) });
  const logs = [];
  orch.on('log', (e) => logs.push(e));
  const seen = fetchesUntilDone(orch);
  const res = await orch.run();
  assert.equal(res.status, 'done', JSON.stringify(res));
  assert.equal(seen.n, 1);
  const lines = logs.filter((e) => e.source === 'sync');
  assert.equal(lines.length, 1);
  assert.match(lines[0].text, /fallback/);
});

test('scheduled workspace member source pushed after a fresh fetch: fetched once, member runs on it; replay never fetches', { timeout: 90000 }, async () => {
  const w1 = world();
  git(w1.a, ['fetch', '-q', 'origin']);
  const tip = teammate(w1, ['late.txt'], 'feat/late');
  const orch = createOrchestrator({ ...wsOpts([w1.a], { branch: { source: 'feat/late' } }), prompt: 'x', auto: true, claude: { mock: true }, sync: on(w1.key) });
  await upToSetup(orch);
  await orch._setupRunRoot();
  const st = orch.getState();
  assert.equal(st.branches[w1.key].source, 'feat/late');
  assert.equal(sha(w1.a, 'refs/heads/feat/late'), tip);
  assert.ok(fetches >= 1);
  await orch._teardownRunRoot?.().catch(() => {});
  fetches = 0;
  const m = orch.members[0];
  await orch._ensureLocalSource(m, 'feat/other', { replay: true });
  assert.equal(fetches, 0);
});
