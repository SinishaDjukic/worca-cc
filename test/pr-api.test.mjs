// test/pr-api.test.mjs
// Phase 3.7 — the server's POST /api/pr + /api/runs routes read the DB: the
// pipeline's branch + projectDir come back through rowToState (branch JSON column;
// projectDir from the project's store_meta path). Fixtures seed pipelines rows via
// the production writers (seedPipeline -> createPipeline + writeState) + store_meta
// (writeStoreMeta) instead of state.json/meta.json. The projectKey/id the POST body
// carries are content-derived/minted (A15(3)) — use the RETURNED key/id (module vars).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app } from '../ui/server.mjs';
import { _testing as gitInfo } from '../src/core/git-info.mjs';
import { _testing as gitSync } from '../src/core/git-sync.mjs';
import { projectKey } from '../src/core/store.mjs';
import { _resetForTests, getDb } from '../src/core/db.mjs';
import { writeStoreMeta, persistPrState, readPrState, createPipeline, writeState } from '../src/core/artifacts.mjs';
import { _testing as prDesc, PR_BODY_MAX } from '../src/core/pr-description.mjs';
import * as azurePr from '../src/core/pr/azure.mjs';
import { setPrRemotePrefs, readPrRemotePrefs } from '../src/core/config.mjs';
import { createTicket, markTicketFired } from '../src/core/scheduler.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { getWatch } from '../src/core/pr-watch.mjs';
import { checkRows } from './helpers/rows.mjs';
import { withEnv } from './helpers/with-env.mjs';

const NO_ADO = { WORCA_ADO_TOKEN: undefined, WORCA_ADO_READ_TOKEN: undefined, WORCA_ADO_WRITE_TOKEN: undefined, AZURE_DEVOPS_EXT_PAT: undefined };
const WITH_ADO = { ...NO_ADO, WORCA_ADO_TOKEN: 'pat' };

let srv, base, home, prevHome, betaKey, betaId, betaRepo;

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-pr-'));
  prevHome = process.env.WORCA_HOME; process.env.WORCA_HOME = home;
  _resetForTests(); // open the DB under this temp home
  // Seed via the production writer; createPipeline's ensureMeta writes the store_meta
  // (path = the repo dir) the PR route reads for projectDir. Pin name to 'Beta'.
  betaRepo = await mkdtemp(join(tmpdir(), 'worca-cc-pr-repo-'));
  const seeded = await seedPipeline(betaRepo, { title: 'My feature', status: 'stopped',
    startedAt: '2026-06-01T00:00:00Z',
    branch: { source: 'main', feature: 'worca-cc/my-feature-pp', branchKept: true, commit: 'abc' } });
  betaId = seeded.id; betaKey = seeded.key;
  writeStoreMeta(betaKey, 'project', { key: betaKey, name: 'Beta', path: betaRepo });
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  gitInfo.reset();
  gitSync.reset();
  azurePr._testing.reset();
  _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rm(home, { recursive: true, force: true });
});

beforeEach(() => { gitInfo.reset(); gitSync.reset(); prDesc.reset(); azurePr._testing.reset(); });

// git-sync's runner (the base-freshness fetch, #527): upstream is a github remote; every argv
// lands in `seen`; `rev-list --count` answers `moved`.
function stubSyncRepo(seen, { moved = '0' } = {}) {
  gitSync.setRunner((args) => {
    seen.push(args);
    if (args[0] === 'remote' && args[1] === 'get-url') return Promise.resolve({ ok: true, stdout: 'git@github.com:up/repo.git\n', stderr: '', code: 0 });
    if (args[0] === 'rev-list' && args[1] === '--count') return Promise.resolve({ ok: true, stdout: `${moved}\n`, stderr: '', code: 0 });
    if (args[0] === 'rev-parse') return Promise.resolve({ ok: false, stdout: '', stderr: '', code: 1 });
    return Promise.resolve({ ok: true, stdout: '', stderr: '', code: 0 });
  });
}

const post = (body) => fetch(`${base}/api/pr`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

const REMOTES_V = [
  'origin\thttps://github.com/me/repo.git (fetch)',
  'origin\thttps://github.com/me/repo.git (push)',
  'upstream\tgit@github.com:up/repo.git (fetch)',
  'upstream\tgit@github.com:up/repo.git (push)',
].join('\n') + '\n';

// gh present; git remotes = origin (the fork) + upstream; every argv lands in `seen`.
function stubForkRepo(seen, { create = 'https://github.com/up/repo/pull/7\n', view = 'MERGEABLE\n', remotesOk = true, refs = REFS } = {}) {
  gitInfo.setRunner((cmd, args) => {
    seen.push([cmd, ...args]);
    if (cmd === 'gh' && args[0] === '--version') return Promise.resolve({ ok: true, stdout: 'gh 2.x', stderr: '', code: 0 });
    if (cmd === 'git' && args[0] === 'remote') {
      return remotesOk
        ? Promise.resolve({ ok: true, stdout: REMOTES_V, stderr: '', code: 0 })
        : Promise.resolve({ ok: false, stdout: '', stderr: 'fatal: not a git repository', code: 128 });
    }
    if (cmd === 'git' && args[0] === 'for-each-ref') return Promise.resolve({ ok: true, stdout: refs, stderr: '', code: 0 });
    if (cmd === 'git' && args[0] === 'push') return Promise.resolve({ ok: true, stdout: '', stderr: '', code: 0 });
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'create') return Promise.resolve({ ok: true, stdout: create, stderr: '', code: 0 });
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'view') return Promise.resolve({ ok: true, stdout: view, stderr: '', code: 0 });
    return Promise.resolve({ ok: true, stdout: '', stderr: '', code: 0 });
  });
}

const AZ = 'https://dev.azure.com/acme/Shop/_git/api';
const AZ_REMOTES_V = `origin\t${AZ} (fetch)\norigin\t${AZ} (push)\n`;
/** gh present; one Azure origin. `remote -v` lists it, `remote get-url` answers the single URL; argv + env recorded. */
function stubAzureRepo(seen, { remotesV = AZ_REMOTES_V, getUrl = (name) => (name === 'fork' ? 'https://dev.azure.com/acme/Shop/_git/api-fork' : AZ) } = {}) {
  gitInfo.setRunner((cmd, args, opts = {}) => {
    seen.push({ argv: [cmd, ...args], env: opts.env });
    const done = (stdout = '') => Promise.resolve({ ok: true, stdout, stderr: '', code: 0 });
    if (cmd === 'gh' && args[0] === '--version') return done('gh 2.x');
    if (cmd === 'git' && args[0] === 'remote' && args[1] === 'get-url') return done(`${getUrl(args[args.length - 1])}\n`);
    if (cmd === 'git' && args[0] === 'remote') return done(remotesV);
    if (cmd === 'git' && args[0] === 'for-each-ref') return done(REFS);
    if (cmd === 'gh') return Promise.resolve({ ok: false, stdout: '', stderr: 'gh must not run for Azure', code: 1 });
    return done();
  });
}
const adoJson = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
/** Azure REST fake: POST …/pullrequests answers `create`, GET …/pullrequests/31 answers `view`; every call recorded. */
function stubAdo(calls, { create = () => adoJson(201, { pullRequestId: 31 }),
  view = { pullRequestId: 31, status: 'active', mergeStatus: 'succeeded' } } = {}) {
  azurePr._testing.setFetch(async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push({ url: String(url), method, body: init.body ? JSON.parse(init.body) : undefined });
    const path = new URL(url).pathname;
    if (method === 'POST' && path.endsWith('/pullrequests')) return create();
    if (method === 'GET' && path.endsWith('/pullrequests/31')) return adoJson(200, view);
    return adoJson(404, { message: 'not stubbed' });
  });
}
const getRemotes =(q) => fetch(`${base}/api/pr/remotes?${new URLSearchParams(q)}`);
const postMergeable = (body) => fetch(`${base}/api/pr/mergeable`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const FEATURE = 'worca-cc/my-feature-pp';
// `git for-each-ref refs/remotes/` as git prints it (sorted): HEAD and the run's own branch included.
const REFS = [
  'refs/remotes/origin/HEAD', 'refs/remotes/origin/main', 'refs/remotes/origin/release', `refs/remotes/origin/${FEATURE}`,
  'refs/remotes/upstream/dev', 'refs/remotes/upstream/main',
].join('\n') + '\n';

test('POST /api/pr error paths: 400 without id, 409 when gh is unavailable', async () => {
  await checkRows([
    { name: 'POST /api/pr -> 400 when id is missing', run: async () => {
      assert.equal((await post({ projectKey: betaKey })).status, 400);
    } },
    { name: 'POST /api/pr -> 409 when no PR host is available (no gh, no Azure token)', run: () => withEnv(NO_ADO, async () => {
      gitInfo.setRunner((cmd) => Promise.resolve(
        cmd === 'gh' ? { ok: false, stdout: '', stderr: 'not found', code: 127 }
                     : { ok: true, stdout: '', stderr: '', code: 0 }));
      assert.equal((await post({ projectKey: betaKey, id: betaId })).status, 409);
    }) },
  ]);
});

test('POST /api/pr pushes, creates the PR, returns url + mergeable', async () => {
  const seen = [];
  gitInfo.setRunner((cmd, args) => {
    seen.push([cmd, ...args]);
    if (cmd === 'gh' && args[0] === '--version') return Promise.resolve({ ok: true, stdout: 'gh 2.x', stderr: '', code: 0 });
    if (cmd === 'git' && args[0] === 'push') return Promise.resolve({ ok: true, stdout: '', stderr: '', code: 0 });
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'create')
      return Promise.resolve({ ok: true, stdout: 'https://github.com/x/y/pull/7\n', stderr: '', code: 0 });
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'view')
      return Promise.resolve({ ok: true, stdout: 'MERGEABLE\n', stderr: '', code: 0 });
    return Promise.resolve({ ok: true, stdout: '', stderr: '', code: 0 });
  });
  const r = await post({ projectKey: betaKey, id: betaId });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.url, 'https://github.com/x/y/pull/7');
  assert.equal(j.mergeable, 'MERGEABLE');
  assert.ok(seen.some((c) => c[0] === 'git' && c[1] === 'push'), 'branch was pushed');
  assert.ok(seen.some((c) => c[0] === 'gh' && c[1] === 'pr' && c[2] === 'create'), 'PR was created');
});

test('GET /api/history exposes ghAvailable', async () => {
  gitInfo.setRunner((cmd, args) =>
    Promise.resolve(cmd === 'gh' && args[0] === '--version'
      ? { ok: true, stdout: 'gh 2.x', stderr: '', code: 0 }
      : { ok: true, stdout: '', stderr: '', code: 0 }));
  const j = await (await fetch(`${base}/api/history`)).json();
  assert.equal(j.ghAvailable, true);
});

test('GET /api/history is PR-light: no inline pr even when an OPEN PR exists', async () => {
  // The live PR state now rides the WS (POST /api/history/pr -> history-pr events),
  // so the machine-wide skeleton must NOT attach pr inline or spend `gh pr list`.
  let prListCalled = false;
  gitInfo.setRunner((cmd, args) => {
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'list') {
      prListCalled = true;
      return Promise.resolve({ ok: true, stdout: JSON.stringify([{ number: 4, state: 'OPEN', url: 'https://gh/b/pull/4' }]), stderr: '', code: 0 });
    }
    if (cmd === 'gh' && args[0] === '--version') return Promise.resolve({ ok: true, stdout: 'gh 2.x', stderr: '', code: 0 });
    if (cmd === 'git' && args[0] === 'rev-parse') return Promise.resolve({ ok: true, stdout: 'ref\n', stderr: '', code: 0 });
    return Promise.resolve({ ok: true, stdout: '', stderr: '', code: 0 });
  });
  const j = await (await fetch(`${base}/api/history`)).json();
  const row = j.pipelines.find((p) => p.id === betaId);
  assert.equal('pr' in row, false, 'history skeleton omits inline pr');
  assert.equal(prListCalled, false, 'GET /api/history does not run `gh pr list`');
});

test('GET /api/runs?projectDir still returns inline pr (per-project withPr unchanged)', async () => {
  // Only /api/history went two-phase; the per-project /api/runs arm KEEPS withPr:true
  // and must still attach pr inline. Seed under the real projectKey so the lookup hits.
  const repoDir = await mkdtemp(join(tmpdir(), 'worca-cc-runs-repo-'));
  const key = projectKey(repoDir);
  const { id: rpId } = await seedPipeline(repoDir, { title: 'Runs feat', status: 'stopped',
    startedAt: '2026-06-01T00:00:00Z',
    branch: { source: 'main', feature: 'worca-cc/runs-rp', branchKept: true } });
  writeStoreMeta(key, 'project', { key, name: 'RunsRepo', path: repoDir });
  gitInfo.setRunner((cmd, args) => {
    if (cmd === 'gh' && args[0] === '--version') return Promise.resolve({ ok: true, stdout: 'gh 2.x', stderr: '', code: 0 });
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'list')
      return Promise.resolve({ ok: true, stdout: JSON.stringify([{ number: 9, state: 'OPEN', url: 'https://gh/r/pull/9' }]), stderr: '', code: 0 });
    if (cmd === 'git' && args[0] === 'rev-parse') return Promise.resolve({ ok: true, stdout: 'ref\n', stderr: '', code: 0 });
    return Promise.resolve({ ok: true, stdout: '', stderr: '', code: 0 });
  });
  const j = await (await fetch(`${base}/api/runs?projectDir=${encodeURIComponent(repoDir)}`)).json();
  const row = j.pipelines.find((p) => p.id === rpId);
  assert.deepEqual(row.pr, { state: 'OPEN', url: 'https://gh/r/pull/9', number: 9 });
});

test('POST /api/pr/mergeable error paths: 400 without id; 200 UNKNOWN when gh is missing or the key is malformed', async () => {
  await checkRows([
    { name: 'POST /api/pr/mergeable -> UNKNOWN (best-effort) when no PR host is available', run: () => withEnv(NO_ADO, async () => {
      gitInfo.setRunner((cmd) => Promise.resolve(
        cmd === 'gh' ? { ok: false, stdout: '', stderr: 'not found', code: 127 }
                     : { ok: true, stdout: '', stderr: '', code: 0 }));
      const r = await fetch(`${base}/api/pr/mergeable`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectKey: betaKey, id: betaId }),
      });
      assert.equal(r.status, 200);
      assert.equal((await r.json()).mergeable, 'UNKNOWN');
    }) },
    { name: 'POST /api/pr/mergeable requires id -> 400 (the one hard error)', run: async () => {
      const r = await fetch(`${base}/api/pr/mergeable`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectKey: betaKey }),   // no id
      });
      assert.equal(r.status, 400);
    } },
    { name: 'POST /api/pr/mergeable -> 200 UNKNOWN on a malformed key (best-effort, never a hard error)', run: async () => {
      // Pins the branch at server.mjs:2351-2353 that /api/pr/remotes deliberately does NOT share.
      stubForkRepo([]);
      const r = await postMergeable({ projectKey: 'nope', id: betaId });
      assert.equal(r.status, 200);
      assert.equal((await r.json()).mergeable, 'UNKNOWN');
    } },
  ]);
});

test('GET /api/pr/remotes lists parsed remotes with upstream-preferred base defaults', async () => {
  await setPrRemotePrefs(betaRepo, {});          // isolation: nothing remembered
  stubForkRepo([]);
  const r = await getRemotes({ projectKey: betaKey, id: betaId });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual(j.remotes.map((x) => [x.name, x.slug, x.owner]), [['origin', 'me/repo', 'me'], ['upstream', 'up/repo', 'up']]);
  assert.deepEqual(j.defaults, { pushRemote: 'origin', baseRemote: 'upstream' });
  assert.equal(j.remembered, null);
});

test('GET /api/pr/remotes -> 400 without id, 404 on a malformed key, 500 when git fails', async () => {
  stubForkRepo([]);
  assert.equal((await getRemotes({ projectKey: betaKey })).status, 400);
  assert.equal((await getRemotes({ projectKey: 'nope', id: betaId })).status, 404);
  stubForkRepo([], { remotesOk: false });
  const r = await getRemotes({ projectKey: betaKey, id: betaId });
  assert.equal(r.status, 500);
  assert.match((await r.json()).error, /git remote failed/);
});

test('POST /api/pr rejects a remote name that is not in the repo (nothing pushed)', async () => {
  const seen = [];
  stubForkRepo(seen);
  const r = await post({ projectKey: betaKey, id: betaId, pushRemote: 'evil; rm -rf /' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /unknown push remote/);
  assert.ok(!seen.some((c) => c[0] === 'git' && c[1] === 'push'), 'nothing was pushed');
  assert.equal((await post({ projectKey: betaKey, id: betaId, baseRemote: 42 })).status, 400);
});

test('POST /api/pr -> 500 (git error, not "unknown remote") when a remote is named but git remote -v fails', async () => {
  const seen = [];
  stubForkRepo(seen, { remotesOk: false });
  const r = await post({ projectKey: betaKey, id: betaId, pushRemote: 'origin' });
  assert.equal(r.status, 500);
  assert.match((await r.json()).error, /git remote failed/);
  assert.ok(!seen.some((c) => c[0] === 'git' && c[1] === 'push'), 'nothing was pushed');
});

test('POST /api/pr cross-repo: pushes to the fork, opens the PR in the base repo with owner:branch', async () => {
  const seen = [];
  stubForkRepo(seen);
  const r = await post({ projectKey: betaKey, id: betaId, pushRemote: 'origin', baseRemote: 'upstream' });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.url, 'https://github.com/up/repo/pull/7');
  assert.deepEqual(Object.keys(j).sort(), ['draft', 'existed', 'mergeable', 'ok', 'url'], 'the response shape is unchanged');
  assert.deepEqual(seen.find((c) => c[1] === 'push'), ['git', 'push', '-u', 'origin', FEATURE]);
  assert.deepEqual(seen.find((c) => c[2] === 'create'),
    ['gh', 'pr', 'create', '--repo', 'up/repo', '--base', 'main', '--head', `me:${FEATURE}`, '--title', 'My feature', '--body', 'My feature']);
  // Mergeability is read back through the PR url (repo-agnostic), not the head.
  assert.deepEqual(seen.find((c) => c[2] === 'view'),
    ['gh', 'pr', 'view', 'https://github.com/up/repo/pull/7', '--json', 'mergeable', '-q', '.mergeable']);
  // The choice is remembered for the project and becomes the dialog default.
  const g = await (await getRemotes({ projectKey: betaKey, id: betaId })).json();
  assert.deepEqual(g.remembered, { pushRemote: 'origin', baseRemote: 'upstream' });
  assert.deepEqual(g.defaults, { pushRemote: 'origin', baseRemote: 'upstream' });
});

test('POST /api/pr same-repo: still passes --repo, the head stays bare', async () => {
  const seen = [];
  stubForkRepo(seen);
  const r = await post({ projectKey: betaKey, id: betaId, pushRemote: 'upstream', baseRemote: 'upstream' });
  assert.equal(r.status, 200);
  assert.deepEqual(seen.find((c) => c[1] === 'push'), ['git', 'push', '-u', 'upstream', FEATURE]);
  assert.deepEqual(seen.find((c) => c[2] === 'create').slice(0, 9),
    ['gh', 'pr', 'create', '--repo', 'up/repo', '--base', 'main', '--head', FEATURE]);
});

test('POST /api/pr without remote fields follows the remembered choice', async () => {
  await setPrRemotePrefs(betaRepo, { pushRemote: 'upstream', baseRemote: 'origin' });
  const seen = [];
  stubForkRepo(seen);
  assert.equal((await post({ projectKey: betaKey, id: betaId })).status, 200);
  assert.deepEqual(seen.find((c) => c[1] === 'push'), ['git', 'push', '-u', 'upstream', FEATURE]);
  assert.deepEqual(seen.find((c) => c[2] === 'create').slice(3, 5), ['--repo', 'me/repo']);
  assert.deepEqual(seen.find((c) => c[2] === 'create').slice(7, 9), ['--head', `up:${FEATURE}`], 'cross-repo the other way round');
});

test('POST /api/pr/mergeable re-reads via gh pr view <persisted pr_url> — no push, no create', async () => {
  persistPrState(betaId, { url: 'https://github.com/up/repo/pull/7', number: 7, state: 'OPEN' });
  const seen = [];
  stubForkRepo(seen, { view: 'CONFLICTING\n' });
  const r = await postMergeable({ projectKey: betaKey, id: betaId });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).mergeable, 'CONFLICTING');
  assert.ok(seen.some((c) => c[0] === 'gh' && c[1] === 'pr' && c[2] === 'view'), 'mergeability was re-read');
  assert.deepEqual(seen.find((c) => c[2] === 'view'),
    ['gh', 'pr', 'view', 'https://github.com/up/repo/pull/7', '--json', 'mergeable', '-q', '.mergeable']);
  assert.ok(!seen.some((c) => c[0] === 'git' && c[1] === 'push'), 'no push on a re-check');
  assert.ok(!seen.some((c) => c[0] === 'gh' && c[1] === 'pr' && c[2] === 'create'), 'no PR create on a re-check');
});

// ---------------------------------------------------------------------------
// Base branch: the dialog picks it; a run chain defaults to the chain's ROOT.
// ---------------------------------------------------------------------------

test('GET /api/pr/remotes lists each remote\'s branches (local refs, no HEAD, no feature) and defaults to the run\'s source', async () => {
  await setPrRemotePrefs(betaRepo, {});
  const seen = [];
  stubForkRepo(seen);
  const j = await (await getRemotes({ projectKey: betaKey, id: betaId })).json();
  assert.deepEqual(j.chain, ['main'], 'a run outside a chain offers its own source');
  assert.equal(j.defaultBase, 'main');
  assert.deepEqual(j.branches, { origin: ['main', 'release'], upstream: ['dev', 'main'] });
  assert.ok(seen.some((c) => c[1] === 'for-each-ref'), 'read from the local remote-tracking refs');
  assert.ok(!seen.some((c) => c[1] === 'fetch' || c[1] === 'ls-remote'), 'git-info itself never goes to the network');
  // The fixture dir is not a git repo: "no remote" is nothing to compare, never "stale".
  assert.deepEqual(j.baseStatus, { base: 'main', remote: 'upstream', movedSinceRun: null, fetchedAt: null, stale: false });
  // Refs that cannot be read are no reason to fail the dialog: no branches, same chain.
  gitInfo.setRunner((cmd, args) => (cmd === 'git' && args[0] === 'for-each-ref'
    ? Promise.resolve({ ok: false, stdout: '', stderr: 'fatal: bad', code: 128 })
    : Promise.resolve({ ok: true, stdout: cmd === 'git' && args[0] === 'remote' ? REMOTES_V : '', stderr: '', code: 0 })));
  const k = await (await getRemotes({ projectKey: betaKey, id: betaId })).json();
  assert.deepEqual([k.branches, k.chain, k.defaultBase], [{}, ['main'], 'main']);
});

test('GET /api/pr/remotes fetches the base remote once (git-sync) and reports baseStatus', async () => {
  await setPrRemotePrefs(betaRepo, {});
  stubForkRepo([]);
  const seen = [];
  stubSyncRepo(seen);
  const j = await (await getRemotes({ projectKey: betaKey, id: betaId })).json();
  assert.deepEqual(seen.filter((a) => a[0] === 'fetch'), [['fetch', '--prune', '--no-tags', 'upstream']], 'exactly one fetch of the base remote');
  assert.equal(j.baseStatus.remote, 'upstream');
  assert.equal(j.baseStatus.stale, false);
  assert.equal(j.baseStatus.movedSinceRun, null, 'no recorded baseSha: unknown, never 0');
});

test('GET /api/pr/remotes: a run with baseSha gets baseStatus.movedSinceRun from rev-list --count', async () => {
  await setPrRemotePrefs(betaRepo, {});
  const seeded = await seedPipeline(betaRepo, { title: 'Base moved', status: 'stopped', startedAt: '2026-06-02T00:00:00Z',
    branch: { source: 'main', feature: 'worca-cc/base-moved', branchKept: true, commit: 'abc', baseSha: 'a'.repeat(40) } });
  stubForkRepo([]);
  const seen = [];
  stubSyncRepo(seen, { moved: '3' });
  const j = await (await getRemotes({ projectKey: betaKey, id: seeded.id })).json();
  assert.equal(j.baseStatus.movedSinceRun, 3);
  assert.ok(seen.some((a) => a[0] === 'rev-list' && a[2] === `${'a'.repeat(40)}..refs/remotes/upstream/main`), 'measured from baseSha to the base remote');
});

test('POST /api/pr baseBranch reaches gh pr create --base; the response shape and the remembered remotes are unchanged', async () => {
  await setPrRemotePrefs(betaRepo, {});
  const seen = [];
  stubForkRepo(seen);
  const r = await post({ projectKey: betaKey, id: betaId, pushRemote: 'origin', baseRemote: 'upstream', baseBranch: 'dev' });
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(await r.json()).sort(), ['draft', 'existed', 'mergeable', 'ok', 'url']);
  assert.deepEqual(seen.find((c) => c[2] === 'create'),
    ['gh', 'pr', 'create', '--repo', 'up/repo', '--base', 'dev', '--head', `me:${FEATURE}`, '--title', 'My feature', '--body', 'My feature']);
  assert.deepEqual(readPrRemotePrefs(betaRepo), { pushRemote: 'origin', baseRemote: 'upstream' }, 'the base branch is per run, never remembered');
});

test('POST /api/pr refuses a bad baseBranch with 400 before anything is pushed', async () => {
  for (const baseBranch of ['-x', '--upload-pack=evil', 'a..b', 'bad ref', 'x.lock', '', '   ', 42, FEATURE]) {
    const seen = [];
    stubForkRepo(seen);
    const r = await post({ projectKey: betaKey, id: betaId, baseBranch });
    assert.equal(r.status, 400, JSON.stringify(baseBranch));
    assert.match((await r.json()).error, /base branch/, JSON.stringify(baseBranch));
    assert.ok(!seen.some((c) => c[1] === 'push' || c[2] === 'create'), `nothing pushed or created for ${JSON.stringify(baseBranch)}`);
  }
  // null is "not given": the run's source, as before.
  const seen = [];
  stubForkRepo(seen);
  assert.equal((await post({ projectKey: betaKey, id: betaId, baseBranch: null })).status, 200);
  assert.deepEqual(seen.find((c) => c[2] === 'create').slice(5, 7), ['--base', 'main']);
});

test('a chained run: GET offers the chain root first as the default; POST without baseBranch still targets its source', async () => {
  // dev -> nb1 -> nb2 -> nb3, each started from the previous run's feature branch.
  const run = async (title, source, feature) => (await seedPipeline(betaRepo, { title, status: 'done',
    startedAt: '2026-06-02T00:00:00Z', branch: { source, feature, branchKept: true } })).id;
  const nb1 = await run('Nb1', 'dev', 'worca-cc/nb1');
  const nb2 = await run('Nb2', 'worca-cc/nb1', 'worca-cc/nb2');
  const nb3 = await run('Nb3', 'worca-cc/nb2', 'worca-cc/nb3');
  const req = { projectDir: betaRepo, prompt: 'next' };
  const chainOn = (after, pipelineId) => {
    const t = createTicket({ projectDir: betaRepo, title: 'next', request: req, after, sourceFromPrevious: true });
    markTicketFired(t.id, { pipelineId });
    return t;
  };
  const t2 = chainOn({ kind: 'pipeline', id: nb1 }, nb2);
  chainOn({ kind: 'ticket', id: t2.id }, nb3);

  const seen = [];
  stubForkRepo(seen, { refs: `${REFS}refs/remotes/origin/worca-cc/nb2\nrefs/remotes/origin/worca-cc/nb3\n` });
  const j = await (await getRemotes({ projectKey: betaKey, id: nb3 })).json();
  assert.deepEqual(j.chain, ['dev', 'worca-cc/nb1', 'worca-cc/nb2']);
  assert.equal(j.defaultBase, 'dev', 'the chain ROOT, not the direct source');
  assert.deepEqual(j.branches.origin, ['main', 'release', FEATURE, 'worca-cc/nb2'], 'nb3\'s own branch is dropped');

  // The chain survives a remote list that cannot be read, so the dialog can still offer it.
  stubForkRepo([], { remotesOk: false });
  const bad = await getRemotes({ projectKey: betaKey, id: nb3 });
  assert.equal(bad.status, 500);
  const b = await bad.json();
  assert.deepEqual([b.chain, b.defaultBase], [['dev', 'worca-cc/nb1', 'worca-cc/nb2'], 'dev']);

  const s1 = [];
  stubForkRepo(s1);
  assert.equal((await post({ projectKey: betaKey, id: nb3 })).status, 200);
  assert.deepEqual(s1.find((c) => c[2] === 'create').slice(5, 7), ['--base', 'worca-cc/nb2'], 'absent -> today\'s behaviour');
  const s2 = [];
  stubForkRepo(s2);
  assert.equal((await post({ projectKey: betaKey, id: nb3, baseBranch: 'dev' })).status, 200);
  assert.deepEqual(s2.find((c) => c[2] === 'create').slice(5, 7), ['--base', 'dev']);
});

// ---------------------------------------------------------------------------
// The "Ship it?" modal's PR description: an optional `body` on POST /api/pr, and
// POST /api/pr/describe behind its Generate with AI button.
// ---------------------------------------------------------------------------
const bodyArg = (seen) => {
  const c = seen.find((x) => x[0] === 'gh' && x[1] === 'pr' && x[2] === 'create');
  return c[c.indexOf('--body') + 1];
};

test('POST /api/pr without a body (absent, null or blank) keeps today\'s --body byte-for-byte', async () => {
  for (const extra of [{}, { body: null }, { body: '' }, { body: '  \n ' }]) {
    const seen = [];
    stubForkRepo(seen);
    assert.equal((await post({ projectKey: betaKey, id: betaId, ...extra })).status, 200, JSON.stringify(extra));
    assert.equal(bodyArg(seen), 'My feature', `${JSON.stringify(extra)}: createPr falls back to the title`);
  }
});

test('POST /api/pr sends the user description as the PR body, the attribution footer after it', async () => {
  let seen = [];
  stubForkRepo(seen);
  assert.equal((await post({ projectKey: betaKey, id: betaId, body: '## Summary\nRetries fetch.\n\n' })).status, 200);
  assert.equal(bodyArg(seen), '## Summary\nRetries fetch.', 'a local run has no footer; trailing whitespace is dropped');

  const { id, dir } = await createPipeline(betaRepo, { prompt: 'p', title: 'Signed feature', startedBy: 'grace@example.com' });
  await writeState(dir, { projectKey: betaKey, id, title: 'Signed feature', status: 'done',
    branch: { source: 'main', feature: 'worca-cc/signed', branchKept: true } });
  seen = [];
  stubForkRepo(seen);
  assert.equal((await post({ projectKey: betaKey, id, body: 'Did the thing.' })).status, 200);
  assert.equal(bodyArg(seen), 'Did the thing.\n\n---\nStarted by grace@example.com via worca');
  seen = [];
  stubForkRepo(seen);
  assert.equal((await post({ projectKey: betaKey, id })).status, 200);
  assert.equal(bodyArg(seen), 'Signed feature\n\n---\nStarted by grace@example.com via worca', 'no description: today\'s title + footer');
});

test('POST /api/pr refuses a non-string or oversized body with 400 before anything is pushed; the largest one fits the JSON limit', async () => {
  for (const bad of [42, true, { text: 'x' }, ['x'], 'x'.repeat(PR_BODY_MAX + 1)]) {
    const seen = [];
    stubForkRepo(seen);
    const r = await post({ projectKey: betaKey, id: betaId, body: bad });
    assert.equal(r.status, 400, JSON.stringify(bad).slice(0, 40));
    assert.match((await r.json()).error, /body/);
    assert.ok(!seen.some((c) => c[0] === 'git' && c[1] === 'push'), 'nothing pushed');
  }
  const seen = [];
  stubForkRepo(seen);
  // Multi-byte on purpose: ~120 KB of JSON, well inside the global express.json limit (8mb).
  const big = 'é'.repeat(PR_BODY_MAX);
  assert.equal((await post({ projectKey: betaKey, id: betaId, body: big })).status, 200);
  assert.equal(bodyArg(seen), big);
});

const postDescribe = (body, opts = {}) => fetch(`${base}/api/pr/describe`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), ...opts,
});

test('POST /api/pr/describe drafts the description from the run — no gh needed — and forwards the base branch', async () => {
  gitInfo.setRunner((cmd) => Promise.resolve(
    cmd === 'gh' ? { ok: false, stdout: '', stderr: 'not found', code: 127 }
                 : { ok: true, stdout: '', stderr: '', code: 0 }));
  const seen = [];
  prDesc.setRunClaude(async (o) => { seen.push(o); return { text: '```markdown\n## Summary\nDoes x.\n```' }; });
  const r = await postDescribe({ projectKey: betaKey, id: betaId, baseBranch: 'dev' });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, body: '## Summary\nDoes x.' });
  assert.equal(seen.length, 1);
  assert.match(seen[0].prompt, /My feature/);
  assert.match(seen[0].prompt, /## Target branch\ndev/);
  assert.deepEqual(seen[0].allowedTools, []);
  assert.ok(seen[0].signal, 'the call carries a signal, so a closed request can abort it');
  const byDir = await postDescribe({ projectDir: betaRepo, id: betaId });
  assert.equal(byDir.status, 200, 'the project dir resolves the same run');
  assert.equal(seen.length, 2);
  assert.doesNotMatch(seen[1].prompt, /## Target branch/, 'no baseBranch: none named');
});

test('POST /api/pr/describe: 400 without id or with a bad baseBranch, 404 for an unknown run — the model never runs', async () => {
  let calls = 0;
  prDesc.setRunClaude(async () => { calls++; return { text: 'x' }; });
  assert.equal((await postDescribe({ projectKey: betaKey })).status, 400);
  assert.equal((await postDescribe({ projectKey: betaKey, id: betaId, baseBranch: 'bad ref..' })).status, 400);
  assert.equal((await postDescribe({ projectKey: betaKey, id: 'deadbeef' })).status, 404);
  assert.equal((await postDescribe({ projectKey: 'Not A Key', id: betaId })).status, 404);
  assert.equal(calls, 0);
});

test('POST /api/pr/describe maps a signed-out CLI to 409 claude-signed-out, any other failure to 500', async () => {
  prDesc.setRunClaude(async () => { throw new Error('claude exited with code 1: Not logged in · Please run /login'); });
  let r = await postDescribe({ projectKey: betaKey, id: betaId });
  let j = await r.json();
  assert.equal(r.status, 409, JSON.stringify(j));
  assert.equal(j.code, 'claude-signed-out');
  prDesc.setRunClaude(async () => ({ text: '   ' }));
  r = await postDescribe({ projectKey: betaKey, id: betaId });
  j = await r.json();
  assert.equal(r.status, 500, JSON.stringify(j));
  assert.match(j.error, /empty description/);
});

test('POST /api/pr/describe: a request the client abandons aborts the model call', async () => {
  let aborted = false;
  const started = new Promise((resolve) => {
    prDesc.setRunClaude((o) => {
      resolve();
      return new Promise((_, reject) => o.signal.addEventListener('abort', () => {
        aborted = true;
        const e = new Error('aborted'); e.name = 'AbortError'; reject(e);
      }));
    });
  });
  const ac = new AbortController();
  const pending = postDescribe({ projectKey: betaKey, id: betaId }, { signal: ac.signal }).catch(() => null);
  await started;
  ac.abort();
  await pending;
  for (let i = 0; i < 200 && !aborted; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(aborted, true);
});

// ---------------------------------------------------------------------------
// Azure DevOps: a base remote on dev.azure.com goes to the REST provider (pr/azure.mjs),
// never to gh; the push gets the ADO PAT through the gated push-URL lookup (D7).
// ---------------------------------------------------------------------------
const AZ_PR = `${AZ}/pullrequest/31`;

test('POST /api/pr on an Azure origin: pushes with the ADO token, creates over REST, persists #31, reads mergeability', () => withEnv(WITH_ADO, async () => {
  await setPrRemotePrefs(betaRepo, {});
  const seen = [];
  const calls = [];
  stubAzureRepo(seen);
  stubAdo(calls);
  const r = await post({ projectKey: betaKey, id: betaId });
  const j = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j));
  assert.equal(j.url, AZ_PR);
  assert.equal(j.mergeable, 'MERGEABLE');
  const push = seen.find((s) => s.argv[1] === 'push');
  assert.ok(push, 'the branch was pushed');
  assert.equal(push.env.WORCA_ADO_GIT_TOKEN, 'pat');
  assert.equal(push.env.GH_TOKEN, undefined);
  assert.equal(push.env.WORCA_ADO_TOKEN, undefined);
  assert.ok(seen.some((s) => s.argv[1] === 'remote' && s.argv[2] === 'get-url'), 'the gated push-URL lookup ran');
  assert.deepEqual(seen.filter((s) => s.argv[0] === 'gh').map((s) => s.argv), [['gh', '--version']], 'gh never ran beyond --version');
  const create = calls.find((c) => c.method === 'POST');
  assert.equal(new URL(create.url).pathname, '/acme/Shop/_apis/git/repositories/api/pullrequests');
  assert.equal(create.body.sourceRefName, `refs/heads/${FEATURE}`);
  assert.equal(create.body.targetRefName, 'refs/heads/main');
  assert.equal('workItemRefs' in create.body, false, 'a prompt run links no work item');
  const pr = readPrState(betaId);
  assert.deepEqual({ number: pr.number, state: pr.state }, { number: 31, state: 'OPEN' });
  assert.equal(pr.url, AZ_PR);
}));

test('POST /api/pr on an Azure origin without a token -> 409 naming WORCA_ADO_TOKEN, nothing pushed', () => withEnv(NO_ADO, async () => {
  const seen = [];
  stubAzureRepo(seen);
  const r = await post({ projectKey: betaKey, id: betaId });
  assert.equal(r.status, 409);
  const j = await r.json();
  assert.match(j.error, /WORCA_ADO_TOKEN/);
  assert.equal(j.forge, 'azure');
  assert.ok(!seen.some((s) => s.argv[1] === 'push'), 'nothing was pushed');
}));

test('POST /api/pr Azure fork (push to another repo) -> 422 unsupported before anything is pushed', () => withEnv(WITH_ADO, async () => {
  const seen = [];
  const calls = [];
  const forkUrl = 'https://dev.azure.com/acme/Shop/_git/api-fork';
  stubAzureRepo(seen, { remotesV: `fork\t${forkUrl} (fetch)\nfork\t${forkUrl} (push)\n${AZ_REMOTES_V}` });
  stubAdo(calls);
  const r = await post({ projectKey: betaKey, id: betaId, pushRemote: 'fork', baseRemote: 'origin' });
  assert.equal(r.status, 422);
  const j = await r.json();
  assert.equal(j.kind, 'unsupported');
  assert.match(j.error, /forks\) are not supported yet — push to origin/);
  assert.ok(!seen.some((s) => s.argv[1] === 'push'), 'nothing was pushed');
  assert.equal(calls.length, 0, 'no REST call');
}));

test('POST /api/pr names the host in a create failure: Azure DevOps and GitHub', async () => {
  await withEnv(WITH_ADO, async () => {
    await setPrRemotePrefs(betaRepo, {});
    stubAzureRepo([]);
    stubAdo([], { create: () => adoJson(500, { message: 'boom' }) });
    const r = await post({ projectKey: betaKey, id: betaId });
    assert.equal(r.status, 500);
    assert.equal((await r.json()).error, 'Azure DevOps pull request failed: Azure DevOps 500: boom');
  });
  await withEnv(NO_ADO, async () => {
    gitInfo.setRunner((cmd, args) => Promise.resolve(
      cmd === 'gh' && args[0] === 'pr' && args[1] === 'create'
        ? { ok: false, stdout: '', stderr: 'no such base\n', code: 1 }
        : { ok: true, stdout: cmd === 'gh' ? 'gh 2.x' : '', stderr: '', code: 0 }));
    const r = await post({ projectKey: betaKey, id: betaId });
    assert.equal(r.status, 500);
    assert.equal((await r.json()).error, 'GitHub pull request failed: no such base');
  });
});

test('GET /api/pr/remotes names each remote\'s PR host and whether PRs can be opened there', async () => {
  const GL = 'https://gitlab.com/g/api.git';
  const remotesV = `${AZ_REMOTES_V}gl\t${GL} (fetch)\ngl\t${GL} (push)\n`;
  await withEnv(WITH_ADO, async () => {
    stubAzureRepo([], { remotesV });
    const j = await (await getRemotes({ projectKey: betaKey, id: betaId })).json();
    const [az, gl] = [j.remotes.find((x) => x.name === 'origin'), j.remotes.find((x) => x.name === 'gl')];
    assert.deepEqual([az.forge, az.prHost, az.prSupported, 'prReason' in az], ['azure', 'Azure DevOps', true, false]);
    assert.deepEqual([gl.forge, gl.prHost, gl.prSupported], [null, null, true], 'other hosts keep gh, but are not labelled GitHub');
  });
  await withEnv(NO_ADO, async () => {
    stubAzureRepo([], { remotesV });
    const j = await (await getRemotes({ projectKey: betaKey, id: betaId })).json();
    const az = j.remotes.find((x) => x.name === 'origin');
    assert.equal(az.prSupported, false);
    assert.match(az.prReason, /WORCA_ADO_TOKEN/);
  });
});

test('POST /api/pr/mergeable reads an Azure PR URL over REST', () => withEnv(WITH_ADO, async () => {
  persistPrState(betaId, { url: AZ_PR, number: 31, state: 'OPEN' });
  const seen = [];
  const calls = [];
  stubAzureRepo(seen);
  stubAdo(calls, { view: { pullRequestId: 31, status: 'active', mergeStatus: 'conflicts' } });
  const r = await postMergeable({ projectKey: betaKey, id: betaId });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).mergeable, 'CONFLICTING');
  assert.equal(new URL(calls[0].url).pathname, '/acme/Shop/_apis/git/pullrequests/31');
  assert.ok(!seen.some((s) => s.argv[0] === 'gh' && s.argv[1] === 'pr'), 'gh never ran');
}));

test('GET /api/history and /api/runs expose prHosts next to ghAvailable', () => withEnv(WITH_ADO, async () => {
  stubAzureRepo([]);
  const h = await (await fetch(`${base}/api/history`)).json();
  assert.deepEqual(h.prHosts, { github: true, azure: true });
  assert.equal(h.ghAvailable, true);
  const r = await (await fetch(`${base}/api/runs?projectDir=${encodeURIComponent(betaRepo)}`)).json();
  assert.deepEqual(r.prHosts, { github: true, azure: true });
}));

test('POST /api/pr links the Azure Boards work item a run came from', () => withEnv(WITH_ADO, async () => {
  const { id, dir } = await createPipeline(betaRepo, { prompt: 'p', title: 'Board item',
    sourceMeta: { plugin: 'azure-boards-source', sourceId: 'azure-boards', taskId: 'acme/Shop#77' } });
  await writeState(dir, { projectKey: betaKey, id, title: 'Board item', status: 'done',
    branch: { source: 'main', feature: 'worca-cc/board-77', branchKept: true } });
  const calls = [];
  stubAzureRepo([]);
  stubAdo(calls);
  const r = await post({ projectKey: betaKey, id });
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  assert.deepEqual(calls.find((c) => c.method === 'POST').body.workItemRefs, [{ id: '77' }]);
}));

test('POST /api/pr/describe drafts for the PR host the modal names', async () => {
  const seen = [];
  prDesc.setRunClaude(async (o) => { seen.push(o); return { text: 'Does x.' }; });
  assert.equal((await postDescribe({ projectKey: betaKey, id: betaId, forge: 'azure' })).status, 200);
  assert.equal((await postDescribe({ projectKey: betaKey, id: betaId, forge: 'gitlab' })).status, 200);
  assert.equal((await postDescribe({ projectKey: betaKey, id: betaId })).status, 200);
  assert.match(seen[0].systemPrompt, /Azure DevOps/);
  assert.doesNotMatch(seen[1].systemPrompt, /Azure DevOps/, 'anything else is GitHub');
  assert.doesNotMatch(seen[2].systemPrompt, /Azure DevOps/);
});


// ---------------------------------------------------------------------------
// Draft PRs and the source issue's closing line.
// ---------------------------------------------------------------------------
const ISSUE_URL = 'https://github.com/up/repo/issues/42';
// An issue-sourced run (the sourceMeta shape src/core/sources.mjs builds for github-source:
// taskId is the connector's 'owner/repo#N' id), started by grace so the footer shows.
// Same production-writer pattern as the existing attribution test.
async function seedIssueRun({ url = ISSUE_URL, feature = 'worca-cc/issue-run' } = {}) {
  const { id, dir } = await createPipeline(betaRepo, { prompt: 'p', title: 'Issue feature', startedBy: 'grace@example.com',
    sourceMeta: { plugin: 'github-source', sourceId: 'github-issues', taskId: 'up/repo#42', url, title: 'Bug' } });
  await writeState(dir, { projectKey: betaKey, id, title: 'Issue feature', status: 'done',
    branch: { source: 'main', feature, branchKept: true } });
  return id;
}
const prAudit = (id) => getDb().prepare("SELECT text FROM pipeline_events WHERE pipeline_id = ? AND text LIKE 'Pull request %' ORDER BY id").all(id).map((r) => r.text);
const FORK = { pushRemote: 'origin', baseRemote: 'upstream' };   // base repo = up/repo

test('POST /api/pr refuses a non-boolean draft with 400 before anything is pushed', async () => {
  for (const bad of ['yes', 'true', 1, 0, null, {}, []]) {
    const seen = [];
    stubForkRepo(seen);
    const r = await post({ projectKey: betaKey, id: betaId, draft: bad });
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.deepEqual(await r.json(), { error: 'draft must be a boolean' });
    assert.ok(!seen.some((c) => c[1] === 'push'), 'nothing was pushed');
  }
});

test('POST /api/pr draft: true reaches gh pr create --draft, says (draft) in the audit and the response', async () => {
  const id = await seedIssueRun({ feature: 'worca-cc/draft-run' });
  const seen = [];
  stubForkRepo(seen);
  const r = await post({ projectKey: betaKey, id, draft: true, ...FORK });
  assert.equal(r.status, 200, await r.clone().text());
  const j = await r.json();
  assert.equal(j.draft, true);
  assert.equal(seen.find((c) => c[2] === 'create').at(-1), '--draft');
  assert.deepEqual(prAudit(id), ['Pull request opened (draft): https://github.com/up/repo/pull/7']);
});

test('POST /api/pr draft: false or absent -> no --draft, draft:false, the audit line unchanged', async () => {
  for (const extra of [{}, { draft: false }]) {
    const id = await seedIssueRun({ feature: `worca-cc/nodraft-${Object.keys(extra).length}` });
    const seen = [];
    stubForkRepo(seen);
    const j = await (await post({ projectKey: betaKey, id, ...FORK, ...extra })).json();
    assert.equal(j.draft, false);
    assert.ok(!seen.find((c) => c[2] === 'create').includes('--draft'));
    assert.deepEqual(prAudit(id), ['Pull request opened: https://github.com/up/repo/pull/7']);
  }
});

test('POST /api/pr draft: true on an existing PR changes nothing: draft:false, "linked" audit (D6)', async () => {
  const id = await seedIssueRun({ feature: 'worca-cc/existing-run' });
  const seen = [];
  gitInfo.setRunner((cmd, args) => {
    seen.push([cmd, ...args]);
    if (cmd === 'git' && args[0] === 'remote') return Promise.resolve({ ok: true, stdout: REMOTES_V, stderr: '', code: 0 });
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'create')
      return Promise.resolve({ ok: false, stdout: '', stderr: 'a pull request already exists:\nhttps://github.com/up/repo/pull/3', code: 1 });
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'view') return Promise.resolve({ ok: true, stdout: 'https://github.com/up/repo/pull/3\n', stderr: '', code: 0 });
    return Promise.resolve({ ok: true, stdout: 'gh 2.x', stderr: '', code: 0 });
  });
  const j = await (await post({ projectKey: betaKey, id, draft: true, ...FORK })).json();
  assert.equal(j.existed, true);
  assert.equal(j.draft, false);
  assert.deepEqual(prAudit(id), ['Pull request linked: https://github.com/up/repo/pull/3']);
});

test('POST /api/pr body order: description -> Closes line -> attribution footer', async () => {
  const id = await seedIssueRun({ feature: 'worca-cc/order-run' });
  let seen = [];
  stubForkRepo(seen);
  assert.equal((await post({ projectKey: betaKey, id, body: 'Did the thing.', ...FORK })).status, 200);
  assert.equal(bodyArg(seen), 'Did the thing.\n\nCloses #42\n\n---\nStarted by grace@example.com via worca');
  seen = [];
  stubForkRepo(seen);
  assert.equal((await post({ projectKey: betaKey, id, ...FORK })).status, 200);
  assert.equal(bodyArg(seen), 'Issue feature\n\nCloses #42\n\n---\nStarted by grace@example.com via worca', 'no description: title, then the line');
  seen = [];
  stubForkRepo(seen);
  assert.equal((await post({ projectKey: betaKey, id, body: 'x', pushRemote: 'origin', baseRemote: 'origin' })).status, 200);
  assert.equal(bodyArg(seen), 'x\n\nCloses up/repo#42\n\n---\nStarted by grace@example.com via worca', 'a PR into me/repo names the repo');
});

test('POST /api/pr adds no Closes line for a prompt run, a PR-URL source, or a description that already closes the issue', async () => {
  let seen = [];
  stubForkRepo(seen);
  assert.equal((await post({ projectKey: betaKey, id: betaId, body: 'Did it.', ...FORK })).status, 200);
  assert.equal(bodyArg(seen), 'Did it.', 'prompt-sourced: byte-identical to today');

  const prSourced = await seedIssueRun({ url: 'https://github.com/up/repo/pull/42', feature: 'worca-cc/prsrc-run' });
  seen = [];
  stubForkRepo(seen);
  assert.equal((await post({ projectKey: betaKey, id: prSourced, body: 'Did it.', ...FORK })).status, 200);
  assert.equal(bodyArg(seen), 'Did it.\n\n---\nStarted by grace@example.com via worca');

  const id = await seedIssueRun({ feature: 'worca-cc/fixes-run' });
  seen = [];
  stubForkRepo(seen);
  assert.equal((await post({ projectKey: betaKey, id, body: 'Fixes #42', ...FORK })).status, 200);
  assert.equal(bodyArg(seen), 'Fixes #42\n\n---\nStarted by grace@example.com via worca');
});

test('GET /api/pr/remotes carries the run\'s source issue (null for a prompt run)', async () => {
  stubForkRepo([]);
  stubSyncRepo([]);
  const id = await seedIssueRun({ feature: 'worca-cc/remotes-issue-run' });
  assert.deepEqual((await (await getRemotes({ projectKey: betaKey, id })).json()).issue, { slug: 'up/repo', number: 42 });
  assert.equal((await (await getRemotes({ projectKey: betaKey, id: betaId })).json()).issue, null);
  stubForkRepo([], { remotesOk: false });
  const failed = await getRemotes({ projectKey: betaKey, id });
  assert.equal(failed.status, 500);
  assert.deepEqual((await failed.json()).issue, { slug: 'up/repo', number: 42 }, 'still offered when git fails, like chain');
});

test('POST /api/pr on an Azure origin: draft reaches the REST create as isDraft; a GitHub issue source adds no Closes line', () => withEnv(WITH_ADO, async () => {
  await setPrRemotePrefs(betaRepo, {});
  const id = await seedIssueRun({ feature: 'worca-cc/azure-draft-run' });
  const calls = [];
  stubAzureRepo([]);
  stubAdo(calls);
  const r = await post({ projectKey: betaKey, id, draft: true, body: 'Did it.' });
  const j = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j));
  assert.equal(j.draft, true);
  const create = calls.find((c) => c.method === 'POST');
  assert.equal(create.body.isDraft, true);
  assert.doesNotMatch(create.body.description, /Closes/);
  assert.equal((await (await getRemotes({ projectKey: betaKey, id })).json()).issue, null, 'no "Will close" line for an Azure base');
}));

test('POST /api/pr on an Azure origin with watch:true watches the new Azure DevOps PR', () => withEnv(WITH_ADO, async () => {
  await setPrRemotePrefs(betaRepo, {});
  const id = await seedIssueRun({ feature: 'worca-cc/azure-watch-run' });
  stubAzureRepo([]);
  stubAdo([]);
  const r = await post({ projectKey: betaKey, id, watch: true });
  const j = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j));
  assert.equal(j.watching, true);
  assert.equal(getWatch(j.url).pipelineId, id);
}));
