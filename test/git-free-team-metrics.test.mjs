// test/git-free-team-metrics.test.mjs — Team metrics on a GitHub team repository without git (P6 Task 9).
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { addProject } from '../src/core/projects.mjs';
import { projectKey } from '../src/core/store.mjs';
import { writeTeamRepo, readTeamMetricsPrefs } from '../src/core/config.mjs';
import { discoverProject, enableTeamMetrics, writeOutbox, listOutbox, flushSlug, snapshotPath, worktreePath, PROTECTION_HINT, DISCOVERY_RETRY_MS, folderProjectSlug, _testing as syncTesting } from '../src/core/metrics/sync.mjs';
import { readScope, listScopes, FETCH_FAIL_TTL_MS, _testing as readTesting } from '../src/core/metrics/read.mjs';
import { readRunLedger } from '../src/core/metrics/ledger.mjs';
import { snapshotFromHarness, recordRunMetrics, _testing as recordTesting } from '../src/core/metrics/record.mjs';
import { listPrEvents, resolveRunPrs } from '../src/core/metrics/prs.mjs';
import { _testing as ghTesting } from '../src/core/git-free/github.mjs';
import { fakeGithub } from './helpers/fake-github.mjs';
import { withNoGit, gitArrives } from './helpers/git-off.mjs';
import { withEnv } from './helpers/with-env.mjs';
import { createWorkspace } from '../src/core/workspaces.mjs';
import { fakeHarness } from './helpers/metrics-git.mjs';
import { BITBUCKET_NEEDS_GIT } from '../src/core/git-available.mjs';

useTempHome(after);
const gh = await fakeGithub();
ghTesting.setFetch(gh.fetch);
after(() => { ghTesting.reset(); gh.close(); });
afterEach(() => { syncTesting.reset(); readTesting.reset(); });
const root = mkdtempSync(join(tmpdir(), 'worca-gf-tm-'));   // every fixture folder of this file, removed at the end
after(() => rmSync(root, { recursive: true, force: true }));
function folder(files = {}) {
  const d = mkdtempSync(join(root, 'f-'));
  for (const [rel, c] of Object.entries(files)) { mkdirSync(dirname(join(d, rel)), { recursive: true }); writeFileSync(join(d, rel), c); }
  return d;
}
const ORIGIN = (url) => ({ '.git/config': `[remote "origin"]\n\turl = ${url}\n` });
const rec = (id, startedAt = '2026-09-15T14:30:12Z') => ({
  v: 1, id, worca: '1.2.0', recordedAt: startedAt, startedAt, endedAt: startedAt, wallMs: 1, activeMs: 1,
  result: 'done', failure: null, workflow: null, target: { kind: 'project', project: 'acme/billing' }, title: id, source: null,
  cost: { usd: 1, byPhase: {} }, agents: { count: 0, keys: [], models: [] }, steps: 0, cycles: {},
  interventions: { questions: 0, pauses: 0, resumes: 0 }, pr: null,
  git: { branch: null, head: null, base: null, filesChanged: null, insertions: null, deletions: null }, actor: null,
});
const line = (id, at) => `${JSON.stringify(rec(id, at))}\n`;
const RUNS = '.worca-metrics/runs';

gh.repo('acme/billing', { files: { 'README.md': 'b\n' } });
const billing = folder(ORIGIN('https://github.com/acme/billing.git'));
await addProject({ name: 'billing', path: billing });

test('discovery over HTTPS: no branch → off; the branch → on with its config; offline keeps the verdict', async (t) => {
  withNoGit(t);
  let prefs = await discoverProject(billing, { force: true });
  assert.deepEqual([prefs.enabled, prefs.hasOrigin, prefs.slug], [false, true, 'acme/billing']);
  const head = gh.commit('acme/billing', { branch: 'worca-metrics', orphan: true, files: { 'README.md': 'r\n',
    '.worca-metrics/config.json': JSON.stringify({ schema: 1, attribution: 'none' }) } });
  prefs = await discoverProject(billing, { force: true });
  assert.deepEqual([prefs.enabled, prefs.configKnown, prefs.headSha, prefs.config.attribution, prefs.originDisplay], [true, true, head, 'none', 'github.com/acme/billing']);
  gh.offline(true);
  prefs = await discoverProject(billing, { force: true });
  gh.offline(false);
  assert.deepEqual([prefs.enabled, prefs.headSha, prefs.lastDiscoveryError], [true, head, 'GitHub unreachable (ENOTFOUND)']);
});

test('enable here creates the orphan branch with README and config; a second machine joins', async (t) => {
  gh.repo('acme/fresh', { files: { a: '1' } });
  const fresh = folder(ORIGIN('git@github.com:acme/fresh.git'));
  await addProject({ name: 'fresh', path: fresh });
  withNoGit(t);
  const r = await enableTeamMetrics(fresh, { mode: 'here', attribution: 'none', now: new Date('2026-10-17T10:00:00Z') });
  assert.deepEqual([r.action, r.slug], ['created', 'acme/fresh']);
  assert.equal(gh.git('acme/fresh', 'ls-tree', '-r', '--name-only', 'worca-metrics'), '.worca-metrics/config.json\nREADME.md');
  assert.deepEqual(JSON.parse(gh.show('acme/fresh', 'worca-metrics', '.worca-metrics/config.json')),
    { schema: 1, enabledAt: '2026-10-17T10:00:00Z', enabledBy: null, attribution: 'none', notes: '' });
  assert.equal((await enableTeamMetrics(fresh, { mode: 'here' })).action, 'joined');
});

test('enable: another host → GIT_MISSING; nothing known → REPO_REQUIRED; statuses say which', async (t) => {
  const gl = folder(ORIGIN('https://gitlab.com/acme/billing.git'));
  const plain = folder({ 'a.txt': 'a' });
  await addProject({ name: 'gl', path: gl });
  await addProject({ name: 'plain', path: plain });
  withNoGit(t);
  await assert.rejects(enableTeamMetrics(gl, { mode: 'here' }), { code: 'GIT_MISSING', message: 'git is not installed on this machine' });
  await assert.rejects(enableTeamMetrics(plain, { mode: 'here' }), { code: 'REPO_REQUIRED', message: 'type the GitHub repository (owner/name)' });
  const byKey = new Map((await listScopes()).projects.map((s) => [s.key, s]));
  const flags = (s) => [s.hasOrigin, s.needsGit, s.repoInput, s.noGit];
  assert.deepEqual(flags(byKey.get(projectKey(gl))), [true, true, undefined, undefined]);
  assert.deepEqual(flags(byKey.get(projectKey(plain))), [null, undefined, true, undefined]);
});

test('enable: a Bitbucket origin → GIT_MISSING that names Bitbucket', async (t) => {
  const bb = folder(ORIGIN('https://bitbucket.org/acme/api.git'));
  await addProject({ name: 'bb', path: bb });
  withNoGit(t);
  await assert.rejects(enableTeamMetrics(bb, { mode: 'here' }), { code: 'GIT_MISSING', message: BITBUCKET_NEEDS_GIT });
});

test('delegate over HTTPS writes a marker; Change… rewrites it past a teammate\'s commit', async (t) => {
  const mk = async (slug) => { gh.repo(slug, { files: { a: '1' } }); const d = folder(ORIGIN(`https://github.com/${slug}.git`)); await addProject({ name: slug.split('/')[1], path: d }); return d; };
  const sink = await mk('acme/sink');
  const sink2 = await mk('acme/sink2');
  const src = await mk('acme/src2');
  withNoGit(t);
  await enableTeamMetrics(sink, { mode: 'here' });
  await enableTeamMetrics(sink2, { mode: 'here' });
  assert.equal((await enableTeamMetrics(src, { mode: 'delegate', delegateTo: 'acme/sink' })).action, 'created');
  gh.beforeRefUpdate(() => gh.commit('acme/src2', { branch: 'worca-metrics', files: { 'NOTE.md': 'n\n' } }));
  assert.equal((await enableTeamMetrics(src, { mode: 'delegate', delegateTo: 'acme/sink2', change: true })).action, 'changed');
  assert.equal(JSON.parse(gh.show('acme/src2', 'worca-metrics', '.worca-metrics/config.json')).delegateTo, 'acme/sink2');
  assert.equal(gh.show('acme/src2', 'worca-metrics', 'NOTE.md'), 'n\n');
});

test('flush over HTTPS: one commit for the batch; the outbox emptied after the ref moved; the ledger records', async (t) => {
  withNoGit(t);
  await writeOutbox('acme/billing', rec('run-1'));
  await writeOutbox('acme/billing', rec('run-2', '2026-10-01T09:00:00Z'));
  const r = await flushSlug('acme/billing');
  assert.deepEqual([r.ok, r.pushed, r.pending], [true, 2, 0]);
  assert.deepEqual(await listOutbox('acme/billing'), []);
  assert.equal(gh.git('acme/billing', 'ls-tree', '-r', '--name-only', 'worca-metrics', RUNS),
    `${RUNS}/2026/09/20260915T143012Z-run-1.jsonl\n${RUNS}/2026/10/20261001T090000Z-run-2.jsonl`);
  assert.equal(gh.git('acme/billing', 'log', '-1', '--format=%an|%s', 'worca-metrics'), 'Worca|metrics: 2 run(s)');
  assert.equal(readRunLedger('run-1').state, 'recorded');
});

test('a teammate pushes between our read and our ref update: retried with backoff, both land', async (t) => {
  withNoGit(t);
  await writeOutbox('acme/billing', rec('run-3', '2026-10-02T09:00:00Z'));
  gh.beforeRefUpdate(() => gh.commit('acme/billing', { branch: 'worca-metrics', files: { [`${RUNS}/2026/10/20261002T080000Z-mate.jsonl`]: line('mate', '2026-10-02T08:00:00Z') } }));
  const sleeps = [];
  const r = await flushSlug('acme/billing', { sleep: async (ms) => { sleeps.push(ms); }, random: () => 0.5 });
  assert.deepEqual([r.ok, r.pushed, r.attempts, sleeps], [true, 1, 2, [250]]);
  const files = gh.git('acme/billing', 'ls-tree', '-r', '--name-only', 'worca-metrics', `${RUNS}/2026/10`).split('\n');
  assert.deepEqual(files.filter((f) => f.includes('20261002')), [`${RUNS}/2026/10/20261002T080000Z-mate.jsonl`, `${RUNS}/2026/10/20261002T090000Z-run-3.jsonl`]);
});

test('a protected branch: PUSH_REJECTED with the exemption hint; the outbox is kept', async (t) => {
  withNoGit(t);
  gh.protect('acme/billing', 'worca-metrics');
  await writeOutbox('acme/billing', rec('run-4', '2026-10-03T09:00:00Z'));
  const r = await flushSlug('acme/billing');
  gh.unprotect('acme/billing', 'worca-metrics');
  assert.deepEqual([r.ok, r.code, r.pending, r.hint], [false, 'PUSH_REJECTED', 1, PROTECTION_HINT]);
  assert.equal((await listOutbox('acme/billing')).length, 1);
});

test('a teammate pushes before every ref update: PUSH_RETRIES_EXHAUSTED after the fifth attempt, the outbox kept', async (t) => {
  gh.repo('acme/busy', { files: { a: '1' } });
  gh.commit('acme/busy', { branch: 'worca-metrics', orphan: true, files: { '.worca-metrics/config.json': '{"schema":1}' } });
  const dir = folder(ORIGIN('https://github.com/acme/busy.git'));
  await addProject({ name: 'busy', path: dir });
  withNoGit(t);
  await writeOutbox('acme/busy', rec('busy-1', '2026-10-09T09:00:00Z'));
  let updates = 0;
  ghTesting.setFetch((url, init) => {
    if (init?.method === 'PATCH') gh.commit('acme/busy', { branch: 'worca-metrics', files: { [`NOTE-${++updates}.md`]: 'n\n' } });
    return gh.fetch(url, init);
  });
  t.after(() => ghTesting.setFetch(gh.fetch));
  const sleeps = [];
  const r = await flushSlug('acme/busy', { sleep: async (ms) => { sleeps.push(ms); }, random: () => 0.5 });
  assert.deepEqual([r.ok, r.code, r.pending, r.pushed, updates, sleeps.length], [false, 'PUSH_RETRIES_EXHAUSTED', 1, 0, 5, 4]);
  assert.equal((await listOutbox('acme/busy')).length, 1);
});

test('the branch deleted on GitHub after discovery: BRANCH_MISSING, the project turned off with its retention clock started', async (t) => {
  gh.repo('acme/gone', { files: { a: '1' } });
  gh.commit('acme/gone', { branch: 'worca-metrics', orphan: true, files: { '.worca-metrics/config.json': '{"schema":1}' } });
  const dir = folder(ORIGIN('https://github.com/acme/gone.git'));
  await addProject({ name: 'gone', path: dir });
  withNoGit(t);
  assert.equal((await discoverProject(dir, { force: true })).enabled, true);
  await writeOutbox('acme/gone', rec('gone-1', '2026-10-09T09:00:00Z'));
  gh.git('acme/gone', 'update-ref', '-d', 'refs/heads/worca-metrics');
  const r = await flushSlug('acme/gone');
  const prefs = readTeamMetricsPrefs(projectKey(dir));
  assert.deepEqual([r.ok, r.code, r.pending, prefs.enabled, !!prefs.disabledAt], [false, 'BRANCH_MISSING', 1, false, true]);
});

test('readScope over HTTPS: records from the branch snapshot; a refresh pulls only what changed', async (t) => {
  withNoGit(t);
  const id = projectKey(billing);
  let read = await readScope({ kind: 'project', id });
  assert.deepEqual(read.records.map((r) => r.id).sort(), ['mate', 'run-1', 'run-2', 'run-3']);
  assert.equal(existsSync(join(snapshotPath('acme/billing'), '.worca-metrics', 'runs')), true);
  gh.commit('acme/billing', { branch: 'worca-metrics', files: { [`${RUNS}/2026/10/20261004T090000Z-run-5.jsonl`]: line('run-5', '2026-10-04T09:00:00Z') } });
  readTesting.reset();
  read = await readScope({ kind: 'project', id }, { refresh: true });
  assert.deepEqual([read.records.some((r) => r.id === 'run-5'), read.fetchError], [true, null]);
});

test('a host slug cannot flush without git: GIT_MISSING, the outbox kept', async (t) => {
  const gl2 = folder(ORIGIN('https://gitlab.com/acme/legacy.git'));
  await addProject({ name: 'legacy', path: gl2 });
  const { writeTeamMetricsPrefs } = await import('../src/core/config.mjs');
  writeTeamMetricsPrefs(projectKey(gl2), { enabled: true, configKnown: true, hasOrigin: true, slug: 'gitlab.com/acme/legacy', config: { schema: 1 }, checkedAt: new Date().toISOString() });
  withNoGit(t);
  await writeOutbox('gitlab.com/acme/legacy', { ...rec('run-gl'), target: { kind: 'project', project: 'gitlab.com/acme/legacy' } });
  const r = await flushSlug('gitlab.com/acme/legacy');
  assert.deepEqual([r.ok, r.code, r.pending], [false, 'GIT_MISSING', 1]);
});

test('a team branch no git session ever read: without git the read answers GIT_MISSING (409), inline, forced or deferred, and asks GitHub nothing', async (t) => {
  const gl = folder(ORIGIN('https://gitlab.com/acme/unread.git'));
  const stale = folder({ '.git/config': '[core]\n\tbare = false\n' });   // a host slug in its prefs, no origin left
  await addProject({ name: 'unread', path: gl });
  await addProject({ name: 'unread-stale', path: stale });
  const { writeTeamMetricsPrefs } = await import('../src/core/config.mjs');
  for (const [d, slug] of [[gl, 'gitlab.com/acme/unread'], [stale, 'gitlab.com/acme/unread-stale']]) {
    writeTeamMetricsPrefs(projectKey(d), { enabled: true, configKnown: true, hasOrigin: true, slug, config: { schema: 1 }, checkedAt: new Date().toISOString() });
  }
  withNoGit(t);
  readTesting.reset();
  const n = gh.calls.length;
  for (const d of [gl, stale]) {
    for (const o of [{}, {}, { refresh: true }, { defer: true }]) {
      await assert.rejects(readScope({ kind: 'project', id: projectKey(d) }, o), { code: 'GIT_MISSING', message: 'git is not installed on this machine' });
    }
  }
  await readTesting.settleDeferred();
  assert.deepEqual([gh.calls.length - n, existsSync(snapshotPath('gitlab.com/acme/unread'))], [0, false]);
});

test('a GitHub repository the metrics slug misnames (acme/.github → acme/github, tools- → tools) needs git: nothing reaches the slug\'s repository', async (t) => {
  gh.repo('acme/.github', { files: { 'profile/README.md': 'org\n' } });
  gh.repo('acme/github', { files: { a: '1' } });   // another repository: the one the slug names
  gh.commit('acme/github', { branch: 'worca-metrics', orphan: true, files: { '.worca-metrics/config.json': '{"schema":1}',
    [`${RUNS}/2026/09/20260915T143012Z-other.jsonl`]: `${JSON.stringify({ ...rec('other'), target: { kind: 'project', project: 'acme/github' } })}\n` } });
  const dot = folder(ORIGIN('https://github.com/acme/.github.git'));
  const dash = folder(ORIGIN('git@github.com:acme/tools-.git'));
  await addProject({ name: 'dot-github', path: dot });
  await addProject({ name: 'tools-dash', path: dash });
  withNoGit(t);
  const n = gh.calls.length;
  for (const d of [dot, dash]) await assert.rejects(enableTeamMetrics(d, { mode: 'here' }), { code: 'GIT_MISSING', message: 'git is not installed on this machine' });
  const prefs = await discoverProject(dot, { force: true });
  assert.deepEqual([prefs.enabled, prefs.slug, prefs.lastDiscoveryError], [undefined, 'acme/github', 'git is not installed on this machine']);
  const byKey = new Map((await listScopes()).projects.map((s) => [s.key, s]));
  assert.deepEqual([dot, dash].map((d) => [byKey.get(projectKey(d)).hasOrigin, byKey.get(projectKey(d)).needsGit]), [[true, true], [true, true]]);
  // Enabled while git was installed: the flush and the read fail as for a host slug, without a request.
  const { writeTeamMetricsPrefs } = await import('../src/core/config.mjs');
  writeTeamMetricsPrefs(projectKey(dot), { enabled: true, configKnown: true, hasOrigin: true, slug: 'acme/github', config: { schema: 1 }, checkedAt: new Date().toISOString() });
  await writeOutbox('acme/github', { ...rec('run-dot'), target: { kind: 'project', project: 'acme/github' } });
  const f = await flushSlug('acme/github');
  assert.deepEqual([f.ok, f.code, f.pending], [false, 'GIT_MISSING', 1]);
  await assert.rejects(readScope({ kind: 'project', id: projectKey(dot) }), { code: 'GIT_MISSING', message: 'git is not installed on this machine' });
  readTesting.reset();
  await assert.rejects(readScope({ kind: 'project', id: projectKey(dot) }, { defer: true }), { code: 'GIT_MISSING' });
  await readTesting.settleDeferred();
  assert.deepEqual([gh.calls.length - n, existsSync(snapshotPath('acme/github')), gh.git('acme/github', 'rev-list', '--count', 'worca-metrics')], [0, false, '1']);
  // A copy already there (another project with this slug made it): a refresh, inline or deferred, asks nothing either.
  mkdirSync(snapshotPath('acme/github'), { recursive: true });
  readTesting.reset();
  const read = await readScope({ kind: 'project', id: projectKey(dot) }, { refresh: true });
  assert.deepEqual([read.records, read.fetchError], [[], 'git is not installed on this machine']);
  readTesting.reset();
  assert.equal((await readScope({ kind: 'project', id: projectKey(dot) }, { defer: true })).refresh.pending, true);
  await readTesting.settleDeferred();
  assert.equal(gh.calls.length - n, 0);
});

test('with git installed a project with a .git origin keeps git: no HTTPS request; a typed folder keeps HTTPS', async () => {
  const real = mkdtempSync(join(root, 'real-'));
  execFileSync('git', ['init', '-q', real]);
  execFileSync('git', ['-C', real, 'remote', 'add', 'origin', 'https://github.com/acme/billing.git']);
  const calls = [];
  syncTesting.setGit(async (_cwd, args) => { calls.push(args[0]); return { ok: false, code: 128, stdout: '', stderr: 'fatal: stubbed' }; });
  let n = gh.calls.length;
  await discoverProject(real, { force: true });
  assert.deepEqual([calls, gh.calls.length], [['ls-remote'], n]);
  syncTesting.reset();
  const typed = folder({ 'a.txt': 'a' });
  await addProject({ name: 'typed', path: typed });
  writeTeamRepo(projectKey(typed), 'acme/billing');
  n = gh.calls.length;
  const prefs = await discoverProject(typed, { force: true });
  assert.deepEqual([prefs.enabled, gh.calls.length > n], [true, true]);
});

test('a deferred first read builds the snapshot; the status counts runs from it', async (t) => {
  gh.repo('acme/deferred', { files: { a: '1' } });
  gh.commit('acme/deferred', { branch: 'worca-metrics', orphan: true, files: { '.worca-metrics/config.json': '{"schema":1}',
    [`${RUNS}/2026/09/20260915T143012Z-deferred.jsonl`]: `${JSON.stringify({ ...rec('deferred'), target: { kind: 'project', project: 'acme/deferred' } })}\n` } });
  const dir = folder(ORIGIN('https://github.com/acme/deferred.git'));
  await addProject({ name: 'deferred', path: dir });
  const key = projectKey(dir);
  withNoGit(t);
  readTesting.reset();
  const first = await readScope({ kind: 'project', id: key }, { defer: true });
  assert.equal(first.refresh.pending, true);
  await readTesting.settleDeferred();
  assert.equal(existsSync(snapshotPath('acme/deferred')), true);
  const s = (await listScopes()).projects.find((x) => x.key === key);
  assert.equal(s.runs, 1);
});

test('a failed HTTPS discovery is not asked again by an unforced trigger for DISCOVERY_RETRY_MS; force asks; git always asks', async (t) => {
  const real = mkdtempSync(join(root, 'real2-'));
  execFileSync('git', ['init', '-q', real]);
  execFileSync('git', ['-C', real, 'remote', 'add', 'origin', 'https://github.com/acme/private-two.git']);
  const calls = [];
  syncTesting.setGit(async (_cwd, args) => { calls.push(args[0]); return { ok: false, code: 128, stdout: '', stderr: 'fatal: stubbed' }; });
  await discoverProject(real);
  await discoverProject(real);
  assert.deepEqual(calls, ['ls-remote', 'ls-remote']);
  syncTesting.reset();
  const priv = folder(ORIGIN('https://github.com/acme/private-one.git'));   // not on the fake: what an anonymous caller sees of a private repo
  await addProject({ name: 'private-one', path: priv });
  withNoGit(t);
  let n = gh.calls.length;
  const first = await discoverProject(priv);
  assert.equal(gh.calls.length > n, true);
  assert.match(first.lastDiscoveryError, /^not found on GitHub: acme\/private-one/);
  n = gh.calls.length;
  const again = await discoverProject(priv);
  assert.deepEqual([gh.calls.length - n, again.lastDiscoveryAt], [0, first.lastDiscoveryAt]);
  await discoverProject(priv, { now: Date.now() + DISCOVERY_RETRY_MS + 1_000 });
  assert.equal(gh.calls.length > n, true);
  n = gh.calls.length;
  await discoverProject(priv, { force: true });
  assert.equal(gh.calls.length > n, true);
});

test('a workspace record without git names its GitHub members by owner/repo; a plain Folder member keeps its folder name', async (t) => {
  const a = folder(ORIGIN('https://github.com/acme/ws-a.git'));
  const b = folder({ 'a.txt': 'b' });
  const c = folder({ 'a.txt': 'c' });
  await addProject({ name: 'ws-a', path: a });
  await addProject({ name: 'ws-b', path: b });
  await addProject({ name: 'ws-c', path: c });
  writeTeamRepo(projectKey(b), 'acme/ws-b');
  withNoGit(t);
  const harness = { isWorkspace: true, workspace: { id: 'w-gf', name: 'gf' }, state: {}, pipeline: { id: 'p-gf', dir: null },
    members: [a, b, c].map((d) => ({ projectKey: projectKey(d), projectDir: d, workMode: 'folder' })) };
  const snap = await snapshotFromHarness(harness, { status: 'done' });
  assert.deepEqual(snap.target.projects, ['acme/ws-a', 'acme/ws-b', folderProjectSlug(c)].sort());
});

test('Timeline PR events are read from the snapshot without git: a sink carries its project', async (t) => {
  const ev = JSON.stringify({ v: 1, kind: 'pr', repo: 'acme/billing', number: 7, head: 'feat/x', state: 'MERGED',
    createdAt: '2026-10-01T09:00:00Z', mergedAt: '2026-10-02T09:00:00Z' });
  gh.commit('acme/billing', { branch: 'worca-metrics', files: { '.worca-metrics/prs/7.json': ev } });
  withNoGit(t);
  await readScope({ kind: 'project', id: projectKey(billing) }, { refresh: true });
  const sinks = [{ slug: 'acme/billing', projectDir: billing }];
  assert.deepEqual((await listPrEvents({ sinks })).prs.map((p) => [p.repo, p.number, p.via]), [['acme/billing', 7, 'action']]);
  assert.deepEqual((await resolveRunPrs({ runs: [], sinks, useGh: false, useAzure: false })).status.actionRepos, ['acme/billing']);
  assert.deepEqual((await listPrEvents({ sinks: ['acme/billing'] })).prs, []);   // a bare slug is the git worktree, as before
});

test('a flush past TEAM_FLUSH_BATCH commits one batch at a time: a failed second batch keeps only its own records', async (t) => {
  withNoGit(t);
  await flushSlug('acme/billing');   // what earlier tests left behind
  assert.deepEqual(await listOutbox('acme/billing'), []);
  const base = Date.parse('2026-08-01T00:00:00Z');
  for (let i = 0; i < 250; i++) await writeOutbox('acme/billing', rec(`b-${i}`, new Date(base + i * 60_000).toISOString().replace('.000', '')));
  const commits = () => Number(gh.git('acme/billing', 'rev-list', '--count', 'worca-metrics'));
  const onBranch = () => gh.git('acme/billing', 'ls-tree', '-r', '--name-only', 'worca-metrics', `${RUNS}/2026/08`).split('\n').filter(Boolean).length;
  const before = commits();
  gh.beforeRefUpdate(() => gh.failOnce(403, 'Resource not accessible by integration', { method: 'POST', match: '/git/trees' }));
  const r = await flushSlug('acme/billing');
  assert.deepEqual([r.ok, r.code, r.pending, r.pushed], [false, 'PUSH_REJECTED', 50, 200]);
  assert.deepEqual([(await listOutbox('acme/billing')).length, onBranch(), commits() - before], [50, 200, 1]);
  const r2 = await flushSlug('acme/billing');
  assert.deepEqual([r2.ok, r2.pushed, r2.pending], [true, 50, 0]);
  assert.deepEqual([await listOutbox('acme/billing'), onBranch(), commits() - before], [[], 250, 2]);
});

const NO_CREDS = { GH_TOKEN: undefined, GITHUB_TOKEN: undefined, WORCA_GH_READ_TOKEN: undefined, WORCA_GH_WRITE_TOKEN: undefined,
  WORCA_GH_APP_ID: undefined, WORCA_GH_APP_KEY_FILE: undefined, WORCA_GH_APP_KEY_B64: undefined };
const projectRec = (id, project, at = '2026-10-05T09:00:00Z') => ({ ...rec(id, at), target: { kind: 'project', project } });
/** A fetch that never answers the matching requests (until its signal aborts; 3 s at most, so a failure ends the test). */
const hangOn = (re) => (url, init) => (re.test(new URL(url).pathname)
  ? new Promise((_, reject) => { const t = setTimeout(() => reject(new Error('hung')), 3_000); init.signal.addEventListener('abort', () => { clearTimeout(t); reject(init.signal.reason); }); })
  : gh.fetch(url, init));
/** Metrics git on a fake GitHub repository: its github.com URL rewritten to the fake's bare (offline); `calls` collects the args. */
const gitOnFake = (bare, calls = []) => (cwd, args, o) => { calls.push(args); return syncTesting.defaultGit(cwd, ['-c', `url.${dirname(dirname(bare))}/.insteadOf=https://github.com/`, ...args], o); };

test('a Folder run without git records to a GitHub team repository no discovery has read yet', async (t) => {
  gh.repo('acme/rec-nd', { files: { a: '1' } });
  gh.commit('acme/rec-nd', { branch: 'worca-metrics', orphan: true, files: { '.worca-metrics/config.json': '{"schema":1}' } });
  const dir = folder(ORIGIN('https://github.com/acme/rec-nd.git'));
  await addProject({ name: 'rec-nd', path: dir });
  withNoGit(t);
  recordTesting.setScheduleFlush(() => null);
  t.after(() => recordTesting.reset());
  const r = await recordRunMetrics({ ...fakeHarness({ projectDir: dir, runId: 'runND0001' }), workMode: 'folder' }, { status: 'done' });
  assert.deepEqual([r.recorded, (await listOutbox('acme/rec-nd')).length], [true, 1], JSON.stringify(r));
  const plain = folder({ 'a.txt': 'a' });   // no .git, no typed repository: nothing to ask GitHub
  await addProject({ name: 'rec-plain', path: plain });
  const n = gh.calls.length;
  assert.equal((await recordRunMetrics({ ...fakeHarness({ projectDir: plain, runId: 'runND0002' }), workMode: 'folder' }, { status: 'done' })).recorded, false);
  assert.equal(gh.calls.length, n);
});

test('a no-project run never discovers: its work folder\'s GitHub origin names no team repository for every no-project run', async (t) => {
  gh.repo('acme/rec-np', { files: { a: '1' } });
  gh.commit('acme/rec-np', { branch: 'worca-metrics', orphan: true, files: { '.worca-metrics/config.json': '{"schema":1}' } });
  const work = folder(ORIGIN('https://github.com/acme/rec-np.git'));   // the run's work folder: no project of its own
  withNoGit(t);
  recordTesting.setScheduleFlush(() => null);
  t.after(() => recordTesting.reset());
  const n = gh.calls.length;
  const r = await recordRunMetrics({ ...fakeHarness({ projectDir: work, runId: 'runNP0001' }), workMode: 'none' }, { status: 'done' });
  assert.deepEqual([r.recorded, gh.calls.length - n, (await listOutbox('acme/rec-np')).length], [false, 0, 0], JSON.stringify(r));
});

test('a run start\'s discovery over HTTPS is bounded by its ls / fetch timeouts', { timeout: 15_000 }, async (t) => {
  gh.repo('acme/hang', { files: { a: '1' } });
  gh.commit('acme/hang', { branch: 'worca-metrics', orphan: true, files: { '.worca-metrics/config.json': '{"schema":1}' } });
  const dir = folder(ORIGIN('https://github.com/acme/hang.git'));
  await addProject({ name: 'hang', path: dir });
  withNoGit(t);
  try {
    const t0 = Date.now();
    ghTesting.setFetch(hangOn(/\/git\/ref\/heads\/worca-metrics$/));
    assert.equal((await discoverProject(dir, { force: true, lsTimeoutMs: 50 })).lastDiscoveryError, 'GitHub unreachable (timeout)');
    ghTesting.setFetch(hangOn(/\/contents\//));
    const b = await discoverProject(dir, { force: true, fetchTimeoutMs: 50 });
    assert.deepEqual([b.enabled, b.configKnown, b.lastDiscoveryError], [true, false, 'GitHub unreachable (timeout)']);
    assert.ok(Date.now() - t0 < 2_000);
  } finally { ghTesting.setFetch(gh.fetch); }
});

test('a run flushed over HTTPS is in the next read at once, as with git', async (t) => {
  gh.repo('acme/fresh-read', { files: { a: '1' } });
  gh.commit('acme/fresh-read', { branch: 'worca-metrics', orphan: true, files: { '.worca-metrics/config.json': '{"schema":1}',
    [`${RUNS}/2026/09/20260915T000000Z-old.jsonl`]: `${JSON.stringify(projectRec('old', 'acme/fresh-read', '2026-09-15T00:00:00Z'))}\n` } });
  const dir = folder(ORIGIN('https://github.com/acme/fresh-read.git'));
  await addProject({ name: 'fresh-read', path: dir });
  withNoGit(t);
  const id = projectKey(dir);
  assert.deepEqual((await readScope({ kind: 'project', id })).records.map((r) => r.id), ['old']);
  await writeOutbox('acme/fresh-read', projectRec('mine', 'acme/fresh-read'));
  assert.equal((await flushSlug('acme/fresh-read')).ok, true);
  assert.deepEqual((await readScope({ kind: 'project', id })).records.map((r) => r.id).sort(), ['mine', 'old']);
  readTesting.reset();
  assert.deepEqual((await readScope({ kind: 'project', id }, { refresh: true })).records.map((r) => r.id).sort(), ['mine', 'old']);
});

test('a flush over HTTPS leaves the snapshot at the commit it read: a teammate\'s record never synced arrives with the next refresh', async (t) => {
  gh.repo('acme/mate', { files: { a: '1' } });
  gh.commit('acme/mate', { branch: 'worca-metrics', orphan: true, files: { '.worca-metrics/config.json': '{"schema":1}',
    [`${RUNS}/2026/09/20260915T000000Z-old.jsonl`]: `${JSON.stringify(projectRec('old', 'acme/mate', '2026-09-15T00:00:00Z'))}\n` } });
  const dir = folder(ORIGIN('https://github.com/acme/mate.git'));
  await addProject({ name: 'mate', path: dir });
  withNoGit(t);
  const ids = async (o) => (await readScope({ kind: 'project', id: projectKey(dir) }, o)).records.map((r) => r.id).sort();
  assert.deepEqual(await ids(), ['old']);
  gh.commit('acme/mate', { branch: 'worca-metrics', files: { [`${RUNS}/2026/09/20260916T000000Z-mate.jsonl`]: `${JSON.stringify(projectRec('mate', 'acme/mate', '2026-09-16T00:00:00Z'))}\n` } });
  await writeOutbox('acme/mate', projectRec('mine', 'acme/mate'));
  assert.equal((await flushSlug('acme/mate')).ok, true);
  assert.deepEqual(await ids(), ['mine', 'old']);
  readTesting.reset();
  assert.deepEqual(await ids({ refresh: true }), ['mate', 'mine', 'old']);
});

test('a flush over HTTPS onto the commit the snapshot holds moves the snapshot to the new commit: a record removed after it goes with the next refresh; our own files are not read again', async (t) => {
  gh.repo('acme/own', { files: { a: '1' } });
  gh.commit('acme/own', { branch: 'worca-metrics', orphan: true, files: { '.worca-metrics/config.json': '{"schema":1}',
    [`${RUNS}/2026/09/20260915T000000Z-keep.jsonl`]: `${JSON.stringify(projectRec('keep', 'acme/own', '2026-09-15T00:00:00Z'))}\n` } });
  const dir = folder(ORIGIN('https://github.com/acme/own.git'));
  await addProject({ name: 'own', path: dir });
  withNoGit(t);
  const ids = async (o) => (await readScope({ kind: 'project', id: projectKey(dir) }, o)).records.map((r) => r.id).sort();
  assert.deepEqual(await ids(), ['keep']);
  await writeOutbox('acme/own', projectRec('mine', 'acme/own'));
  assert.equal((await flushSlug('acme/own')).ok, true);
  gh.commit('acme/own', { branch: 'worca-metrics', files: { [`${RUNS}/2026/10/20261005T090000Z-mine.jsonl`]: null } });   // a teammate removes it
  readTesting.reset();
  assert.deepEqual(await ids({ refresh: true }), ['keep']);
  await writeOutbox('acme/own', projectRec('mine-2', 'acme/own', '2026-10-06T09:00:00Z'));
  assert.equal((await flushSlug('acme/own')).ok, true);
  readTesting.reset();
  const n = gh.calls.length;
  assert.deepEqual(await ids({ refresh: true }), ['keep', 'mine-2']);
  assert.deepEqual(gh.calls.slice(n).filter((c) => /\/(compare|contents|tarball)\//.test(c.path)).map((c) => c.path), []);   // the head is the snapshot's commit
});

test('git installed right after an HTTPS read: the next read of that project builds its git worktree at once', async (t) => {
  gh.repo('acme/arrive', { files: { a: '1' } });
  gh.commit('acme/arrive', { branch: 'worca-metrics', orphan: true, files: { '.worca-metrics/config.json': '{"schema":1}' } });
  const dir = folder(ORIGIN('https://github.com/acme/arrive.git'));
  await addProject({ name: 'arrive', path: dir });
  withNoGit(t);
  const id = projectKey(dir);
  await readScope({ kind: 'project', id });
  const calls = [];
  syncTesting.setGit(async (cwd, args) => {
    calls.push(args[0]);
    if (args[0] === 'worktree' && args[1] === 'add') mkdirSync(args[4], { recursive: true });
    return { ok: true, code: 0, stdout: '', stderr: '' };
  });
  gitArrives();
  const read = await readScope({ kind: 'project', id });
  assert.deepEqual([read.records, calls.includes('fetch'), calls.includes('worktree')], [[], true, true]);
});

for (const defer of [true, false]) {
  test(`git installed while an HTTPS ${defer ? 'deferred' : 'inline'} refresh is in flight: the next read builds its git worktree at once`, async (t) => {
    const slug = `acme/race-${defer ? 'deferred' : 'inline'}`;
    const { bare } = gh.repo(slug, { files: { a: '1' } });
    gh.commit(slug, { branch: 'worca-metrics', orphan: true, files: { '.worca-metrics/config.json': '{"schema":1}' } });
    const dir = mkdtempSync(join(root, 'race-'));
    execFileSync('git', ['init', '-q', dir]);
    execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', `https://github.com/${slug}.git`]);
    await addProject({ name: slug.split('/')[1], path: dir });
    syncTesting.setGit(gitOnFake(bare));
    withNoGit(t);
    const id = projectKey(dir);
    await readScope({ kind: 'project', id });   // the snapshot, over HTTPS
    readTesting.reset();                         // its fetch TTL elapsed
    let reached; let release;
    const atRef = new Promise((r) => { reached = r; });
    const gate = new Promise((r) => { release = r; });
    ghTesting.setFetch(async (url, init) => { if (/\/git\/ref\/heads\/worca-metrics$/.test(new URL(url).pathname)) { reached(); await gate; } return gh.fetch(url, init); });
    t.after(() => ghTesting.setFetch(gh.fetch));
    const first = readScope({ kind: 'project', id }, { defer });
    await atRef;                                 // the refresh asked GitHub for the head
    gitArrives();
    release();
    await first;
    await readTesting.settleDeferred();
    const read = await readScope({ kind: 'project', id });
    assert.deepEqual([read.records, existsSync(worktreePath(slug))], [[], true]);
  });
}

test('git gone after a git session on a team branch off GitHub: the worktree it left is still read, with "git is not installed on this machine"', async (t) => {
  const bare = join(mkdtempSync(join(root, 'offgh-')), 'team.git');
  execFileSync('git', ['init', '-q', '--bare', bare]);
  const dir = mkdtempSync(join(root, 'offgh-clone-'));
  execFileSync('git', ['init', '-q', dir]);
  execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', bare]);
  await addProject({ name: 'offgh', path: dir });
  const { slug } = await enableTeamMetrics(dir, { mode: 'here', attribution: 'none' });   // with git: pushed to the bare
  await writeOutbox(slug, projectRec('offgh-run', slug));
  assert.deepEqual([(await flushSlug(slug)).ok, existsSync(worktreePath(slug))], [true, true]);
  withNoGit(t);
  readTesting.reset();
  const id = projectKey(dir);
  const n = gh.calls.length;
  const read = (o) => readScope({ kind: 'project', id }, o);
  const inline = await read();
  assert.deepEqual([inline.records.map((r) => r.id), inline.fetchError], [['offgh-run'], 'git is not installed on this machine']);
  const throttled = await read();   // within the failed-fetch TTL: not tried again, the error still said
  assert.deepEqual([throttled.records.map((r) => r.id), throttled.refresh.fetched, throttled.fetchError], [['offgh-run'], false, 'git is not installed on this machine']);
  readTesting.reset();
  const deferred = await read({ defer: true });
  assert.deepEqual([deferred.records.map((r) => r.id), deferred.refresh.pending], [['offgh-run'], true]);
  await readTesting.settleDeferred();
  const again = await read({ defer: true });   // the failed snapshot build is not retried within the failed-fetch TTL
  assert.deepEqual([again.records.map((r) => r.id), again.refresh.pending, again.fetchError], [['offgh-run'], false, 'git is not installed on this machine']);
  assert.equal((await listScopes()).projects.find((x) => x.key === id).runs, 1);
  assert.deepEqual([gh.calls.length - n, existsSync(snapshotPath(slug))], [0, false]);
});

test('git gone after a git session on GitHub: the worktree it left is read (records, run count, PR events) until the snapshot exists, which then supersedes it', async (t) => {
  const slug = 'acme/left';
  const ev = JSON.stringify({ v: 1, kind: 'pr', repo: slug, number: 5, head: 'feat/l', state: 'MERGED', createdAt: '2026-10-01T09:00:00Z', mergedAt: '2026-10-02T09:00:00Z' });
  const { bare } = gh.repo(slug, { files: { a: '1' } });
  gh.commit(slug, { branch: 'worca-metrics', orphan: true, files: { '.worca-metrics/config.json': '{"schema":1}', '.worca-metrics/prs/5.json': ev,
    [`${RUNS}/2026/09/20260915T000000Z-left-old.jsonl`]: `${JSON.stringify(projectRec('left-old', slug, '2026-09-15T00:00:00Z'))}\n` } });
  const dir = mkdtempSync(join(root, 'left-'));
  execFileSync('git', ['init', '-q', dir]);
  execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', `https://github.com/${slug}.git`]);
  await addProject({ name: 'left', path: dir });
  syncTesting.setGit(gitOnFake(bare));
  assert.equal((await discoverProject(dir, { force: true })).enabled, true);
  await writeOutbox(slug, projectRec('left-git', slug));
  assert.deepEqual([(await flushSlug(slug)).ok, existsSync(worktreePath(slug))], [true, true]);   // git push, from the worktree
  syncTesting.reset();
  withNoGit(t);
  readTesting.reset();
  const id = projectKey(dir);
  const read = (o) => readScope({ kind: 'project', id }, o);
  const ids = (r) => r.records.map((x) => x.id).sort();
  const runs = async () => (await listScopes()).projects.find((x) => x.key === id).runs;
  gh.offline(true);
  t.after(() => gh.offline(false));
  const offline = await read();
  assert.deepEqual([ids(offline), offline.fetchError, existsSync(snapshotPath(slug))], [['left-git', 'left-old'], 'GitHub unreachable (ENOTFOUND)', false]);
  assert.equal(await runs(), 2);
  assert.deepEqual((await listPrEvents({ sinks: [{ slug, projectDir: dir }] })).prs.map((p) => p.number), [5]);
  readTesting.reset();
  const deferred = await read({ defer: true });
  assert.deepEqual([ids(deferred), deferred.refresh.pending], [['left-git', 'left-old'], true]);
  await readTesting.settleDeferred();
  const again = await read({ defer: true });
  assert.deepEqual([ids(again), again.refresh.pending, again.fetchError], [['left-git', 'left-old'], false, 'GitHub unreachable (ENOTFOUND)']);
  gh.offline(false);
  gh.commit(slug, { branch: 'worca-metrics', files: { [`${RUNS}/2026/10/20261006T000000Z-left-mate.jsonl`]: `${JSON.stringify(projectRec('left-mate', slug, '2026-10-06T00:00:00Z'))}\n` } });
  const t0 = Date.now();
  readTesting.setNow(() => t0 + FETCH_FAIL_TTL_MS + 1_000);   // the failed build may be retried; its error is still remembered
  const online = await read();
  assert.deepEqual([ids(online), online.fetchError, existsSync(snapshotPath(slug))], [['left-git', 'left-mate', 'left-old'], null, true]);
  const fresh = await read({ defer: true });   // the snapshot was just fetched: nothing due, the old error gone
  assert.deepEqual([ids(fresh), fresh.refresh.pending, fresh.fetchError], [['left-git', 'left-mate', 'left-old'], false, null]);
  assert.equal(await runs(), 3);   // the snapshot's count, no longer the worktree's 2
});

test('setup over HTTPS: an error is said once (its stderr is the same line)', async (t) => {
  const priv = folder(ORIGIN('https://github.com/acme/private-setup.git'));   // not on the fake: a private repository without a token
  await addProject({ name: 'private-setup', path: priv });
  gh.repo('acme/no-write', { files: { a: '1' } });
  const nw = folder(ORIGIN('https://github.com/acme/no-write.git'));
  await addProject({ name: 'no-write', path: nw });
  withNoGit(t);
  await withEnv(NO_CREDS, () => assert.rejects(enableTeamMetrics(priv, { mode: 'here' }), (e) => {
    assert.deepEqual([e.code, e.message, 'stderr' in e], ['REMOTE_UNREACHABLE', 'not found on GitHub: acme/private-setup (a private repository needs GH_TOKEN)', false]);
    return true;
  }));
  gh.failOnce(403, 'Resource not accessible by integration', { method: 'POST', match: '/git/trees' });
  await assert.rejects(enableTeamMetrics(nw, { mode: 'here' }), (e) => {
    assert.deepEqual([e.code, e.message, 'stderr' in e], ['PUSH_REJECTED', 'GitHub refused (HTTP 403): Resource not accessible by integration', false]);
    return true;
  });
});

test('an origin URL carrying a CI token is set up and discovered over HTTPS with worca\'s own credential: the token never sent nor shown', async (t) => {
  gh.repo('acme/ci-token', { files: { a: '1' } });
  const dir = folder(ORIGIN('https://x-access-token:ghp_ORIGIN0123456789@github.com/acme/ci-token.git'));
  await addProject({ name: 'ci-token', path: dir });
  withNoGit(t);
  const n = gh.calls.length;
  const creds = { ...NO_CREDS, WORCA_GH_WRITE_TOKEN: 'tok-w' };
  const r = await withEnv(creds, () => enableTeamMetrics(dir, { mode: 'here', attribution: 'none' }));
  assert.deepEqual([r.action, r.slug], ['created', 'acme/ci-token']);
  const prefs = await withEnv(creds, () => discoverProject(dir, { force: true }));
  assert.deepEqual([prefs.enabled, prefs.originDisplay], [true, 'github.com/acme/ci-token']);
  assert.deepEqual([...new Set(gh.calls.slice(n).map((c) => c.auth))], ['Bearer tok-w']);
});

test('with git installed a typed Folder keeps HTTPS for its flush, reads, counts and PR events (OS-1): no git call', async () => {
  gh.repo('acme/os1', { files: { a: '1' } });
  gh.commit('acme/os1', { branch: 'worca-metrics', orphan: true, files: { '.worca-metrics/config.json': '{"schema":1}',
    '.worca-metrics/prs/9.json': JSON.stringify({ v: 1, kind: 'pr', repo: 'acme/os1', number: 9, head: 'feat/y', state: 'MERGED', createdAt: '2026-10-01T09:00:00Z', mergedAt: '2026-10-02T09:00:00Z' }) } });
  const dir = folder({ 'a.txt': 'a' });
  await addProject({ name: 'os1', path: dir });
  writeTeamRepo(projectKey(dir), 'acme/os1');
  const calls = [];
  syncTesting.setGit(async (cwd, args) => { calls.push([cwd, args[0]]); return { ok: false, code: 128, stdout: '', stderr: 'fatal: stubbed' }; });
  const mine = () => calls.filter(([cwd]) => cwd === dir || String(cwd).includes('acme~os1'));
  assert.equal((await discoverProject(dir, { force: true })).enabled, true);
  await writeOutbox('acme/os1', projectRec('os1-run', 'acme/os1'));
  const f = await flushSlug('acme/os1');
  assert.deepEqual([f.ok, f.pushed], [true, 1]);
  assert.equal(gh.git('acme/os1', 'ls-tree', '-r', '--name-only', 'worca-metrics', RUNS), `${RUNS}/2026/10/20261005T090000Z-os1-run.jsonl`);
  assert.deepEqual((await readScope({ kind: 'project', id: projectKey(dir) })).records.map((r) => r.id), ['os1-run']);
  assert.equal(existsSync(join(snapshotPath('acme/os1'), ...`${RUNS}/2026/10/20261005T090000Z-os1-run.jsonl`.split('/'))), true);
  assert.equal((await listScopes()).projects.find((x) => x.key === projectKey(dir)).runs, 1);
  assert.deepEqual((await listPrEvents({ sinks: [{ slug: 'acme/os1', projectDir: dir }] })).prs.map((p) => p.number), [9]);
  assert.deepEqual(mine(), []);
});

/** With git installed: a Folder whose team repository was typed (registered first) and a git clone of that repository. */
async function typedAndClone(slug, files = {}, { registerClone = true } = {}) {
  const { bare } = gh.repo(slug, { files: { a: '1' } });
  gh.commit(slug, { branch: 'worca-metrics', orphan: true, files: { '.worca-metrics/config.json': '{"schema":1}', ...files } });
  const typed = folder({ 'a.txt': 'a' });
  await addProject({ name: `${slug.split('/')[1]}-typed`, path: typed });
  writeTeamRepo(projectKey(typed), slug);
  const clone = mkdtempSync(join(root, 'clone-'));
  execFileSync('git', ['init', '-q', clone]);
  execFileSync('git', ['-C', clone, 'remote', 'add', 'origin', `https://github.com/${slug}.git`]);
  if (registerClone) await addProject({ name: slug.split('/')[1], path: clone });
  return { bare, typed, clone };
}

test('with git installed, a typed Folder and a git clone of the same GitHub repository: the clone\'s flush runs git push and its status counts its worktree', async () => {
  const { bare, typed, clone } = await typedAndClone('acme/twin', {
    [`${RUNS}/2026/09/20260915T000000Z-twin-old.jsonl`]: `${JSON.stringify(projectRec('twin-old', 'acme/twin', '2026-09-15T00:00:00Z'))}\n` });
  const calls = [];
  syncTesting.setGit(gitOnFake(bare, calls));
  for (const d of [typed, clone]) assert.equal((await discoverProject(d, { force: true })).enabled, true);
  await writeOutbox('acme/twin', projectRec('twin-run', 'acme/twin'));
  const n = gh.calls.length;
  const f = await flushSlug('acme/twin');
  assert.deepEqual([f.ok, f.pushed, calls.some((a) => a[0] === 'push'), gh.calls.slice(n).filter((c) => c.method !== 'GET').length], [true, 1, true, 0]);
  assert.equal(gh.git('acme/twin', 'ls-tree', '-r', '--name-only', 'worca-metrics', `${RUNS}/2026/10`), `${RUNS}/2026/10/20261005T090000Z-twin-run.jsonl`);
  const byKey = new Map((await listScopes()).projects.map((s) => [s.key, s]));
  // The clone's worktree for both: the typed Folder reads it as a cache until its own snapshot exists (one branch).
  assert.deepEqual([byKey.get(projectKey(typed)).runs, byKey.get(projectKey(clone)).runs], [2, 2]);
});

test('with git installed, a typed Folder whose repository a workspace member clones: that clone flushes with git push', async () => {
  const { bare, typed, clone } = await typedAndClone('acme/twin-ws', {}, { registerClone: false });
  await createWorkspace({ name: 'twin-ws', projectPaths: [typed, clone], metricsProject: typed });   // the clone is no project
  const calls = [];
  syncTesting.setGit(gitOnFake(bare, calls));
  await writeOutbox('acme/twin-ws', projectRec('twin-ws-run', 'acme/twin-ws'));
  const n = gh.calls.length;
  const f = await flushSlug('acme/twin-ws');
  assert.deepEqual([f.ok, f.pushed, calls.some((a) => a[0] === 'push'), gh.calls.slice(n).filter((c) => c.method !== 'GET').length], [true, 1, true, 0]);
});

test('with git installed, a typed Folder\'s read never holds back the first read of a git clone of the same repository', async () => {
  const { bare, typed, clone } = await typedAndClone('acme/twin-read', {
    [`${RUNS}/2026/09/20260915T000000Z-tr.jsonl`]: `${JSON.stringify(projectRec('tr', 'acme/twin-read', '2026-09-15T00:00:00Z'))}\n` });
  syncTesting.setGit(gitOnFake(bare));
  const ids = async (d) => (await readScope({ kind: 'project', id: projectKey(d) })).records.map((r) => r.id);
  assert.deepEqual([await ids(typed), existsSync(snapshotPath('acme/twin-read'))], [['tr'], true]);
  assert.deepEqual([await ids(clone), existsSync(worktreePath('acme/twin-read'))], [['tr'], true]);
});

test('with git installed, the first deferred reads of a typed Folder and of a git clone of the same repository each build their own copy', async () => {
  const { bare, typed, clone } = await typedAndClone('acme/twin-defer');
  syncTesting.setGit(gitOnFake(bare));
  for (const d of [typed, clone]) assert.equal((await discoverProject(d, { force: true })).enabled, true);
  const reads = await Promise.all([typed, clone].map((d) => readScope({ kind: 'project', id: projectKey(d) }, { defer: true })));
  await readTesting.settleDeferred();
  assert.deepEqual([...reads.map((r) => r.refresh.pending), existsSync(snapshotPath('acme/twin-defer')), existsSync(worktreePath('acme/twin-defer'))], [true, true, true, true]);
});
