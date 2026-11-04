// test/project-sync.test.mjs — the sync service over git-sync.mjs (#527): effective settings,
// the SyncBlock shape, chip words, and the cheap-`due()` background refresh.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { useTempHome } from './helpers/temp-home.mjs';
import { setSyncDefaults, DEFAULT_SYNC_SETTINGS } from '../src/core/settings.mjs';
import { writeSyncPrefs } from '../src/core/config.mjs';
import { projectKey } from '../src/core/store.mjs';
import { fetchRemote, _testing as gitSyncTesting } from '../src/core/git-sync.mjs';
import {
  effectiveSyncSettings, projectSyncBlock, chipState, worstChipState,
  startProjectSyncBackground, projectSyncEvents, noteProjectActive, QUIET_AFTER_MS, _testing,
} from '../src/core/project-sync.mjs';

const home = useTempHome(after, 'worca-cc-project-sync-');
let root; const saved = {};
const stops = [];
before(async () => {
  root = await mkdtemp(join(tmpdir(), 'project-sync-'));
  for (const k of ['HOME', 'USERPROFILE', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM']) saved[k] = process.env[k];
  process.env.HOME = home; process.env.USERPROFILE = home;
  process.env.GIT_CONFIG_GLOBAL = join(root, 'gitconfig'); process.env.GIT_CONFIG_NOSYSTEM = '1';
  await writeFile(process.env.GIT_CONFIG_GLOBAL, '[user]\n\tname = t\n\temail = t@t\n[commit]\n\tgpgsign = false\n[init]\n\tdefaultBranch = dev\n');
});
after(async () => {
  for (const stop of stops) await stop();
  gitSyncTesting.reset();
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await rm(root, { recursive: true, force: true });
});
beforeEach(() => gitSyncTesting.reset());

const g = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
let n = 0;
/** bare origin + clone A (the "project") + clone B (a teammate who pushes). */
async function world() {
  const dir = join(root, `w${++n}`);
  g(root, 'init', '-q', '--bare', `${dir}-origin.git`);
  g(root, 'clone', '-q', `${dir}-origin.git`, `${dir}-a`);
  await writeFile(join(`${dir}-a`, 'f.txt'), 'one\n');
  g(`${dir}-a`, 'add', '-A'); g(`${dir}-a`, 'commit', '-qm', 'init'); g(`${dir}-a`, 'push', '-q', 'origin', 'dev');
  g(root, 'clone', '-q', `${dir}-origin.git`, `${dir}-b`);
  const push = async (file, msg) => {
    const b = `${dir}-b`;
    g(b, 'pull', '-q', 'origin', 'dev');
    await writeFile(join(b, file), `${msg}\n`); g(b, 'add', '-A'); g(b, 'commit', '-qm', msg);
    g(b, 'push', '-q', 'origin', 'dev');
  };
  return { a: `${dir}-a`, b: `${dir}-b`, push };
}
async function waitFor(pred, ms = 3000) {
  const end = Date.now() + ms;
  while (!(await pred())) {
    if (Date.now() > end) throw new Error('waitFor: condition not met');
    await new Promise((r) => setTimeout(r, 10));
  }
}
const ageFetchHead = async (dir, ms) => {
  const t = (Date.now() - ms) / 1000;
  await utimes(join(dir, '.git', 'FETCH_HEAD'), t, t);
};

test('effectiveSyncSettings: project over instance over built-in; unregistered keys never throw', async () => {
  const proj = await mkdtemp(join(root, 'eff-'));
  const key = projectKey(proj);
  await setSyncDefaults({ refreshMinutes: 5, onDiverged: 'origin' });
  try {
    assert.deepEqual(effectiveSyncSettings(key), { ...DEFAULT_SYNC_SETTINGS, refreshMinutes: 5, onDiverged: 'origin' });
    writeSyncPrefs(key, { onDiverged: 'fail', beforeRun: false });
    assert.deepEqual(effectiveSyncSettings(key), { ...DEFAULT_SYNC_SETTINGS, refreshMinutes: 5, onDiverged: 'fail', beforeRun: false });
    assert.deepEqual(effectiveSyncSettings(null), { ...DEFAULT_SYNC_SETTINGS, refreshMinutes: 5, onDiverged: 'origin' });
    assert.deepEqual(effectiveSyncSettings('/not/a/key'), { ...DEFAULT_SYNC_SETTINGS, refreshMinutes: 5, onDiverged: 'origin' });
  } finally {
    await setSyncDefaults(null);
  }
});

test('projectSyncBlock: no remote → remote:null', async () => {
  const dir = join(root, 'lonely');
  g(root, 'init', '-q', dir);
  await writeFile(join(dir, 'f.txt'), 'x\n'); g(dir, 'add', '-A'); g(dir, 'commit', '-qm', 'x');
  const b = await projectSyncBlock({ dir });
  assert.equal(b.remote, null);
  assert.equal(b.base, 'dev');
  assert.equal(b.state, 'unknown');
  assert.deepEqual(b.settings, { beforeRun: true, onDiverged: 'ask' });
});

test('projectSyncBlock: behind → state behind with incoming commits; mode ff → up-to-date', async () => {
  const { a, push } = await world();
  await push('g.txt', 'two'); await push('h.txt', 'three');
  const b = await projectSyncBlock({ dir: a, mode: 'fetch', details: true });
  assert.equal(b.state, 'behind');
  assert.equal(b.behind, 2);
  assert.equal(b.remote, 'origin');
  assert.equal(b.checkedOutHere, true);
  assert.equal(b.incoming.length, 2);
  assert.ok(b.local && b.local.sha === b.headSha);
  assert.ok(b.remoteTip && b.remoteTip.sha === b.remoteSha);
  assert.ok(b.fetchedAt);
  const f = await projectSyncBlock({ dir: a, base: 'dev', mode: 'ff', maxAgeMs: 0 });
  assert.equal(f.ff.ok, true);
  assert.equal(f.state, 'up-to-date');
  assert.equal(f.behind, 0);
});

test('chipState / worstChipState: all six words; local is never "up to date"; remote-only has no chip', () => {
  const base = { remote: 'origin', state: 'up-to-date', dirty: false, checkedOutHere: true, stale: false };
  const rows = [
    [null, null],
    [{ ...base, remote: null }, null],
    [{ ...base, state: 'unknown' }, null],
    [{ ...base, stale: true, state: 'diverged' }, 'offline'],
    [{ ...base, state: 'diverged', dirty: true }, 'diverged'],
    [{ ...base, dirty: true }, 'dirty'],
    [{ ...base, dirty: true, checkedOutHere: false }, 'ok'],
    [{ ...base, state: 'behind' }, 'behind'],
    [{ ...base, state: 'remote-only' }, null],
    [{ ...base, state: 'no-upstream' }, 'local'],
    [{ ...base, state: 'missing' }, 'local'],
    [{ ...base, state: 'ahead' }, 'ok'],
    [base, 'ok'],
  ];
  for (const [block, want] of rows) assert.equal(chipState(block), want, JSON.stringify(block));
  const ok = base, local = { ...base, state: 'no-upstream' };
  assert.equal(worstChipState([ok, local]), 'local');
  assert.equal(worstChipState([local, ok]), 'local');
  assert.equal(worstChipState([ok, { ...base, state: 'behind' }, { ...base, stale: true }]), 'behind');
  assert.equal(worstChipState([{ ...base, dirty: true }, { ...base, state: 'diverged' }]), 'diverged');
  assert.equal(worstChipState([]), null);
  assert.equal(worstChipState(null), null);
  const ranks = Object.values(_testing.RANK);
  assert.equal(new Set(ranks).size, ranks.length, 'no RANK ties');
});

test('startProjectSyncBackground: changed fires once, again after a push once FETCH_HEAD is past refreshMinutes; stop() waits', async () => {
  const { a, push } = await world();
  const key = projectKey(a);
  const events = [];
  const on = (e) => { if (e.projectKey === key) events.push(e); };
  projectSyncEvents.on('changed', on);
  let skew = 0;   // the loop remembers when a project is next due: time has to pass for it too
  try {
    const stop = startProjectSyncBackground({ tickMs: 20, log: () => {}, now: () => Date.now() + skew,
      listProjectsFn: async () => [{ key, path: a, exists: true }] });
    stops.push(stop);
    await waitFor(() => events.length === 1);
    // Fresh FETCH_HEAD: more ticks, no second event.
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(events.length, 1);
    await push('g.txt', 'two');
    await ageFetchHead(a, 11 * 60_000);
    gitSyncTesting.reset();   // this process's own-fetch memory must not count as fresh
    skew = 11 * 60_000;
    await waitFor(() => events.length === 2);
    await stop();
    const after = events.length;
    await ageFetchHead(a, 11 * 60_000);
    gitSyncTesting.reset();
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(events.length, after, 'no changed event after stop()');
  } finally {
    projectSyncEvents.off('changed', on);
  }
});

test('startProjectSyncBackground: a project that is not due runs no status, fetch or rev-list', async () => {
  const { a } = await world();
  assert.equal((await fetchRemote(a)).ok, true);   // FETCH_HEAD is fresh (younger than refreshMinutes)
  const cmds = [];
  gitSyncTesting.setRunner((args, opts) => { cmds.push(args); return gitSyncTesting.defaultRun(args, opts); });
  const events = [];
  const on = (e) => events.push(e);
  projectSyncEvents.on('changed', on);
  try {
    const stop = startProjectSyncBackground({ tickMs: 20, log: () => {},
      listProjectsFn: async () => [{ key: projectKey(a), path: a, exists: true }] });
    stops.push(stop);
    await waitFor(() => cmds.filter((c) => c[0] === 'remote').length >= 1);
    await new Promise((r) => setTimeout(r, 150));   // several more ticks
    await stop();
    assert.equal(events.length, 0);
    // One due check, then nothing until FETCH_HEAD + refreshMinutes: no git at all on the later ticks.
    assert.equal(cmds.filter((c) => c[0] === 'remote').length, 1, 'remote get-url once (none on later ticks)');
    assert.equal(cmds.filter((c) => c[0] === 'rev-parse').length, 1, 'rev-parse --git-path once');
    for (const c of cmds) {
      assert.ok(!['status', 'fetch', 'rev-list', 'log', 'merge', 'update-ref'].includes(c[0]), c.join(' '));
      assert.ok((c[0] === 'remote' && c[1] === 'get-url') || (c[0] === 'rev-parse' && c[1] === '--git-path'), c.join(' '));
    }
  } finally {
    projectSyncEvents.off('changed', on);
  }
});

test('startProjectSyncBackground: a failed fetch backs off until refreshMinutes', async () => {
  const { a } = await world();
  let fetches = 0;
  const later = [];   // commands run after the failed fetch
  gitSyncTesting.setRunner(async (args, opts) => {
    // The first tick's block ends with `git status`; landing it late (as on a busy machine) must not matter.
    if (fetches > 0 && args[0] === 'status') await new Promise((r) => setTimeout(r, 300));
    if (fetches > 0) later.push(args);
    if (args[0] === 'fetch') {
      fetches += 1;
      return Promise.resolve({ ok: false, stdout: '', stderr: 'fatal: Authentication failed for x', code: 128, timedOut: false });
    }
    return gitSyncTesting.defaultRun(args, opts);
  });
  const stop = startProjectSyncBackground({ tickMs: 20, log: () => {},
    listProjectsFn: async () => [{ key: projectKey(a), path: a, exists: true }] });
  stops.push(stop);
  // The first tick's block ends with `git status` (a is checked out on dev); nothing after it runs git.
  await waitFor(() => later.some((c) => c[0] === 'status'));
  later.length = 0;
  // Several more ticks inside refreshMinutes: no second fetch, and no block is built at all.
  await new Promise((r) => setTimeout(r, 200));
  await stop();
  assert.equal(fetches, 1);
  assert.deepEqual(later.map((c) => c.join(' ')), [], 'backed-off project runs no git');
});

test('startProjectSyncBackground: a failed background fetch makes the next status block (the chips\' read) offline', async () => {
  const { a } = await world();
  assert.equal((await fetchRemote(a)).ok, true);
  await ageFetchHead(a, 11 * 60_000);
  gitSyncTesting.forgetProcess();
  gitSyncTesting.setRunner((args, opts) => (args[0] === 'fetch'
    ? Promise.resolve({ ok: false, stdout: '', stderr: 'fatal: Could not resolve host: x', code: 128, timedOut: false })
    : gitSyncTesting.defaultRun(args, opts)));
  const key = projectKey(a);
  const events = [];
  const on = (e) => { if (e.projectKey === key) events.push(e); };
  projectSyncEvents.on('changed', on);
  try {
    const stop = startProjectSyncBackground({ tickMs: 20, log: () => {},
      listProjectsFn: async () => [{ key, path: a, exists: true }] });
    stops.push(stop);
    await waitFor(() => events.length === 1);
    await stop();
    const b = await projectSyncBlock({ dir: a, projectKey: key });   // mode status, as GET /api/sync/projects
    assert.equal(b.stale, true);
    assert.equal(b.fetchError.kind, 'network');
    assert.equal(chipState(b), 'offline');
  } finally {
    projectSyncEvents.off('changed', on);
  }
});

test('startProjectSyncBackground: a local-only project is looked at once per refreshMinutes, not every tick', async () => {
  const dir = await mkdtemp(join(root, 'local-'));
  g(dir, 'init', '-q');
  const cmds = [];
  gitSyncTesting.setRunner((args, opts) => { cmds.push(args); return gitSyncTesting.defaultRun(args, opts); });
  const stop = startProjectSyncBackground({ tickMs: 20, log: () => {},
    listProjectsFn: async () => [{ key: projectKey(dir), path: dir, exists: true }] });
  stops.push(stop);
  await waitFor(() => cmds.length >= 1);
  await new Promise((r) => setTimeout(r, 150));
  await stop();
  assert.deepEqual(cmds.map((c) => c.join(' ')), ['remote get-url origin']);
});

test('startProjectSyncBackground: a project nobody opened for a day is fetched hourly; opening it brings refreshMinutes back', async (t) => {
  const { a } = await world();
  const key = projectKey(a);
  assert.equal((await fetchRemote(a)).ok, true);
  await ageFetchHead(a, 11 * 60_000);   // past refreshMinutes (10), inside QUIET_REFRESH_MINUTES (60)
  gitSyncTesting.forgetProcess();
  _testing.setBootAt(Date.now() - 2 * QUIET_AFTER_MS);
  _testing.openedAt.delete(key);
  t.after(() => _testing.setBootAt(Date.now()));
  let fetches = 0;
  gitSyncTesting.setRunner((args, opts) => { if (args[0] === 'fetch') fetches += 1; return gitSyncTesting.defaultRun(args, opts); });
  const stop = startProjectSyncBackground({ tickMs: 20, log: () => {},
    listProjectsFn: async () => [{ key, path: a, exists: true }] });
  stops.push(stop);
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(fetches, 0, 'quiet: an 11-minute-old fetch is fresh enough');
  noteProjectActive(key);   // a person opened its chip or branches
  await waitFor(() => fetches === 1);
  await stop();
});

test('startProjectSyncBackground: WORCA_SYNC_BACKGROUND=0 disables it', async () => {
  const prev = process.env.WORCA_SYNC_BACKGROUND;
  process.env.WORCA_SYNC_BACKGROUND = '0';
  let listed = 0;
  try {
    const stop = startProjectSyncBackground({ tickMs: 20, listProjectsFn: async () => { listed += 1; return []; } });
    await new Promise((r) => setTimeout(r, 60));
    await stop();
    assert.equal(listed, 0);
  } finally {
    if (prev === undefined) delete process.env.WORCA_SYNC_BACKGROUND; else process.env.WORCA_SYNC_BACKGROUND = prev;
  }
});

test('projectSyncBlock: an unsyncable explicit base reads unknown for THAT name, never HEAD\'s branch', async () => {
  const { a, push } = await world();
  await push('g.txt', 'two'); await fetchRemote(a);
  const b = await projectSyncBlock({ dir: a, base: 'plus+branch' });
  assert.equal(b.base, 'plus+branch'); assert.equal(b.state, 'unknown'); assert.equal(b.remote, 'origin');
  assert.equal(b.behind, undefined, 'dev\'s "1 behind" must not be reported for plus+branch');
  assert.equal((await projectSyncBlock({ dir: a })).state, 'behind', 'no base → HEAD\'s branch, as before');
});

test('an unborn repo (git init, no commit): base is the branch HEAD names, noCommits is set', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'project-sync-unborn-'));
  try {
    spawnSync('git', ['init', '-q', '-b', 'trunk'], { cwd: dir });
    const b = await projectSyncBlock({ dir });
    assert.equal(b.base, 'trunk', 'not init.defaultBranch (dev) and not main');
    assert.equal(b.remote, null);
    assert.equal(b.noCommits, true);
    spawnSync('git', ['remote', 'add', 'origin', 'https://example.invalid/me/x.git'], { cwd: dir });
    const r = await projectSyncBlock({ dir });
    assert.equal(r.remote, 'origin');
    assert.equal(r.noCommits, true);
    spawnSync('git', ['commit', '-q', '--allow-empty', '-m', 'c'], { cwd: dir });
    assert.equal((await projectSyncBlock({ dir })).noCommits, undefined, 'a repo with a commit carries no flag');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
