// test/runs-share-publish.test.mjs — the run-sharing publisher (run sharing s1): the switch, the 30 s coalescer, the
// keep-alive, the PR hook, failures that never touch the run, and the push status. Local bare origins only.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, unlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { git, makeOrigin, cloneAs, rejectAllPushes, useGitSandbox } from './helpers/metrics-git.mjs';
import { shareHarness, gitCounter } from './helpers/runs-share.mjs';
import { withNoGit } from './helpers/git-off.mjs';
import { addProject, listProjects } from '../src/core/projects.mjs';
import { projectKey } from '../src/core/store.mjs';
import { writeProjectSettings } from '../src/core/settings-cascade.mjs';
import { writeTeamMetricsPrefs, readRunsSharePrefs } from '../src/core/config.mjs';
import { persistPrState } from '../src/core/artifacts.mjs';
import { getDb } from '../src/core/db.mjs';
import { readServerSource } from '../src/core/read-server-source.mjs';
import { personKey } from '../src/core/metrics/record.mjs';
import { RECORD_KEYS } from '../src/core/runs-share/record.mjs';
import { runGit } from '../src/core/metrics/sync.mjs';
import {
  attachRunShare, flushProject, drainRunShare, shareErrorText, assertRunsShareCanStart, runsShareStatus, runsShareOn,
  SHARE_WINDOW_MS, KEEPALIVE_MS, _testing,
} from '../src/core/runs-share/publish.mjs';

useGitSandbox(before, after);
useTempHome(after);
const skip = process.platform === 'win32' ? 'sh hooks not portable to win32' : false;
const prevEnv = {};
let root;
before(() => {
  for (const k of ['WORCA_MOCK', 'ORCH_MOCK', 'WORCA_FLAGS']) { prevEnv[k] = process.env[k]; delete process.env[k]; }
  process.env.WORCA_FLAGS = 'runSharing';
  root = mkdtempSync(join(tmpdir(), 'worca-runs-publish-'));
});
after(() => {
  for (const [k, v] of Object.entries(prevEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  rmSync(root, { recursive: true, force: true });
});
afterEach(() => _testing.reset());

let n = 0;
let runSeq = 0xa0000000;
const nextRun = () => (runSeq++).toString(16);

function fakeClock(start = 1_000_000) {
  let t = start;
  const timers = new Set();
  return {
    now: () => t,
    setTimer: (fn, ms) => { const x = { at: t + Math.max(0, ms), fn }; timers.add(x); return x; },
    clearTimer: (x) => { timers.delete(x); },
    advance(ms) {
      const end = t + ms;
      for (;;) {
        const due = [...timers].filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        t = due.at; timers.delete(due); due.fn();
      }
      t = end;
    },
  };
}

/** A project with an origin and the switch on (unless `share: false`). */
async function world({ share = true } = {}) {
  n += 1;
  const bare = makeOrigin(root, `shop${n}`);
  const dir = cloneAs(root, `m${n}`, bare, `shop${n}`);
  await addProject({ name: `shop${n}`, path: dir });
  const key = projectKey(dir);
  if (share) writeProjectSettings({ projectDir: dir }, { 'runs.share': true });
  const clock = fakeClock();
  _testing.setClock(clock);
  const counter = gitCounter();
  _testing.setGit(counter);
  const run = (status = 'running') => shareHarness({ projectDir: dir, projectKey: key, runId: nextRun(), status });
  return { bare, dir, key, clock, counter, run };
}
const commits = (bare) => { try { return Number(git(bare, 'rev-list', '--count', 'worca-runs')); } catch { return 0; } };
const tipFiles = (bare) => { try { return git(bare, 'ls-tree', '-r', '--name-only', 'worca-runs').split('\n').filter(Boolean); } catch { return null; } };
const tipRecord = (bare, h, pk) => JSON.parse(git(bare, 'show', `worca-runs:runs/${pk}/${h.pipeline.id}.json`));
const settle = () => _testing.idle();   // waits for timer-started flushes; starts none
const myKey = (dir) => personKey(git(dir, 'config', 'user.email'));
/** After a restart sharePrUpdate finds the project dir through listProjects(): let that lookup settle first. */
const lookedUp = async () => { await listProjects(); await new Promise((r) => setImmediate(r)); };

test('switch off makes no git calls (attach, 10 state events, done)', { skip }, async () => {
  const w = await world({ share: false });
  assert.equal(runsShareOn(w.key), false);
  const h = w.run();
  assert.equal(attachRunShare(h, { git: w.counter }), null);
  for (let i = 0; i < 10; i++) h.emitState({ totalCostUsd: i });
  h.emitDone('done');
  w.clock.advance(SHARE_WINDOW_MS * 2);
  await settle();
  assert.equal(w.counter.calls.length, 0);
  assert.equal(commits(w.bare), 0);
});

test('flag off makes no git calls', { skip }, async () => {
  const w = await world();
  process.env.WORCA_FLAGS = '-runSharing';
  try {
    const h = w.run();
    assert.equal(attachRunShare(h), null);
    h.emitState({ totalCostUsd: 1 }); h.emitDone('done');
    await settle();
    assert.equal(w.counter.calls.length, 0);
  } finally { process.env.WORCA_FLAGS = 'runSharing'; }
});

test('skipped runs: mock, workspace and no project key make no git calls', { skip }, async () => {
  const w = await world();
  const mock = w.run(); mock.claude.mock = true;
  const ws = w.run(); ws.isWorkspace = true;
  const none = w.run(); none.members = [{ projectKey: null, projectDir: w.dir }];
  for (const h of [mock, ws, none]) { assert.equal(attachRunShare(h), null); h.emitDone('done'); }
  process.env.WORCA_MOCK = '1';
  try { assert.equal(attachRunShare(w.run()), null, 'WORCA_MOCK'); } finally { delete process.env.WORCA_MOCK; }
  await settle();
  assert.equal(w.counter.calls.length, 0);
});

test('a finished run writes one allow-listed record', { skip }, async () => {
  const w = await world();
  const h = w.run();
  assert.ok(attachRunShare(h));
  h.emitState({ totalCostUsd: 0.5, phase: 'build' });
  h.emitDone('done');
  await settle();
  const pk = myKey(w.dir);
  assert.deepEqual(tipFiles(w.bare).filter((f) => f.startsWith('runs/')), [`runs/${pk}/${h.pipeline.id}.json`]);
  const rec = tipRecord(w.bare, h, pk);
  assert.deepEqual(Object.keys(rec).sort(), [...RECORD_KEYS]);
  assert.equal(rec.status, 'done');
  assert.equal(rec.costUsd, 0.5);
  assert.equal(rec.startedBy, `m${n} dev`);
  assert.ok(readRunsSharePrefs(w.key).lastPushAt);
});

test('coalesces ten updates into one commit; an unchanged record makes no commit', { skip }, async () => {
  const w = await world();
  const h = w.run();
  attachRunShare(h);
  for (let i = 1; i <= 10; i++) { w.clock.advance(2_000); h.emitState({ totalCostUsd: i }); }
  await settle();
  assert.equal(commits(w.bare), 0, 'nothing before attach + 30 s');
  w.clock.advance(SHARE_WINDOW_MS - 20_000);
  await settle();
  assert.equal(commits(w.bare), 1);
  assert.equal(tipRecord(w.bare, h, myKey(w.dir)).costUsd, 10);
  const pushes = w.counter.calls.filter((a) => a[0] === 'push').length;
  h.emitState({});   // a state event without a change
  w.clock.advance(SHARE_WINDOW_MS);
  await settle();
  assert.equal(commits(w.bare), 1, 'unchanged: no commit');
  assert.equal(w.counter.calls.filter((a) => a[0] === 'push').length, pushes, 'unchanged: no push');
});

test('done pushes before the window ends; two runs of one project share one commit', { skip }, async () => {
  const w = await world();
  const a = w.run(); const b = w.run();
  attachRunShare(a); attachRunShare(b);
  a.emitState({ totalCostUsd: 1 }); b.emitState({ totalCostUsd: 2 });
  w.clock.advance(1_000);
  a.emitDone('done');
  await settle();
  assert.equal(commits(w.bare), 1);
  const pk = myKey(w.dir);
  assert.deepEqual(tipFiles(w.bare).filter((f) => f.startsWith('runs/')).sort(), [`runs/${pk}/${a.pipeline.id}.json`, `runs/${pk}/${b.pipeline.id}.json`].sort());
  assert.equal(git(w.bare, 'log', '-1', '--format=%s', 'worca-runs'), 'worca-runs: 2 run(s)');
});

test('switch off mid-run: no push after it', { skip }, async () => {
  const w = await world();
  const h = w.run();
  attachRunShare(h);
  w.clock.advance(SHARE_WINDOW_MS);
  await settle();
  assert.equal(commits(w.bare), 1);
  writeProjectSettings({ projectDir: w.dir }, { 'runs.share': false });
  const calls = w.counter.calls.length;
  h.emitState({ totalCostUsd: 5 });
  w.clock.advance(SHARE_WINDOW_MS);
  h.emitDone('done');
  w.clock.advance(KEEPALIVE_MS);
  await settle();
  assert.equal(commits(w.bare), 1);
  assert.equal(w.counter.calls.length, calls);
});

test('a silent running run gets one keep-alive commit after 10 minutes, with a newer updatedAt', { skip }, async () => {
  const w = await world();
  const h = w.run();
  attachRunShare(h);
  w.clock.advance(SHARE_WINDOW_MS);
  await settle();
  const first = tipRecord(w.bare, h, myKey(w.dir));
  w.clock.advance(KEEPALIVE_MS - SHARE_WINDOW_MS / 2);   // past 10 min after attach, not after the push
  await settle();
  assert.equal(commits(w.bare), 1, 'the push re-armed the keep-alive: not before 10 min after it');
  w.clock.advance(SHARE_WINDOW_MS);
  await settle();
  assert.equal(commits(w.bare), 2);
  const second = tipRecord(w.bare, h, myKey(w.dir));
  assert.ok(second.updatedAt > first.updatedAt);
});

test('a state change during a push schedules the next flush', { skip }, async () => {
  const w = await world();
  const h = w.run();
  let once = false;
  attachRunShare(h, { hooks: { beforePush: () => { if (!once) { once = true; h.emitState({ totalCostUsd: 7 }); } } } });
  w.clock.advance(SHARE_WINDOW_MS);
  await settle();
  assert.equal(commits(w.bare), 1);
  assert.equal(tipRecord(w.bare, h, myKey(w.dir)).costUsd, 0);
  w.clock.advance(SHARE_WINDOW_MS);
  await settle();
  assert.equal(commits(w.bare), 2);
  assert.equal(tipRecord(w.bare, h, myKey(w.dir)).costUsd, 7);
});

test('attribution none: startedBy null, a machine person key, the commit not by the git user', { skip }, async () => {
  const w = await world();
  writeTeamMetricsPrefs(w.key, { config: { attribution: 'none' } });
  const h = w.run();
  h.state.startedBy = 'Alice';
  getDb().prepare('UPDATE pipelines SET started_by = ? WHERE id = ?').run('Alice', h.pipeline.id);
  attachRunShare(h);
  h.emitDone('done');
  await settle();
  const files = tipFiles(w.bare).filter((f) => f.startsWith('runs/'));
  assert.equal(files.length, 1);
  const pk = files[0].split('/')[1];
  assert.notEqual(pk, myKey(w.dir));
  assert.equal(pk, readRunsSharePrefs(w.key).machineKey);
  const rec = tipRecord(w.bare, h, pk);
  assert.equal(rec.startedBy, null, 'the run\'s own starter is not published either');
  assert.equal(git(w.bare, 'log', '-1', '--format=%an', 'worca-runs'), 'Worca');
  persistPrState(h.pipeline.id, { url: 'https://github.com/o/r/pull/3', number: 3 });   // the row path
  w.clock.advance(SHARE_WINDOW_MS);
  await settle();
  assert.equal(commits(w.bare), 2);
  assert.equal(tipRecord(w.bare, h, pk).startedBy, null, 'row path: started_by is not published');
});

for (const kind of ['PUSH_REJECTED', 'PUSH_RETRIES_EXHAUSTED', 'RECORD_TOO_LARGE']) {
  test(`a failed flush (${kind}) stores its code and never touches the run`, { skip }, async () => {
    const w = await world();
    if (kind === 'PUSH_REJECTED') rejectAllPushes(w.bare);
    if (kind === 'PUSH_RETRIES_EXHAUSTED') {
      _testing.setGit((cwd, args, o) => (args[0] === 'push'
        ? Promise.resolve({ ok: false, code: 1, stdout: '', stderr: ' ! [rejected] x -> worca-runs (fetch first)\n' })
        : runGit(cwd, args, o)));
    }
    if (kind === 'RECORD_TOO_LARGE') _testing.setMaxBytes(64);
    const h = w.run();
    attachRunShare(h);
    let later = 0;
    h.on('done', () => { later += 1; });
    h.emitDone('done');
    await settle();
    const prefs = readRunsSharePrefs(w.key);
    assert.equal(prefs.lastErrorCode, kind);
    assert.ok(prefs.lastError && prefs.lastErrorAt);
    assert.equal(h.state.status, 'done');
    assert.equal(getDb().prepare('SELECT status FROM pipelines WHERE id = ?').get(h.pipeline.id).status, 'done');
    assert.equal(later, 1, 'a later done listener still runs');
    assert.equal(commits(w.bare), 0);
    if (kind === 'PUSH_REJECTED') {
      assert.equal((await runsShareStatus(w.key, w.dir)).hint.includes('worca-runs'), true);
      unlinkSync(join(w.bare, 'hooks', 'pre-receive'));
      w.clock.advance(SHARE_WINDOW_MS);   // the failed batch was put back and retries after the back-off
      await settle();
      assert.equal(commits(w.bare), 1);
      assert.equal(tipRecord(w.bare, h, myKey(w.dir)).status, 'done', 'the first run\'s done record is retried');
      const again = w.run();
      attachRunShare(again);
      again.emitDone('done');
      await settle();
      const ok = readRunsSharePrefs(w.key);
      assert.deepEqual([ok.lastError, ok.lastErrorCode, ok.lastErrorAt], [null, null, null], 'a later success clears the error');
      assert.ok(ok.lastPushAt);
    }
  });
}

test('a failed push stores its git error redacted', { skip }, async () => {
  const w = await world();
  _testing.setGit((cwd, args, o) => (args[0] === 'push'
    ? Promise.resolve({ ok: false, code: 128, stdout: '', stderr: 'fatal: https://u:tok@h/r rejected\n' })
    : runGit(cwd, args, o)));
  const h = w.run();
  attachRunShare(h);
  const logged = [];
  const prevWarn = console.warn;
  console.warn = (...a) => { logged.push(a.join(' ')); };
  try {
    h.emitDone('done');
    await settle();
  } finally { console.warn = prevWarn; }
  const prefs = readRunsSharePrefs(w.key);
  assert.ok(prefs.lastError);
  assert.equal(prefs.lastError.includes('tok'), false);
  assert.ok(logged.some((l) => l.includes('run sharing:')), 'the failure is logged');
  assert.equal(logged.some((l) => l.includes('tok')), false, 'the console line is redacted too');
});

test('back-off: each failed retry doubles the wait, up to the keep-alive', { skip }, async () => {
  const w = await world();
  let pushes = 0;
  _testing.setGit((cwd, args, o) => {
    if (args[0] === 'push') { pushes += 1; return Promise.resolve({ ok: false, code: 1, stdout: '', stderr: 'fatal: offline\n' }); }
    return runGit(cwd, args, o);
  });
  const h = w.run();
  attachRunShare(h);
  h.emitDone('done');
  await settle();
  const first = pushes;
  assert.ok(first >= 1);
  w.clock.advance(SHARE_WINDOW_MS); await settle();
  const second = pushes;
  assert.ok(second > first, 'retried after 30 s');
  w.clock.advance(SHARE_WINDOW_MS); await settle();
  assert.equal(pushes, second, 'not again 30 s later: the wait doubled');
  w.clock.advance(SHARE_WINDOW_MS); await settle();
  assert.ok(pushes > second, 'retried after 60 s');
});

test('shareErrorText masks URL logins and token queries, and withholds a secret-shaped line', () => {
  const a = shareErrorText('fatal: unable to access \'https://u:tok@h/r\': 403\nmore');
  assert.equal(a.includes('tok'), false);
  assert.match(a, /https:\/\/\*\*\*@h\/r/);
  const b = shareErrorText('fatal: https://h/r?access_token=tok2&x=1 denied');
  assert.equal(b.includes('tok2'), false);
  assert.match(b, /access_token=\*\*\*/);
  const c = shareErrorText('remote: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef012345 rejected');
  assert.equal(c, 'Push failed (details withheld: the git error held a secret-shaped value)');
  assert.equal(shareErrorText('x'.repeat(500)).length, 300);
});

test('drainRunShare empties the pending set', { skip }, async () => {
  const w = await world();
  const h = w.run();
  attachRunShare(h);
  h.emitState({ totalCostUsd: 3 });
  assert.deepEqual(_testing.pending(), [w.key]);
  await drainRunShare({ timeoutMs: 20_000 });
  assert.deepEqual(_testing.pending(), []);
  assert.equal(commits(w.bare), 1);
});

test('a PR stored after the run detached adds one commit; the same URL again adds none', { skip }, async () => {
  const w = await world();
  const h = w.run();
  attachRunShare(h);
  h.emitState({ totalCostUsd: 1 });
  h.emitDone('done');
  await settle();
  assert.equal(commits(w.bare), 1);
  assert.equal(h.listenerCount('state'), 0, 'detached at done');
  persistPrState(h.pipeline.id, { url: 'https://github.com/o/r/pull/9', number: 9 });
  w.clock.advance(SHARE_WINDOW_MS);
  await settle();
  assert.equal(commits(w.bare), 2);
  const rec = tipRecord(w.bare, h, myKey(w.dir));
  assert.deepEqual([rec.prUrl, rec.stage, rec.progress, rec.status], ['https://github.com/o/r/pull/9', null, null, 'done']);
  persistPrState(h.pipeline.id, { url: 'https://github.com/o/r/pull/9', number: 9 });
  w.clock.advance(SHARE_WINDOW_MS);
  await settle();
  assert.equal(commits(w.bare), 2);
});

test('a PR stored for a run this machine never shared makes no git calls', { skip }, async () => {
  const w = await world();
  const old = w.run('done');   // a past run: never attached while the switch was on
  persistPrState(old.pipeline.id, { url: 'https://github.com/o/r/pull/4', number: 4 });
  await lookedUp();
  w.clock.advance(SHARE_WINDOW_MS);
  await settle();
  assert.equal(w.counter.calls.length, 0);
  assert.equal(commits(w.bare), 0);
});

test('after a restart, the same PR link again adds no commit', { skip }, async () => {
  const w = await world();
  const h = w.run();
  attachRunShare(h);
  h.emitDone('done');
  await settle();
  persistPrState(h.pipeline.id, { url: 'https://github.com/o/r/pull/5', number: 5 });
  w.clock.advance(SHARE_WINDOW_MS);
  await settle();
  assert.equal(commits(w.bare), 2);
  _testing.reset();   // a new process: nothing in memory
  _testing.setClock(w.clock);
  _testing.setGit(w.counter);
  const calls = w.counter.calls.length;
  persistPrState(h.pipeline.id, { url: 'https://github.com/o/r/pull/5', number: 5 });
  await lookedUp();
  w.clock.advance(SHARE_WINDOW_MS);
  await settle();
  assert.equal(commits(w.bare), 2);
  assert.equal(w.counter.calls.length, calls);
  persistPrState(h.pipeline.id, { url: 'https://github.com/o/r/pull/6', number: 6 });   // a changed link still lands
  await lookedUp();
  w.clock.advance(SHARE_WINDOW_MS);
  await settle();
  assert.equal(commits(w.bare), 3);
});

test('a PR on a workspace run\'s row makes no git calls', { skip }, async () => {
  const w = await world();
  const h = w.run();
  attachRunShare(h);
  h.emitDone('done');
  await settle();
  const calls = w.counter.calls.length;
  getDb().prepare('UPDATE pipelines SET workspace_key = ? WHERE id = ?').run('ws-00000001', h.pipeline.id);
  persistPrState(h.pipeline.id, { url: 'https://github.com/o/r/pull/7', number: 7 });
  w.clock.advance(SHARE_WINDOW_MS);
  await settle();
  assert.equal(w.counter.calls.length, calls);
  assert.equal(commits(w.bare), 1);
});

test('the server shutdown and the CLI exit drain run sharing', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const server = readServerSource();
  assert.match(server, /settleShutdownSteps\(\{[^\n]*runShare: \(\) => drainRunShare\(/);
  const cli = readFileSync(join(here, '..', 'src', 'cli', 'worca-cc.mjs'), 'utf8');
  const body = cli.slice(cli.indexOf('async function drainTeamPushes()'));
  assert.match(body.slice(0, body.indexOf('\n}\n')), /runs-share\/publish\.mjs'\)\.then\(\(m\) => m\.drainRunShare\(/);
});

test('a PR on a project with the switch off makes no git calls', { skip }, async () => {
  const w = await world({ share: false });
  const h = w.run('done');
  persistPrState(h.pipeline.id, { url: 'https://github.com/o/r/pull/1' });
  w.clock.advance(SHARE_WINDOW_MS);
  await settle();
  assert.equal(w.counter.calls.length, 0);
  assert.equal(commits(w.bare), 0);
});

test('assertRunsShareCanStart refuses a Folder project, no origin and no git', async (t) => {
  const plain = mkdtempSync(join(root, 'folder-'));
  await assert.rejects(assertRunsShareCanStart(plain), (e) => e.code === 'FOLDER_PROJECT' && e.status === 400);
  const noOrigin = join(root, 'no-origin');
  mkdirSync(noOrigin);
  git(noOrigin, 'init', '-q');
  await assert.rejects(assertRunsShareCanStart(noOrigin), (e) => e.code === 'NO_ORIGIN' && /origin/.test(e.message));
  const restore = withNoGit(t);
  try {
    await assert.rejects(assertRunsShareCanStart(noOrigin), (e) => e.code === 'NO_GIT');
  } finally { restore(); }
});

test('flushProject on a project nothing marked is a no-op', async () => {
  assert.deepEqual(await flushProject('nothing-00000000'), { ok: true, pushed: false });
});

test('a PR stored while the done push is in flight still lands', { skip }, async () => {
  const w = await world();
  const h = w.run();
  let once = false;
  _testing.setGit((cwd, args, o) => {
    if (args[0] === 'push' && !once) {
      once = true;
      persistPrState(h.pipeline.id, { url: 'https://github.com/o/r/pull/8', number: 8 });   // the PR finisher, mid-push
    }
    return runGit(cwd, args, o);
  });
  attachRunShare(h);
  h.emitDone('done');
  await settle();
  assert.equal(commits(w.bare), 1);
  assert.equal(tipRecord(w.bare, h, myKey(w.dir)).prUrl, null, 'the first push was built before the PR');
  w.clock.advance(SHARE_WINDOW_MS);
  await settle();
  assert.equal(commits(w.bare), 2);
  assert.equal(tipRecord(w.bare, h, myKey(w.dir)).prUrl, 'https://github.com/o/r/pull/8');
});

test('a push that throws puts the batch back: the done record lands after the back-off', { skip }, async () => {
  const w = await world();
  let thrown = false;
  _testing.setGit((cwd, args, o) => {
    if (args[0] === 'push' && !thrown) { thrown = true; return Promise.reject(new Error('spawn failed')); }
    return runGit(cwd, args, o);
  });
  const h = w.run();
  attachRunShare(h);
  const prevWarn = console.warn;
  console.warn = () => {};
  try {
    h.emitDone('done');
    await settle();
  } finally { console.warn = prevWarn; }
  assert.ok(thrown);
  assert.equal(commits(w.bare), 0);
  w.clock.advance(SHARE_WINDOW_MS);
  await settle();
  assert.equal(commits(w.bare), 1);
  assert.equal(tipRecord(w.bare, h, myKey(w.dir)).status, 'done');
});

test('a success resets the back-off: the next change lands after 30 s, not the last wait', { skip }, async () => {
  const w = await world();
  let fails = 2;
  _testing.setGit((cwd, args, o) => {
    if (args[0] === 'push' && fails > 0) { fails -= 1; return Promise.resolve({ ok: false, code: 1, stdout: '', stderr: 'fatal: offline\n' }); }
    return runGit(cwd, args, o);
  });
  const prevWarn = console.warn;
  console.warn = () => {};
  const h = w.run();
  try {
    attachRunShare(h);
    h.emitState({ totalCostUsd: 1 });
    w.clock.advance(SHARE_WINDOW_MS); await settle();       // fails: wait 30 s
    w.clock.advance(SHARE_WINDOW_MS); await settle();       // fails: wait 60 s
    w.clock.advance(SHARE_WINDOW_MS * 2); await settle();   // lands
  } finally { console.warn = prevWarn; }
  assert.equal(fails, 0);
  assert.equal(commits(w.bare), 1);
  h.emitState({ totalCostUsd: 2 });
  w.clock.advance(SHARE_WINDOW_MS);
  await settle();
  assert.equal(commits(w.bare), 2, 'the window is 30 s again');
  assert.equal(tipRecord(w.bare, h, myKey(w.dir)).costUsd, 2);
});

test('the shared-runs list keeps the newest ids; a detached run leaves no in-memory copy', { skip }, async () => {
  const w = await world();
  _testing.setSharedMax(2);
  const ids = [];
  for (let i = 0; i < 3; i++) {
    const h = w.run();
    ids.push(h.pipeline.id);
    attachRunShare(h);
    h.emitDone('done');
    await settle();
    w.clock.advance(SHARE_WINDOW_MS);
  }
  assert.equal(commits(w.bare), 3);
  assert.deepEqual(Object.keys(readRunsSharePrefs(w.key).shared), ids.slice(1), 'the oldest id is evicted');
  assert.equal(_testing.pushedCount(w.key), 0);
});
