// test/metrics-read.test.mjs
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { makeOrigin, cloneAs, useGitSandbox } from './helpers/metrics-git.mjs';   // `git` is unused here
import { addProject, listProjects } from '../src/core/projects.mjs';
import { createWorkspace, updateWorkspace } from '../src/core/workspaces.mjs';
import { enableTeamMetrics, writeOutbox, flushSlug, worktreePath, metricsEvents, _testing as syncTesting } from '../src/core/metrics/sync.mjs';
import { readScope, readRecordsFromDir, fetchDecision, noteFetch, parseScopeParam, _testing as readTesting } from '../src/core/metrics/read.mjs';
import { makeRecord } from './fixtures/team-metrics/records.mjs';

const skip = process.platform === 'win32';
const root = mkdtempSync(join(tmpdir(), 'worca-metrics-read-'));
useTempHome(after);

// This suite drives REAL git (clone, commit, push, fetch, reset --hard, worktree add) through
// flushSlug/readScope. Registered FIRST — see useGitSandbox in §5.12.
useGitSandbox(before, after);
after(() => rmSync(root, { recursive: true, force: true }));
afterEach(() => { readTesting.reset(); syncTesting.reset(); });

test('malformed lines and unknown v are counted and skipped', async () => {
  const dir = join(root, 'wt');
  mkdirSync(join(dir, '.worca-metrics/runs/2026/09'), { recursive: true });
  writeFileSync(join(dir, '.worca-metrics/runs/2026/09/a.jsonl'), `${JSON.stringify(makeRecord({ id: 'ok' }))}\n{broken\n`);
  writeFileSync(join(dir, '.worca-metrics/runs/2026/09/b.jsonl'), '{"v":9,"id":"future","startedAt":"2026-09-01T00:00:00Z"}\n');
  const r = await readRecordsFromDir(dir);
  assert.deepEqual([r.records.length, r.malformed, r.unknownV, r.files], [1, 1, 1, 2]);
});

test('fetchDecision: implicit ≤ 1/60 s, refresh forces once per 60 s', () => {
  readTesting.reset();
  assert.equal(parseScopeParam('project:nope'), null);
  assert.deepEqual(parseScopeParam('workspace:wks-iot-sp-0123abcd'), { kind: 'workspace', id: 'wks-iot-sp-0123abcd' });
  assert.equal(fetchDecision('s', { now: 0 }).fetch, true);
  // Offline: a forced fetch at t=0 failed. A second Refresh within 60 s is limited AND fetches nothing
  // (the failed-fetch TTL applies to throttled refreshes too).
  noteFetch('off', { forced: true, ok: false, now: 0 });
  const again = fetchDecision('off', { refresh: true, now: 1_000 });
  assert.deepEqual([again.limited, again.fetch], [true, false]);
  assert.equal(fetchDecision('off', { now: 16_000 }).fetch, true, 'implicit retry after the 15 s failure TTL');
});

test('a symlinked .worca-metrics/runs root is never followed', { skip }, async () => {
  const outside = join(root, 'outside', '2026', '09');
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(outside, 'leak.jsonl'), `${JSON.stringify(makeRecord({ id: 'leak' }))}\n`);
  const wt = join(root, 'wt-link');
  mkdirSync(join(wt, '.worca-metrics'), { recursive: true });
  symlinkSync(join(root, 'outside'), join(wt, '.worca-metrics', 'runs'));
  const r = await readRecordsFromDir(wt);
  assert.deepEqual([r.records.length, r.files], [0, 0]);
});

test('workspace scope groups by name across two homes (split choice tolerated)', { skip }, async () => {
  const gwBare = makeOrigin(root, 'gateway'); const gw = cloneAs(root, 'm', gwBare, 'gateway');
  const drBare = makeOrigin(root, 'device-registry'); const dr = cloneAs(root, 'm', drBare, 'device-registry');
  await addProject({ name: 'gateway', path: gw }); await addProject({ name: 'device-registry', path: dr });
  await enableTeamMetrics(gw, { mode: 'here' }); await enableTeamMetrics(dr, { mode: 'here' });
  const ws = await createWorkspace({ name: 'IoT SP Platform', projectPaths: [gw, dr] });
  await updateWorkspace(ws.id, { metricsProject: gw });
  // Teammate 1 recorded into gateway, teammate 2 chose device-registry as home; one is another workspace's run.
  await writeOutbox('gateway', makeRecord({ id: 'w1', kind: 'workspace', workspace: 'IoT SP Platform', touched: ['gateway'] }));
  await writeOutbox('device-registry', makeRecord({ id: 'w2', kind: 'workspace', workspace: 'iot sp platform', touched: ['device-registry'] }));
  await writeOutbox('device-registry', makeRecord({ id: 'w3', kind: 'workspace', workspace: 'Other WS' }));
  await writeOutbox('gateway', makeRecord({ id: 'p1', kind: 'project', project: 'gateway' }));
  await flushSlug('gateway'); await flushSlug('device-registry');
  const r = await readScope({ kind: 'workspace', id: ws.id });
  assert.deepEqual(r.records.map((x) => x.id).sort(), ['w1', 'w2']);
  assert.deepEqual(r.sinks.sort(), ['device-registry', 'gateway']);

  const p = (await listProjects()).find((x) => x.name === 'gateway');
  const pr = await readScope({ kind: 'project', id: p.key });
  assert.deepEqual(pr.records.map((x) => x.id), ['p1'], 'project scope filters by slug; hosted workspace runs excluded');
});

test('workspace scope matches by workspaceId first: a rename keeps its history, a same-named stranger stays out', { skip }, async () => {
  const gwBare = makeOrigin(root, 'gateway-id'); const gw = cloneAs(root, 'm', gwBare, 'gateway-id');
  const drBare = makeOrigin(root, 'dr-id'); const dr = cloneAs(root, 'm', drBare, 'dr-id');
  await addProject({ name: 'gateway-id', path: gw }); await addProject({ name: 'dr-id', path: dr });
  await enableTeamMetrics(gw, { mode: 'here' });
  const ws = await createWorkspace({ name: 'Platform', projectPaths: [gw, dr] });
  await updateWorkspace(ws.id, { metricsProject: gw });
  await writeOutbox('gateway-id', makeRecord({ id: 'byId', kind: 'workspace', workspaceId: ws.id, workspace: 'Old Name', touched: ['gateway-id'] }));
  await writeOutbox('gateway-id', makeRecord({ id: 'stranger', kind: 'workspace', workspaceId: 'wks-someone-0000ffff', workspace: 'Platform' }));
  await writeOutbox('gateway-id', makeRecord({ id: 'legacy', kind: 'workspace', workspace: 'platform' }));
  await flushSlug('gateway-id');
  const r = await readScope({ kind: 'workspace', id: ws.id });
  assert.deepEqual(r.records.map((x) => x.id).sort(), ['byId', 'legacy'],
    'the renamed record (id match) and the pre-id record (name match) are in; the same-named other workspace is out');
});

test('refresh=1 is rate limited to one forced fetch per 60 s', { skip }, async () => {
  let t = 1_000_000;
  readTesting.setNow(() => t);
  let fetches = 0;
  syncTesting.setGit(async (cwd, args, opts) => {
    if (args[0] === 'fetch') fetches++;
    return syncTesting.defaultGit(cwd, args, opts);
  });
  const p = (await listProjects()).find((x) => x.name === 'gateway');
  await readScope({ kind: 'project', id: p.key });                       // implicit fetch #1
  const before = fetches;
  const a = await readScope({ kind: 'project', id: p.key }, { refresh: true }); // forced fetch
  const b = await readScope({ kind: 'project', id: p.key }, { refresh: true }); // limited
  assert.equal(a.refresh.limited, false); assert.equal(b.refresh.limited, true);
  assert.ok(b.refresh.retryInMs > 0);
  t += 60_001;
  const c = await readScope({ kind: 'project', id: p.key }, { refresh: true });
  assert.equal(c.refresh.limited, false);
  assert.ok(fetches - before >= 2);
});

test('defer: no worktree → "pending" now and the clone afterwards; a due fetch runs after the response; every settle emits one changed event; a failed one is reported by the next deferred read', { skip }, async () => {
  let t = 5_000_000;
  readTesting.setNow(() => t);
  const bare = makeOrigin(root, 'deferred'); const dir = cloneAs(root, 'm', bare, 'deferred');
  await addProject({ name: 'deferred', path: dir });
  await enableTeamMetrics(dir, { mode: 'here' });
  await writeOutbox('deferred', makeRecord({ id: 'd1', kind: 'project', project: 'deferred' }));
  await flushSlug('deferred');
  rmSync(worktreePath('deferred'), { recursive: true, force: true });   // as on a machine that only ever pushed
  const events = [];
  const onChanged = (e) => { if (e.slug === 'deferred') events.push(e); };
  metricsEvents.on('changed', onChanged);
  try {
    const p = (await listProjects()).find((x) => x.name === 'deferred');
    const scope = { kind: 'project', id: p.key };
    const first = await readScope(scope, { defer: true });
    assert.deepEqual([first.records.length, first.refresh.pending, first.fetchError], [0, true, null], 'nothing to serve yet: pending, no records, no error');
    await readTesting.settleDeferred();
    assert.deepEqual(events.map((e) => [e.action, e.updated]), [['fetched', true]], 'the clone settled: one event, updated');
    const second = await readScope(scope, { defer: true });
    assert.deepEqual([second.records.map((r) => r.id), second.refresh.pending], [['d1'], false], 'served from the worktree, no fetch due (< 60 s)');

    t += 60_001;
    const third = await readScope(scope, { defer: true });
    assert.deepEqual([third.records.map((r) => r.id), third.refresh.pending], [['d1'], true], 'a due fetch is deferred: the records come back at once');
    const again = await readScope(scope, { defer: true });
    assert.equal(again.refresh.pending, false, 'a read queued behind the deferred fetch (same slug lock) already sees its result');
    await readTesting.settleDeferred();
    assert.deepEqual(events.slice(1).map((e) => [e.action, e.updated]), [['fetched', false]], 'nothing new on origin: still one event, not updated');

    // Offline: the deferred fetch fails; the event says so and the next deferred read carries the stderr.
    syncTesting.setGit(async (cwd, args, opts) => (args[0] === 'fetch' ? { ok: false, stdout: '', stderr: 'fatal: unable to access origin: offline' } : syncTesting.defaultGit(cwd, args, opts)));
    t += 60_001;
    const fourth = await readScope(scope, { defer: true });
    assert.deepEqual([fourth.records.map((r) => r.id), fourth.refresh.pending], [['d1'], true]);
    await readTesting.settleDeferred();
    assert.deepEqual(events.at(-1).action, 'fetch-failed');
    t += 1_000;
    const fifth = await readScope(scope, { defer: true });
    assert.equal(fifth.refresh.pending, false, 'the failed-fetch TTL skips the retry');
    assert.match(fifth.fetchError, /offline/, 'the last deferred failure is reported, as the inline path reports its own');
    const inline = await readScope(scope);
    assert.equal(inline.fetchError, null, 'an inline read (Ask tools, CLI) only reports its own fetch');
  } finally { metricsEvents.off('changed', onChanged); }
});
