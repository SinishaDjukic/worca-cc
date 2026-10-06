// test/metrics-sync.test.mjs
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, utimesSync, rmSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { templateWorld } from './helpers/git-dir.mjs';
import { git, makeOrigin, cloneAs, branchFiles, rejectAllPushes, installFailingClientHooks, pushRawMarker, useGitSandbox } from './helpers/metrics-git.mjs';
import { addProject } from '../src/core/projects.mjs';
import { createWorkspace } from '../src/core/workspaces.mjs';
import { projectKey } from '../src/core/store.mjs';
import { readTeamMetricsPrefs, writeTeamMetricsPrefs } from '../src/core/config.mjs';
import {
  enableTeamMetrics, discoverProject, resolveProjectSink, writeOutbox, listOutbox, listOutboxSlugs, flushSlug,
  outboxDir, worktreePath, slugDirName, slugFromDirName, metricsEvents, isNonFastForward, backoffMs, routeWorkspaceMembers,
  metricsSlugFromUrl, keepProjectRecord, workspaceMetricsStatus, metricsGitEnv, _testing,
} from '../src/core/metrics/sync.mjs';
import { canonicalMetricsSlug, sameMetricsSlug } from '../src/shared/team-metrics/slug.mjs';
import { readRunLedger } from '../src/core/metrics/ledger.mjs';
import { withEnv } from './helpers/with-env.mjs';

const NO_ADO = { WORCA_ADO_TOKEN: undefined, WORCA_ADO_READ_TOKEN: undefined, WORCA_ADO_WRITE_TOKEN: undefined, AZURE_DEVOPS_EXT_PAT: undefined };
/** Every ambient variable that opens a D6/D7/D20 host-lookup gate: Azure credentials, push-as-person, App mode. */
const CLOSED_GATES = { ...NO_ADO, WORCA_GH_AS_PERSON: undefined, WORCA_BROKER_URL: undefined,
  WORCA_GH_APP_ID: undefined, WORCA_GH_APP_KEY_FILE: undefined, WORCA_GH_APP_KEY_B64: undefined };

const skip = process.platform === 'win32' ? 'pre-receive hooks / sh not portable to win32' : false;
const CHILD = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/team-metrics/flush-child.mjs');
let root; // the billing-api world (remotes/billing-api.git + machineA/billing-api), copied in before()
const homeB = mkdtempSync(join(tmpdir(), 'worca-home-b-'));
useGitSandbox(before, after);   // FIRST: pins HOME / USERPROFILE / GIT_CONFIG_GLOBAL (§5.12)
useTempHome(after);
after(() => { if (root) rmSync(root, { recursive: true, force: true }); rmSync(homeB, { recursive: true, force: true }); });
afterEach(() => { _testing.reset(); metricsEvents.removeAllListeners('changed'); });

const rec = (id, startedAt = '2026-09-15T14:30:12Z', project = 'billing-api') => ({
  v: 1, id, worca: '1.2.0', recordedAt: startedAt, startedAt, endedAt: startedAt, wallMs: 1, activeMs: 1,
  result: 'done', failure: null, workflow: null, target: { kind: 'project', project }, title: id, source: null,
  cost: { usd: 1, byPhase: {} }, agents: { count: 0, keys: [], models: [] }, steps: 0, cycles: {},
  interventions: { questions: 0, pauses: 0, resumes: 0 }, pr: null,
  git: { branch: null, head: null, base: null, filesChanged: null, insertions: null, deletions: null }, actor: null,
});

function child(args, env) {
  return new Promise((res, rej) => {
    const c = spawn(process.execPath, [CHILD, JSON.stringify(args)], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    c.on('error', rej);
    c.on('exit', (code) => {
      if (code !== 0) return rej(new Error(`child exited ${code}: ${out}`));
      try { res(JSON.parse(out)); } catch (err) { rej(new Error(`child printed non-JSON: ${out}`)); }
    });
  });
}

let billingBare, billingA, billingB; // tests below run sequentially in file order and share this state
before(async () => {
  root = templateWorld('metrics-billing', (r) => { cloneAs(r, 'machineA', makeOrigin(r, 'billing-api'), 'billing-api'); }, 'metrics-sync');
  billingBare = join(root, 'remotes', 'billing-api.git');
  billingA = join(root, 'machineA', 'billing-api');
  await addProject({ name: 'billing-api', path: billingA });
});

test('slug directory encoding round-trips and never nests', () => {
  assert.equal(slugDirName('Acme/My__Repo'), 'acme~my__repo');
  assert.equal(slugFromDirName('acme~my__repo'), 'acme/my__repo');
  assert.throws(() => slugDirName('acme/../x'), { code: 'BAD_REQUEST' });
});

test('enable creates the orphan branch with README + config, a detached metrics worktree, and a cache entry', { skip }, async () => {
  const r = await enableTeamMetrics(billingA, { mode: 'here', attribution: 'git-user' });
  assert.equal(r.action, 'created');
  assert.equal(r.slug, 'billing-api');
  assert.deepEqual(branchFiles(billingBare), ['.worca-metrics/config.json', 'README.md']);
  assert.equal(git(billingBare, 'rev-list', '--count', 'worca-metrics'), '1');           // orphan: a single parentless commit
  const cfg = JSON.parse(git(billingBare, 'show', 'worca-metrics:.worca-metrics/config.json'));
  assert.equal(cfg.schema, 1); assert.equal(cfg.attribution, 'git-user'); assert.equal(cfg.enabledBy, 'machineA dev');
  assert.ok(existsSync(join(worktreePath('billing-api'), '.git')));
  assert.equal(git(billingA, 'branch', '--list', 'worca-metrics'), '', 'no local branch pollution');
  const prefs = readTeamMetricsPrefs(projectKey(billingA));
  assert.equal(prefs.enabled, true); assert.equal(prefs.slug, 'billing-api');
});

test('enable is refused without an origin remote', async () => {
  const dir = join(root, 'machineA', 'scratch');
  git(root, 'init', '-q', dir);
  await assert.rejects(enableTeamMetrics(dir, {}), { code: 'NO_ORIGIN' });
});

test('a second machine joins when origin/worca-metrics already exists', { skip }, async () => {
  billingB = cloneAs(root, 'machineB', billingBare, 'billing-api');
  const out = await child({ op: 'add-enable', name: 'billing-api', dir: billingB }, { WORCA_HOME: homeB });
  assert.equal(out.action, 'joined');
  assert.equal(git(billingBare, 'rev-list', '--count', 'worca-metrics'), '1', 'join pushes nothing');
});

test('two outboxes flushed from two worktrees in interleaved order both land without conflict (reset-and-retry)', { skip }, async () => {
  await writeOutbox('billing-api', rec('runA0001'));
  let hookRan = 0;
  const res = await flushSlug('billing-api', {
    sleep: async () => {},
    hooks: {
      beforePush: async ({ attempt }) => {
        if (attempt !== 1) return;
        hookRan++;
        // Machine B flushes its own record between A's commit and A's push.
        const b = await child({ op: 'write-flush', dir: billingB, slug: 'billing-api', record: rec('runB0001', '2026-09-15T15:19:00Z') }, { WORCA_HOME: homeB });
        assert.equal(b.ok, true, JSON.stringify(b));
      },
    },
  });
  assert.equal(hookRan, 1);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.attempts, 2, 'first push rejected non-fast-forward, second after fetch+reset+re-copy');
  const files = branchFiles(billingBare);
  assert.ok(files.includes('.worca-metrics/runs/2026/09/20260915T143012Z-runA0001.jsonl'));
  assert.ok(files.includes('.worca-metrics/runs/2026/09/20260915T151900Z-runB0001.jsonl'));
  assert.deepEqual(await listOutbox('billing-api'), []);
  assert.equal(readRunLedger('runA0001').state, 'recorded');
});

test('reset-and-retry after a concurrent plain git push', { skip }, async () => {
  const other = cloneAs(root, 'machineC', billingBare, 'billing-api');
  git(other, 'fetch', '-q', 'origin', 'worca-metrics');
  await writeOutbox('billing-api', rec('runA0002', '2026-10-01T09:00:00Z'));
  const res = await flushSlug('billing-api', {
    sleep: async () => {},
    hooks: { beforePush: async ({ attempt }) => {
      if (attempt !== 1) return;
      git(other, 'fetch', '-q', 'origin', 'worca-metrics');
      git(other, 'checkout', '-q', '--detach', 'origin/worca-metrics');
      writeFileSync(join(other, 'concurrent.txt'), 'x'); // any unrelated path
      git(other, 'add', '-A'); git(other, 'commit', '-qm', 'concurrent');
      git(other, 'push', '-q', 'origin', 'HEAD:refs/heads/worca-metrics');
    } },
  });
  assert.equal(res.ok, true, JSON.stringify(res)); assert.equal(res.attempts, 2);
  const files = branchFiles(billingBare);
  assert.ok(files.includes('concurrent.txt'));
  assert.ok(files.includes('.worca-metrics/runs/2026/10/20261001T090000Z-runA0002.jsonl'));
});

test("the project's own failing client hooks never block enable, fetch, reset, worktree add, commit or push", { skip }, async () => {
  const bare = makeOrigin(root, 'hooked');
  const dir = cloneAs(root, 'machineA', bare, 'hooked');
  installFailingClientHooks(dir);                     // pre-commit, commit-msg, pre-push, post-checkout all exit 1
  await addProject({ name: 'hooked', path: dir });
  assert.equal((await enableTeamMetrics(dir, { mode: 'here' })).action, 'created');
  await writeOutbox('hooked', rec('runH0001', '2026-09-15T14:30:12Z', 'hooked'));
  const res = await flushSlug('hooked', { sleep: async () => {} });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.ok(branchFiles(bare).includes('.worca-metrics/runs/2026/09/20260915T143012Z-runH0001.jsonl'));
});

test('an info/exclude rule matching *.jsonl never drops records (and never deletes them from the outbox)', { skip }, async () => {
  appendFileSync(join(billingA, '.git', 'info', 'exclude'), '\n*.jsonl\n');
  await writeOutbox('billing-api', rec('runE0001', '2026-10-02T09:00:00Z'));
  const res = await flushSlug('billing-api', { sleep: async () => {} });
  assert.equal(res.ok, true, JSON.stringify(res)); assert.equal(res.pushed, 1);
  assert.ok(branchFiles(billingBare).includes('.worca-metrics/runs/2026/10/20261002T090000Z-runE0001.jsonl'));
});

test('a rejected push (pre-receive hook) leaves the outbox intact and surfaces stderr + hint', { skip }, async () => {
  const bare = makeOrigin(root, 'device-registry');
  const dir = cloneAs(root, 'machineA', bare, 'device-registry');
  await addProject({ name: 'device-registry', path: dir });
  await enableTeamMetrics(dir, { mode: 'here' });
  rejectAllPushes(bare);
  await writeOutbox('device-registry', rec('runR0001', '2026-09-15T14:30:12Z', 'device-registry'));
  const events = [];
  metricsEvents.on('changed', (e) => events.push(e));
  const res = await flushSlug('device-registry', { sleep: async () => {} });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'PUSH_REJECTED');
  assert.match(res.stderr, /protected branch hook declined/);
  assert.match(res.hint, /exempt `worca-metrics`/);
  assert.deepEqual(await listOutbox('device-registry'), ['20260915T143012Z-runR0001.jsonl']);
  assert.match(readTeamMetricsPrefs(projectKey(dir)).lastError, /protected branch hook declined/);
  assert.ok(events.some((e) => e.action === 'flush-failed'));
  assert.equal(isNonFastForward(res.stderr), false);
});

test('delegation marker resolves to the delegate (marker branch holds no run files)', { skip }, async () => {
  const gwBare = makeOrigin(root, 'gateway');
  const gw = cloneAs(root, 'machineA', gwBare, 'gateway');
  const coBare = makeOrigin(root, 'console');
  const co = cloneAs(root, 'machineA', coBare, 'console');
  await addProject({ name: 'gateway', path: gw });
  await addProject({ name: 'console', path: co });
  await enableTeamMetrics(gw, { mode: 'here', attribution: 'none' });
  const d = await enableTeamMetrics(co, { mode: 'delegate', delegateTo: 'gateway' });
  assert.equal(d.action, 'created');
  assert.deepEqual(branchFiles(coBare), ['.worca-metrics/config.json', 'README.md'], 'marker holds no run files');
  assert.equal(JSON.parse(git(coBare, 'show', 'worca-metrics:.worca-metrics/config.json')).delegateTo, 'gateway');
  const sink = await resolveProjectSink(co);
  assert.equal(sink.ok, true); assert.equal(sink.slug, 'gateway'); assert.equal(sink.attribution, 'none');
  assert.equal(sink.from, 'console'); assert.equal(sink.delegated, true);
  // Changing to the same target is a no-op, not a COMMIT_FAILED.
  assert.equal((await enableTeamMetrics(co, { mode: 'delegate', delegateTo: 'gateway', change: true })).action, 'changed');

  // Changing to a genuinely DIFFERENT target exercises the real write path (fetch → reset →
  // rewrite config.json → commit → push), not the same-target early return above.
  const changed = await enableTeamMetrics(co, { mode: 'delegate', delegateTo: 'billing-api', change: true });
  assert.equal(changed.action, 'changed');
  assert.equal(git(coBare, 'rev-list', '--count', 'worca-metrics'), '2', 'one new commit on top of the original marker');
  assert.deepEqual(branchFiles(coBare), ['.worca-metrics/config.json', 'README.md'], 'still no run files on the marker branch');
  const cfg2 = JSON.parse(git(coBare, 'show', 'worca-metrics:.worca-metrics/config.json'));
  assert.equal(cfg2.delegateTo, 'billing-api');
  const sink2 = await resolveProjectSink(co);
  assert.equal(sink2.ok, true); assert.equal(sink2.slug, 'billing-api'); assert.equal(sink2.delegated, true);
});

test('rewriteDelegation retries after a concurrent non-fast-forward push on the marker branch', { skip }, async () => {
  const oneBare = makeOrigin(root, 'sink-one');
  const one = cloneAs(root, 'machineA', oneBare, 'sink-one');
  const twoBare = makeOrigin(root, 'sink-two');
  const two = cloneAs(root, 'machineA', twoBare, 'sink-two');
  const rtBare = makeOrigin(root, 'router-one');
  const rt = cloneAs(root, 'machineA', rtBare, 'router-one');
  await addProject({ name: 'sink-one', path: one });
  await addProject({ name: 'sink-two', path: two });
  await addProject({ name: 'router-one', path: rt });
  await enableTeamMetrics(one, { mode: 'here' });
  await enableTeamMetrics(two, { mode: 'here' });
  await enableTeamMetrics(rt, { mode: 'delegate', delegateTo: 'sink-one' });

  // A second checkout of router-one's marker branch, used to push a concurrent commit that makes
  // rewriteDelegation's first push attempt non-fast-forward.
  const other = cloneAs(root, 'machineC', rtBare, 'router-one');
  git(other, 'fetch', '-q', 'origin', 'worca-metrics');

  let raced = false;
  _testing.setGit(async (cwd, args, opts) => {
    if (args[0] === 'push' && !raced) {
      raced = true;
      git(other, 'fetch', '-q', 'origin', 'worca-metrics');
      git(other, 'checkout', '-q', '--detach', 'origin/worca-metrics');
      writeFileSync(join(other, 'concurrent.txt'), 'x'); // any unrelated path
      git(other, 'add', '-A'); git(other, 'commit', '-qm', 'concurrent');
      git(other, 'push', '-q', 'origin', 'HEAD:refs/heads/worca-metrics');
    }
    return _testing.defaultGit(cwd, args, opts);
  });
  const res = await enableTeamMetrics(rt, { mode: 'delegate', delegateTo: 'sink-two', change: true });
  assert.equal(res.action, 'changed');
  const files = branchFiles(rtBare);
  assert.ok(files.includes('concurrent.txt'), 'the concurrent commit survived the reset+retry, not clobbered');
  assert.equal(JSON.parse(git(rtBare, 'show', 'worca-metrics:.worca-metrics/config.json')).delegateTo, 'sink-two');
});

test('chained, dangling and unknown delegateTo resolve to delegate-invalid', { skip }, async () => {
  const biBare = makeOrigin(root, 'payments-worker');
  const bi = cloneAs(root, 'machineA', biBare, 'payments-worker');
  await addProject({ name: 'payments-worker', path: bi });
  pushRawMarker(root, biBare, { schema: 1, delegateTo: 'console' });          // console itself delegates
  await discoverProject(bi, { force: true });
  const chain = await resolveProjectSink(bi);
  assert.deepEqual([chain.ok, chain.reason, chain.code], [false, 'delegate-invalid', 'DELEGATE_CHAIN']);
  assert.match(chain.detail, /no chains/);

  const lgBare = makeOrigin(root, 'legacy-user');
  const lg = cloneAs(root, 'machineA', lgBare, 'legacy-user');
  await addProject({ name: 'legacy-user', path: lg });
  pushRawMarker(root, lgBare, { schema: 1, delegateTo: 'acme/legacy-api' });  // not on this machine
  await discoverProject(lg, { force: true });
  assert.equal((await resolveProjectSink(lg)).code, 'DELEGATE_UNKNOWN');

  const dgBare = makeOrigin(root, 'dangling');
  const dg = cloneAs(root, 'machineA', dgBare, 'dangling');
  await addProject({ name: 'dangling', path: dg });
  pushRawMarker(root, dgBare, { schema: 1, delegateTo: 'hooked' });  // registered, but its branch will vanish
  git(dg, 'push', '-q', join(root, 'remotes', 'hooked.git'), '--delete', 'worca-metrics'); // (device-registry's origin rejects every push)
  await discoverProject(dg, { force: true });
  await discoverProject(join(root, 'machineA', 'hooked'), { force: true });
  assert.equal((await resolveProjectSink(dg)).code, 'DELEGATE_DANGLING');
});

test('a workspace metrics home that is not a registered project still flushes', { skip }, async () => {
  const hBare = makeOrigin(root, 'ws-home'); const home = cloneAs(root, 'machineA', hBare, 'ws-home');
  const mBare = makeOrigin(root, 'ws-member'); const member = cloneAs(root, 'machineA', mBare, 'ws-member');
  const ws = await createWorkspace({ name: 'Unregistered WS', projectPaths: [home, member], metricsProject: home }); // no addProject
  await enableTeamMetrics(home, { mode: 'here' });
  await writeOutbox('ws-home', { ...rec('runWS001'), target: { kind: 'workspace', workspace: 'Unregistered WS', projects: ['ws-home', 'ws-member'], touched: [] } });
  const res = await flushSlug('ws-home', { sleep: async () => {} });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.ok((await listOutboxSlugs()).includes('ws-home'));
  assert.deepEqual(await listOutbox('ws-home'), []);
  // "Route all members" delegates to that unregistered home, and the member's marker resolves to it (decision 11).
  const routed = await routeWorkspaceMembers(ws.id);
  assert.deepEqual(routed.results.map((r) => [r.slug, r.result]), [['ws-member', 'routed']], JSON.stringify(routed));
  const sink = await resolveProjectSink(member);
  assert.deepEqual([sink.ok, sink.slug, sink.delegated], [true, 'ws-home', true]);
});

test('a branch whose config.json could not be fetched is never routed to (a marker never gets run files)', { skip }, async () => {
  const mkBare = makeOrigin(root, 'marker-offline');
  const mk = cloneAs(root, 'machineA', mkBare, 'marker-offline');
  await addProject({ name: 'marker-offline', path: mk });
  pushRawMarker(root, mkBare, { schema: 1, delegateTo: 'billing-api' });
  _testing.setGit(async (cwd, args, opts) => (args[0] === 'fetch'
    ? { ok: false, code: 128, stdout: '', stderr: 'fatal: unable to access origin' }
    : _testing.defaultGit(cwd, args, opts)));
  let prefs = await discoverProject(mk, { force: true });
  assert.deepEqual([prefs.enabled, prefs.configKnown], [true, false]);
  const sink = await resolveProjectSink(mk, { discover: false });
  assert.deepEqual([sink.ok, sink.code], [false, 'CONFIG_UNKNOWN'], 'enabled:true + config:null must not read as "records locally"');
  _testing.setGit(_testing.defaultGit);
  prefs = await discoverProject(mk, { force: true });              // same head: the unread config is fetched now
  assert.deepEqual([prefs.configKnown, prefs.config.delegateTo], [true, 'billing-api']);
});

test('corrupted worktree is removed and recreated on flush', { skip }, async () => {
  rmSync(join(worktreePath('billing-api'), '.git'), { force: true });
  await writeOutbox('billing-api', rec('runW0001', '2026-11-02T10:00:00Z'));
  const res = await flushSlug('billing-api', { sleep: async () => {} });
  assert.equal(res.ok, true, JSON.stringify(res));
});

test('remote branch deleted → enabled=false; outbox kept for 30 days from the deletion, then dropped', { skip }, async () => {
  await writeOutbox('billing-api', rec('runOld001', '2026-07-01T10:00:00Z'));
  const old = join(outboxDir('billing-api'), '20260701T100000Z-runOld001.jsonl');
  const past = (Date.now() - 40 * 86_400_000) / 1000;
  utimesSync(old, past, past);                                  // written 40 days ago, before the deletion
  git(billingA, 'push', '-q', 'origin', '--delete', 'worca-metrics');
  const prefs = await discoverProject(billingA, { force: true });
  assert.equal(prefs.enabled, false); assert.ok(prefs.disabledAt);

  let res = await flushSlug('billing-api');
  assert.equal(res.code, 'BRANCH_MISSING');
  assert.deepEqual(await listOutbox('billing-api'), ['20260701T100000Z-runOld001.jsonl'], 'deleted just now: retained, however old the file');

  writeTeamMetricsPrefs(projectKey(billingA), { disabledAt: new Date(Date.now() - 31 * 86_400_000).toISOString() });
  await writeOutbox('billing-api', rec('runNew001', '2026-09-20T10:00:00Z'));   // written after the deletion: own 30 days
  res = await flushSlug('billing-api');
  assert.equal(res.code, 'BRANCH_MISSING');
  assert.deepEqual(await listOutbox('billing-api'), ['20260920T100000Z-runNew001.jsonl']);
  assert.equal(readRunLedger('runOld001').state, 'skipped');
});

test('pure helpers: non-fast-forward detection, protection hint and jittered backoff', () => {
  assert.equal(isNonFastForward(' ! [rejected]        HEAD -> worca-metrics (fetch first)\n'), true);
  assert.equal(isNonFastForward(' ! [rejected]        HEAD -> worca-metrics (non-fast-forward)\n'), true);
  assert.equal(isNonFastForward(' ! [remote rejected] HEAD -> worca-metrics (pre-receive hook declined)\n'), false);
  assert.equal(isNonFastForward(' ! [remote rejected] HEAD -> worca-metrics (push declined due to repository rule violations)\nremote: error: GH013: Repository rule violations found'), false);
  // The three real concurrent-ref-update wordings, captured from actual pushes to a bare origin.
  assert.equal(isNonFastForward(' ! [remote rejected] HEAD -> worca-metrics (cannot lock ref \'refs/heads/worca-metrics\': is at 1a2b but expected 3c4d)\n'), true); // GitHub
  assert.equal(isNonFastForward("remote: error: cannot lock ref 'refs/heads/worca-metrics': is at 300b61 but expected c4076d\nTo /tmp/conc.git\n ! [remote rejected] HEAD -> worca-metrics (failed to update ref)\n"), true); // git ≤ 2.50
  assert.equal(isNonFastForward(' ! [remote rejected] HEAD -> worca-metrics (incorrect old value provided)\n'), true); // git ≥ 2.51
  assert.equal(backoffMs(1, () => 0), 125); assert.equal(backoffMs(3, () => 1), 1500);
});

test('metricsSlugFromUrl is stable across protocols and never collides across orgs (decision 35)', () => {
  assert.equal(metricsSlugFromUrl('https://github.com/Acme/Billing-API.git'), 'acme/billing-api');
  assert.equal(metricsSlugFromUrl('git@github.com:acme/billing-api.git'), 'acme/billing-api');
  assert.equal(metricsSlugFromUrl('https://gitlab.com/g1/sub/api.git'), 'gitlab.com/g1/sub/api');
  assert.notEqual(metricsSlugFromUrl('https://gitlab.com/g1/sub/api.git'), metricsSlugFromUrl('https://gitlab.com/g2/sub/api.git'));
  assert.equal(metricsSlugFromUrl('https://dev.azure.com/orgA/projX/_git/api'), 'dev.azure.com/orga/projx/api');
  assert.equal(metricsSlugFromUrl('git@ssh.dev.azure.com:v3/orgA/projX/api'), 'dev.azure.com/orga/projx/api'); // same repo, ssh spelling
  assert.notEqual(metricsSlugFromUrl('https://dev.azure.com/orgA/projX/_git/api'), metricsSlugFromUrl('https://dev.azure.com/orgB/projY/_git/api'));
  // Percent-escapes and spaces must never reach slugDirName, which would throw and drop every record.
  assert.equal(metricsSlugFromUrl('https://dev.azure.com/org/My%20Project/_git/My Repo'), 'dev.azure.com/org/my-project/my-repo');
  assert.doesNotThrow(() => slugDirName(metricsSlugFromUrl('https://dev.azure.com/org/My%20Project/_git/My Repo')));
  assert.equal(metricsSlugFromUrl('/tmp/remotes/billing-api.git'), null);   // local bare repo → basename fallback
});

test('Azure metrics slug: every spelling folds; the default-repo short form names project and repo; odd shapes keep the generic slug', () => {
  assert.equal(metricsSlugFromUrl('https://acme.visualstudio.com/Shop/_git/api'), 'dev.azure.com/acme/shop/api');
  assert.equal(metricsSlugFromUrl('https://acme.visualstudio.com/DefaultCollection/Shop/_git/api'), 'dev.azure.com/acme/shop/api');
  assert.equal(metricsSlugFromUrl('https://acme@dev.azure.com/acme/Shop/_git/api'), 'dev.azure.com/acme/shop/api');
  // M3: the short form now matches its ssh spelling
  assert.equal(metricsSlugFromUrl('https://dev.azure.com/acme/_git/Shop'), 'dev.azure.com/acme/shop/shop');
  assert.equal(metricsSlugFromUrl('git@ssh.dev.azure.com:v3/acme/Shop/Shop'), 'dev.azure.com/acme/shop/shop');
  assert.equal(metricsSlugFromUrl('https://acme.visualstudio.com/DefaultCollection/_git/Shop'), 'dev.azure.com/acme/shop/shop');
  // m8: shapes the strict parser rejects still get today's generic slug (the sink is never lost)
  assert.equal(metricsSlugFromUrl('https://dev.azure.com/acme/Shop/_git/api/extra'), 'dev.azure.com/acme/shop/api/extra');
  assert.equal(metricsSlugFromUrl('git@ssh.dev.azure.com:acme/Shop/api'), 'dev.azure.com/acme/shop/api', 'ssh without v3');
});

test('canonicalMetricsSlug maps every slug older code wrote for an Azure repo to today\'s; idempotent (M3)', () => {
  for (const [old, now] of [
    ['dev.azure.com/acme/shop', 'dev.azure.com/acme/shop/shop'],                                  // https://dev.azure.com/acme/_git/Shop
    ['acme.visualstudio.com/shop/api', 'dev.azure.com/acme/shop/api'],
    ['acme.visualstudio.com/defaultcollection/shop/api', 'dev.azure.com/acme/shop/api'],
    ['acme.visualstudio.com/defaultcollection/shop', 'dev.azure.com/acme/shop/shop'],             // …/DefaultCollection/_git/Shop
    ['dev.azure.com/acme/shop/api', 'dev.azure.com/acme/shop/api'],
    ['dev.azure.com/acme/shop/api/extra', 'dev.azure.com/acme/shop/api/extra'],                   // D19 generic slug: untouched
    ['acme/api', 'acme/api'], ['gitlab.com/g/api', 'gitlab.com/g/api'], ['gitlab.com/g/sub/api', 'gitlab.com/g/sub/api'],
    ['billing-api', 'billing-api'],
  ]) {
    assert.equal(canonicalMetricsSlug(old), now, old);
    assert.equal(canonicalMetricsSlug(now), now, `idempotent: ${now}`);
  }
  assert.equal(canonicalMetricsSlug(null), null);
  assert.equal(sameMetricsSlug('dev.azure.com/acme/shop', 'dev.azure.com/acme/shop/shop'), true);
  assert.equal(sameMetricsSlug('acme.visualstudio.com/defaultcollection/shop', 'dev.azure.com/acme/shop/shop'), true);
  assert.equal(sameMetricsSlug('dev.azure.com/acme/shop', 'dev.azure.com/acme/other/shop'), false);
  assert.equal(sameMetricsSlug('Acme/API', 'acme/api'), true);
  assert.equal(sameMetricsSlug(null, null), false);
});

test('the project-scope predicate keeps records stamped with an older spelling of the same Azure slug (M3)', () => {
  const rec = (project, kind = 'project') => ({ target: { kind, project } });
  const short = keepProjectRecord('dev.azure.com/acme/shop/shop');
  assert.equal(short(rec('dev.azure.com/acme/shop')), true, 'written by https://dev.azure.com/acme/_git/Shop before the fold');
  assert.equal(short(rec('acme.visualstudio.com/defaultcollection/shop')), true);
  assert.equal(short(rec('dev.azure.com/acme/shop/shop')), true);
  assert.equal(short(rec('dev.azure.com/acme/shop/api')), false);
  assert.equal(short(rec('dev.azure.com/acme/shop/shop', 'workspace')), false, 'workspace runs stay excluded');
  assert.equal(keepProjectRecord('dev.azure.com/acme/shop/api')(rec('acme.visualstudio.com/shop/api')), true);
  assert.equal(keepProjectRecord('gateway')(rec('gateway')), true, 'non-Azure slugs: exact match as before');
  assert.equal(keepProjectRecord('gateway')(rec('gateway-2')), false);
  assert.equal(keepProjectRecord('gateway')({}), false);
});

test('workspace metrics card: a member delegating to the home under its old Azure slug reads routed (cycle-3 M1)', async () => {
  const h = mkdtempSync(join(tmpdir(), 'worca-mws-h-'));
  const m = mkdtempSync(join(tmpdir(), 'worca-mws-m-'));
  git(h, 'init', '-q'); git(m, 'init', '-q');       // createWorkspace → checkNewMembers needs git work trees (n1)
  writeTeamMetricsPrefs(projectKey(h), { hasOrigin: true, enabled: true, configKnown: true, slug: 'dev.azure.com/acme/shop/shop', config: { delegateTo: null } });
  writeTeamMetricsPrefs(projectKey(m), { hasOrigin: true, enabled: true, configKnown: true, slug: 'dev.azure.com/acme/web/web', config: { delegateTo: 'dev.azure.com/acme/shop' } });
  const ws = await createWorkspace({ name: 'Azure metrics', projectPaths: [h, m], metricsProject: h });
  const st = await workspaceMetricsStatus(ws, { discover: false });
  const mem = st.members.find((x) => x.path === m);
  assert.equal(mem.state, 'routed', JSON.stringify(mem));
  assert.equal(mem.recordsOn, 'dev.azure.com/acme/shop/shop');
});

test('metrics network git: an Azure origin gets the ADO helper, never a GitHub mint (App mode)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-mgit-'));
  spawnSync('git', ['init', '-q', dir]);
  spawnSync('git', ['-C', dir, 'remote', 'add', 'origin', 'https://dev.azure.com/acme/Shop/_git/api']);
  const cred = await withEnv({ WORCA_GH_APP_ID: '123', WORCA_GH_APP_KEY_B64: Buffer.from('not-a-key').toString('base64'),
    WORCA_ADO_TOKEN: 'pat', WORCA_ADO_READ_TOKEN: undefined, WORCA_ADO_WRITE_TOKEN: undefined, AZURE_DEVOPS_EXT_PAT: undefined },
  () => metricsGitEnv(dir));
  assert.equal(cred.error, null);
  assert.equal(cred.env.WORCA_ADO_GIT_TOKEN, 'pat');
  assert.equal(cred.env.GH_TOKEN, undefined);
});

test('metrics network git: token mode without an Azure credential keeps the GitHub token env (no lookup)', async () => {
  const cred = await withEnv({ ...CLOSED_GATES, GH_TOKEN: 'ghp_x' }, () => metricsGitEnv('/nonexistent'));
  assert.equal(cred.env.GH_TOKEN, 'ghp_x');
});
