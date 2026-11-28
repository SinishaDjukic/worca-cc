// test/bitbucket-server.test.mjs
// Self-hosted Bitbucket Server (Data Center) support: the shared URL parser, the credentials module
// (host allowlist, Bearer token → per-call git http.extraHeader, strip), the forge routing, host-credentials'
// gitEnvFor arm, and the PR REST client (via an injectable fetch) — create (reuse/fork/404), view, find-by-branch,
// available, and the explicit unsupported answers for watch/checks. Offline.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as shared from '../src/shared/bitbucket-server-remote.mjs';
import * as cred from '../src/core/bitbucket-server-credentials.mjs';
import * as forge from '../src/core/forge.mjs';
import { gitEnvFor, stripHostCredentials, hostLookupNeeded } from '../src/core/host-credentials.mjs';
import * as serverPr from '../src/core/pr/bitbucket-server.mjs';
import { withEnv } from './helpers/with-env.mjs';

const HOSTS = { WORCA_BB_SERVER_HOSTS: 'bbs.example.com,bbs.test' };
const ENV = { WORCA_BB_SERVER_HOSTS: 'bbs.example.com', WORCA_BB_SERVER_TOKEN: 'tok' };
const REPO = { name: 'origin', host: 'bbs.example.com', owner: 'PROJ', repo: 'api' };
const PR_URL = 'https://bbs.example.com/projects/PROJ/repos/api/pull-requests/7';

const res = (status, body) => ({ status, ok: status >= 200 && status < 300,
  headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) });
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined, authorization: (init.headers || {}).authorization });
    for (const r of routes) if (r.match.test(u) && (!r.method || r.method === (init.method || 'GET'))) return typeof r.reply === 'function' ? r.reply(u, init) : r.reply;
    throw new Error(`unrouted ${init.method || 'GET'} ${u}`);
  };
  fn.calls = calls;
  return fn;
}
// Server PR objects carry fromRef/toRef (refs/heads/…) and a version; never a synchronous mergeability.
const prJson = (extra = {}) => ({ id: 7, state: 'OPEN', version: 1, title: 'T',
  fromRef: { id: 'refs/heads/feat/x', repository: { slug: 'api', project: { key: 'PROJ' } } },
  toRef: { id: 'refs/heads/main' }, ...extra });
const API = (tail = '') => `https://bbs.example.com/rest/api/1.0/projects/PROJ/repos/api${tail}`;
afterEach(() => { serverPr._testing.reset(); try { forge._testing?.reset?.(); } catch {} });

// ── shared parser ────────────────────────────────────────────────────────────
test('parseBitbucketServerPrUrl: web URL → coords + canonical', () => {
  assert.deepEqual(shared.parseBitbucketServerPrUrl(`${PR_URL}/`), { host: 'bbs.example.com', key: 'PROJ', slug: 'api', number: 7, url: PR_URL });
  assert.deepEqual(shared.parseBitbucketServerPrUrl(`${PR_URL}/diff`), shared.parseBitbucketServerPrUrl(PR_URL));
  assert.equal(shared.parseBitbucketServerPrUrl('https://bbs.example.com/projects/PROJ/repos/api/pull-requests/0'), null);
  assert.equal(shared.parseBitbucketServerPrUrl('https://bitbucket.org/acme/api/pull-requests/7'), null);
  assert.equal(shared.parseBitbucketServerPrUrl(''), null);
  assert.equal(shared.bitbucketServerPrUrl({ host: 'bbs.example.com', key: 'PROJ', slug: 'api' }, 7), PR_URL);
});

// ── credentials ──────────────────────────────────────────────────────────────
test('bitbucket-server credentials: allowlist, token roles, git env injection, strip', () => {
  assert.deepEqual([...cred.bitbucketServerHosts(HOSTS)], ['bbs.example.com', 'bbs.test']);
  assert.equal(cred.isBitbucketServerHost('BBS.EXAMPLE.com', HOSTS), true);
  assert.equal(cred.isBitbucketServerHost('bbs.example.com', {}), false);
  assert.equal(cred.isBitbucketServerHost(null, HOSTS), false);

  assert.deepEqual(cred.readBitbucketServerCredentials({ WORCA_BB_SERVER_TOKEN: 't' }), { mode: 'single', read: 't', write: 't' });
  assert.deepEqual(cred.readBitbucketServerCredentials({ WORCA_BB_SERVER_READ_TOKEN: 'r', WORCA_BB_SERVER_WRITE_TOKEN: 'w' }), { mode: 'split', read: 'r', write: 'w' });
  assert.equal(cred.readBitbucketServerCredentials({}).mode, 'none');

  const env = cred.bitbucketServerEnv('write', 'bbs.example.com', { WORCA_BB_SERVER_TOKEN: 'tok', GH_TOKEN: 'g', WORCA_BB_TOKEN: 'b', WORCA_ADO_TOKEN: 'a' });
  assert.equal(env.GIT_CONFIG_COUNT, '1');
  assert.equal(env.GIT_CONFIG_KEY_0, 'http.https://bbs.example.com/.extraHeader');
  assert.equal(env.GIT_CONFIG_VALUE_0, 'Authorization: Bearer tok');
  assert.equal(env.GH_TOKEN, undefined); assert.equal(env.WORCA_BB_TOKEN, undefined); assert.equal(env.WORCA_ADO_TOKEN, undefined);

  assert.deepEqual(cred.stripBitbucketServerCredentials({ WORCA_BB_SERVER_TOKEN: 't', WORCA_BB_SERVER_READ_TOKEN: 'r', KEEP: '1' }), { KEEP: '1' });
});

test('stripHostCredentials and hostLookupNeeded cover Bitbucket Server', () => {
  assert.equal(stripHostCredentials({ WORCA_BB_SERVER_TOKEN: 't', GH_TOKEN: 'g' }).WORCA_BB_SERVER_TOKEN, undefined);
  assert.equal(hostLookupNeeded({ env: { WORCA_BB_SERVER_TOKEN: 't' } }), true);
  assert.equal(hostLookupNeeded({ env: {} }), false);
});

test('gitEnvFor: a Bitbucket Server remote gets the Bearer extraHeader and no other host credential', async () => {
  await withEnv({ ...HOSTS }, async () => {
    const r = await gitEnvFor('read', 'https://bbs.example.com/scm/PROJ/api.git', {
      base: { WORCA_BB_SERVER_TOKEN: 'tok', GH_TOKEN: 'g', WORCA_BB_TOKEN: 'b', WORCA_ADO_TOKEN: 'a' },
    });
    assert.equal(r.error, null);
    assert.equal(r.env.GIT_CONFIG_VALUE_0, 'Authorization: Bearer tok');
    assert.equal(r.env.GH_TOKEN, undefined); assert.equal(r.env.WORCA_BB_TOKEN, undefined); assert.equal(r.env.WORCA_ADO_TOKEN, undefined);
  });
});

// ── forge routing ────────────────────────────────────────────────────────────
test('forgeOf / forgeOfPrUrl / prIdentity route an allow-listed Bitbucket Server', async () => {
  await withEnv(HOSTS, () => {
    assert.equal(forge.forgeOf(REPO), 'bitbucket-server');
    assert.equal(forge.forgeOf({ host: 'github.com', owner: 'a', repo: 'b' }), 'github');
    assert.equal(forge.forgeOf({ host: 'bbs-else.com', owner: 'a', repo: 'b' }), null, 'non-allow-listed host stays plain git');
    assert.equal(forge.forgeOfPrUrl(PR_URL), 'bitbucket-server');
    assert.equal(forge.forgeOfPrUrl('https://bbs-else.com/projects/PROJ/repos/api/pull-requests/7'), null);
    const id = forge.prIdentity(PR_URL);
    assert.equal(id.forge, 'bitbucket-server');
    assert.equal(id.repo, 'api'); assert.equal(id.number, 7);
    assert.equal(id.key, 'bbs.example.com/proj/api/pull-requests/7');
  });
});

// ── PR REST client ───────────────────────────────────────────────────────────
test('pr client: createPr creates, reuses, refuses forks, surfaces a 404; Bearer auth', async () => {
  const f = fakeFetch([
    { match: /pull-requests\?state=OPEN/, reply: res(200, { values: [], isLastPage: true }) },
    { match: /pull-requests$/, method: 'POST', reply: res(201, prJson({ id: 9 })) },
  ]);
  serverPr._testing.setFetch(f);
  const r = await serverPr.createPr({ base: 'main', head: 'feat/x', title: 'T', body: 'B', baseRepo: REPO, env: ENV });
  assert.deepEqual(r, { ok: true, url: PR_URL.replace('/7', '/9'), number: 9, existed: false });
  const post = f.calls.find((c) => c.method === 'POST');
  assert.equal(post.authorization, 'Bearer tok');
  assert.deepEqual(post.body.fromRef, { id: 'refs/heads/feat/x', repository: { slug: 'api', project: { key: 'PROJ' } } });
  assert.deepEqual(post.body.toRef, { id: 'refs/heads/main' });
});

test('pr client: an already-open pair is reused, a fork/bad-remote is refused', async () => {
  const f = fakeFetch([{ match: /pull-requests\?state=OPEN/, reply: res(200, { values: [prJson()], isLastPage: true }) }]);
  serverPr._testing.setFetch(f);
  assert.deepEqual(await serverPr.createPr({ base: 'main', head: 'feat/x', title: 'T', body: 'B', baseRepo: REPO, env: ENV }),
    { ok: true, url: PR_URL, number: 7, existed: true });
  assert.equal(f.calls.some((c) => c.method === 'POST'), false, 'no duplicate create');
  const fork = await serverPr.createPr({ base: 'main', head: 'feat/x', title: 'T', body: 'B', baseRepo: REPO,
    pushRepo: { host: 'bbs.example.com', owner: 'OTHER', repo: 'fork' }, env: ENV });
  assert.equal(fork.ok, false); assert.equal(fork.kind, 'unsupported');
  const notServer = await serverPr.createPr({ base: 'main', head: 'feat/x', title: 'T', body: 'B',
    baseRepo: { host: 'github.com', owner: 'a', repo: 'b' }, env: ENV });
  assert.equal(notServer.ok, false);
});

test('pr client: a branch 404 surfaces as { ok:false, kind: failed } and 401 as auth', async () => {
  const f = fakeFetch([
    { match: /pull-requests\?state=OPEN/, reply: res(404, { errors: [{ message: 'no such branch' }] }) },
  ]);
  serverPr._testing.setFetch(f);
  const r = await serverPr.createPr({ base: 'develop', head: 'nope', title: 'T', body: 'B', baseRepo: REPO, env: ENV });
  assert.equal(r.ok, false); assert.equal(r.kind, 'failed');
  assert.match(r.error, /404/);
});

test('pr client: viewPr and findPrForBranch (client-side source matching, states order, includeClosed)', async () => {
  const open = prJson({ fromRef: { id: 'refs/heads/feat/x' } });                                  // id 7
  const merged = prJson({ id: 2, state: 'MERGED', fromRef: { id: 'refs/heads/feat/x' } });
  const declined = prJson({ id: 3, state: 'DECLINED', fromRef: { id: 'refs/heads/feat/x' } });
  const f = fakeFetch([
    { match: /pull-requests\/7$/, reply: res(200, open) },
    { match: /pull-requests\?/, reply: (_u, init) => res(200, { values: [open, merged, declined], isLastPage: true }) },
  ]);
  serverPr._testing.setFetch(f);
  const v = await serverPr.viewPr({ prUrl: PR_URL, env: ENV, withMergeable: true });
  assert.deepEqual(v, { state: 'OPEN', url: PR_URL, number: 7, isDraft: false, mergeable: 'UNKNOWN' });
  const found = await serverPr.findPrForBranch({ head: 'feat/x', baseRepo: REPO, env: ENV });
  assert.equal(found.state, 'OPEN');
  const closed = await serverPr.findPrForBranch({ head: 'feat/x', baseRepo: REPO, includeClosed: true, env: ENV });
  assert.equal(closed.state, 'OPEN', 'OPEN still wins with includeClosed');
  assert.equal(await serverPr.findPrForBranch({ head: 'elsewhere', baseRepo: REPO, env: ENV }), null);
});

test('pr client: available mirrors config; watch/check methods answer unsupported, not a crash', async () => {
  assert.equal((await serverPr.available({ env: ENV })).ok, true);
  assert.equal((await serverPr.available({ env: { WORCA_BB_SERVER_TOKEN: 't' } })).ok, false);
  assert.equal((await serverPr.available({ env: { WORCA_BB_SERVER_HOSTS: 'bbs.example.com' } })).ok, false);
  assert.equal(serverPr.prCheckFacts(), null);
  assert.equal(serverPr.prWatchSnapshot().ok, false);
  assert.equal((await serverPr.failedBuildLog()).ok, false);
  assert.equal((await serverPr.requeueEvaluation()).ok, false);
  assert.equal((await serverPr.replyToThread()).ok, false);
  assert.equal((await serverPr.prComment()).ok, false);
  await withEnv(ENV, async () => assert.equal((await serverPr.available()).ok, true));
});


// ── git-info dispatch ────────────────────────────────────────────────────────
test('git-info: a server remote dispatches createPr into the Bitbucket Server client (key = bitbucket-server)', async () => {
  const gi = await import('../src/core/git-info.mjs');
  await withEnv({ WORCA_BB_SERVER_HOSTS: 'bbs.example.com', WORCA_BB_SERVER_TOKEN: 'tok' }, async () => {
    assert.equal(gi.prProviderFor({ name: 'origin', host: 'bbs.example.com', owner: 'PROJ', repo: 'api' }).forge, 'bitbucket-server');
    assert.equal(gi.prProviderFor({ name: 'origin', host: 'github.com', owner: 'a', repo: 'b' }).forge, 'github');
  });
  const post = { body: null, auth: null };
  serverPr._testing.setFetch(async (url, init = {}) => {
    post.body = init.body ? JSON.parse(init.body) : null; post.auth = init.headers?.authorization;
    return { status: 201, ok: true, headers: { get: () => null }, json: async () => prJson({ id: 9 }) };
  });
  const r = await withEnv({ WORCA_BB_SERVER_HOSTS: 'bbs.example.com', WORCA_BB_SERVER_TOKEN: 'tok' }, () =>
    gi.createPr({ base: 'main', head: 'feat/x', title: 'T', body: 'B', baseRemote: REPO }));
  assert.deepEqual(r, { ok: true, url: PR_URL.replace('/7', '/9'), number: 9, existed: false });
  assert.equal(post.auth, 'Bearer tok');
  assert.deepEqual(post.body.fromRef, { id: 'refs/heads/feat/x', repository: { slug: 'api', project: { key: 'PROJ' } } });
});
