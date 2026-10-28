// test/pr-bitbucket.test.mjs
// src/core/pr/bitbucket.mjs: Bitbucket Cloud pull requests over REST 2.0 through an injectable fetch (a fake
// api.bitbucket.org) — create (existing-PR recovery, fork refusal, auth kinds), view, find-by-branch, ready, decline,
// the metrics listing, and the rule that the token never leaves api.bitbucket.org.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as bb from '../src/core/pr/bitbucket.mjs';
import { checkRows } from './helpers/rows.mjs';

const ENV = { WORCA_BB_READ_TOKEN: 'read-tok', WORCA_BB_WRITE_TOKEN: 'write-tok' };
const REPO = { name: 'origin', host: 'bitbucket.org', owner: 'acme', repo: 'api', forge: 'bitbucket' };
const API = 'https://api.bitbucket.org/2.0/repositories/acme/api';
const PR = 'https://bitbucket.org/acme/api/pull-requests/12';
const res = (status, body, { location = null, text = null } = {}) => ({ status, ok: status >= 200 && status < 300,
  headers: { get: (k) => (k.toLowerCase() === 'location' ? location : null) },
  json: async () => body, text: async () => (text ?? JSON.stringify(body)) });
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers || {} });
    for (const r of routes) if (r.match.test(u) && (!r.method || r.method === (init.method || 'GET'))) return typeof r.reply === 'function' ? r.reply(u, init) : r.reply;
    throw new Error(`unrouted ${init.method || 'GET'} ${u}`);
  };
  fn.calls = calls;
  return fn;
}
const src = (name, full = 'acme/api') => ({ branch: { name }, repository: { full_name: full } });
// The PR object's commits are abbreviated (12 hex digits), as Bitbucket answers them.
const SRC = 'a1b2c3d4e5f6'; const DST = '0f9e8d7c6b5a';
const prJson = (extra = {}) => ({ id: 12, state: 'OPEN', draft: false, title: 'T', source: { ...src('feat/x'), commit: { hash: SRC } },
  destination: { branch: { name: 'main' }, commit: { hash: DST } }, ...extra });
const PR_CONFLICTS = /\/pullrequests\/12\/conflicts\?/;
afterEach(() => bb._testing.reset());

test('Bitbucket PR provider', async () => {
  await checkRows([
    { name: 'create: no open PR, POST with branches and draft; canonical URL; write token as Bearer', run: async () => {
      const f = fakeFetch([
        { match: /\/pullrequests\?state=OPEN&/, reply: res(200, { values: [] }) },
        { match: /\/pullrequests$/, method: 'POST', reply: res(201, { id: 7 }) },
      ]);
      bb._testing.setFetch(f);
      const r = await bb.createPr({ base: 'main', head: 'feat/x', title: 'T', body: 'B', baseRepo: REPO, pushRepo: REPO, draft: true, env: ENV });
      assert.deepEqual(r, { ok: true, url: 'https://bitbucket.org/acme/api/pull-requests/7', number: 7, existed: false });
      const [look, post] = f.calls;
      assert.equal(look.headers.authorization, 'Bearer read-tok');
      assert.match(decodeURIComponent(look.url), /q=source\.branch\.name="feat\/x" AND destination\.branch\.name="main"$/);
      assert.equal(post.url, `${API}/pullrequests`);
      assert.deepEqual(post.body, { title: 'T', description: 'B', source: { branch: { name: 'feat/x' } }, destination: { branch: { name: 'main' } }, draft: true });
      assert.equal(post.headers.authorization, 'Bearer write-tok');
    } },
    { name: 'create: an open PR from the same repo is reused (existed); a fork\'s same-named branch is not', run: async () => {
      const f = fakeFetch([{ match: /\/pullrequests\?state=OPEN&/, reply: res(200, { values: [
        { id: 6, state: 'OPEN', source: src('feat/x', 'someone/api') }, { id: 5, state: 'OPEN', source: src('feat/x') }] }) }]);
      bb._testing.setFetch(f);
      const r = await bb.createPr({ base: 'main', head: 'feat/x', title: 'T', baseRepo: REPO, env: ENV });
      assert.deepEqual(r, { ok: true, url: 'https://bitbucket.org/acme/api/pull-requests/5', number: 5, existed: true });
      assert.equal(f.calls.length, 1, 'no POST');
    } },
    { name: 'create: a 400 after a racing create recovers the open PR', run: async () => {
      let lists = 0;
      bb._testing.setFetch(fakeFetch([
        { match: /\/pullrequests\?state=OPEN&/, reply: () => res(200, { values: lists++ ? [{ id: 9, state: 'OPEN', source: src('h') }] : [] }) },
        { match: /\/pullrequests$/, method: 'POST', reply: res(400, { error: { message: 'There are no changes to be pulled' } }) },
      ]));
      const r = await bb.createPr({ base: 'm', head: 'h', title: 'T', baseRepo: REPO, env: ENV });
      assert.deepEqual(r, { ok: true, url: 'https://bitbucket.org/acme/api/pull-requests/9', number: 9, existed: true });
    } },
    { name: 'create: 401 → auth; no token → auth without a request; 500 → failed with the message', run: async () => {
      bb._testing.setFetch(fakeFetch([{ match: /./, reply: res(401, null) }]));
      assert.equal((await bb.createPr({ base: 'm', head: 'h', title: 'T', baseRepo: REPO, env: ENV })).kind, 'auth');
      const none = fakeFetch([]);
      bb._testing.setFetch(none);
      const r = await bb.createPr({ base: 'm', head: 'h', title: 'T', baseRepo: REPO, env: {} });
      assert.equal(r.kind, 'auth');
      assert.match(r.error, /WORCA_BB_TOKEN/);
      assert.equal(none.calls.length, 0);
      bb._testing.setFetch(fakeFetch([{ match: /state=OPEN/, reply: res(200, { values: [] }) }, { match: /./, reply: res(500, { error: { message: 'boom' } }) }]));
      assert.deepEqual(await bb.createPr({ base: 'm', head: 'h', title: 'T', baseRepo: REPO, env: ENV }), { ok: false, kind: 'failed', error: 'Bitbucket 500: boom' });
    } },
    { name: 'create: cross-repo refused as unsupported, no request', run: async () => {
      const f = fakeFetch([]);
      bb._testing.setFetch(f);
      const r = await bb.createPr({ base: 'm', head: 'h', title: 'T', baseRepo: REPO, pushRepo: { ...REPO, name: 'fork', owner: 'me' }, env: ENV });
      assert.equal(r.kind, 'unsupported');
      assert.match(r.error, /forks\) are not supported yet — push to origin/);
      assert.equal(f.calls.length, 0);
    } },
    { name: 'view: states map; withMergeable reads the PR\'s file conflicts (any entry → CONFLICTING), once per commit pair', run: async () => {
      const f = fakeFetch([
        { match: /\/pullrequests\/12$/, reply: res(200, prJson({ draft: true })) },
        { match: PR_CONFLICTS, reply: res(200, { values: [{ path: 'CHANGELOG.md', scenario: 'content', message: 'File modified in both source and destination' }] }) },
      ]);
      bb._testing.setFetch(f);
      assert.deepEqual(await bb.viewPr({ prUrl: PR, env: ENV }), { state: 'OPEN', url: PR, number: 12, isDraft: true, mergeable: 'UNKNOWN' });
      assert.equal((await bb.viewPr({ prUrl: PR, withMergeable: true, env: ENV })).mergeable, 'CONFLICTING');
      assert.equal((await bb.viewPr({ prUrl: PR, withMergeable: true, env: ENV })).mergeable, 'CONFLICTING');
      assert.equal(f.calls.filter((c) => PR_CONFLICTS.test(c.url)).length, 1, 'the verdict of a commit pair is read once');
      const noCommit = fakeFetch([
        { match: /\/pullrequests\/12$/, reply: res(200, prJson({ destination: { branch: { name: 'main' } } })) },
        { match: PR_CONFLICTS, reply: res(200, { values: [] }) }]);
      bb._testing.setFetch(noCommit);
      assert.equal((await bb.viewPr({ prUrl: PR, withMergeable: true, env: ENV })).mergeable, 'UNKNOWN');
      assert.equal(noCommit.calls.length, 1, 'no destination commit: no conflicts asked');
      bb._testing.setFetch(fakeFetch([{ match: /\/pullrequests\/12$/, reply: res(200, prJson({ state: 'DECLINED' })) }]));
      assert.equal((await bb.viewPr({ prUrl: PR, withMergeable: true, env: ENV })).state, 'CLOSED');
      assert.equal(await bb.viewPr({ prUrl: 'https://github.com/o/r/pull/1', env: ENV }), null);
    } },
    { name: 'find: all states asked; OPEN > MERGED; CLOSED only with includeClosed', run: async () => {
      const f = fakeFetch([{ match: /\/pullrequests\?state=OPEN&state=MERGED/, reply: res(200, { values: [
        { id: 3, state: 'DECLINED', source: src('h') }, { id: 2, state: 'MERGED', source: src('h') }] }) }]);
      bb._testing.setFetch(f);
      assert.equal((await bb.findPrForBranch({ head: 'h', baseRepo: REPO, env: ENV })).number, 2);
      bb._testing.setFetch(fakeFetch([{ match: /./, reply: res(200, { values: [{ id: 3, state: 'SUPERSEDED', source: src('h') }] }) }]));
      assert.equal(await bb.findPrForBranch({ head: 'h', baseRepo: REPO, env: ENV }), null);
      assert.equal((await bb.findPrForBranch({ head: 'h', baseRepo: REPO, includeClosed: true, env: ENV })).state, 'CLOSED');
    } },
    { name: 'find: a fork\'s open PR from a same-named branch is not ours; the own MERGED PR wins, or none', run: async () => {
      const fork = { id: 8, state: 'OPEN', source: src('worca/x', 'jdoe/api') };
      bb._testing.setFetch(fakeFetch([{ match: /\/pullrequests\?/, reply: res(200, { values: [fork, { id: 4, state: 'MERGED', source: src('worca/x') }] }) }]));
      const hit = await bb.findPrForBranch({ head: 'worca/x', baseRepo: REPO, env: ENV });
      assert.deepEqual([hit.number, hit.state], [4, 'MERGED']);
      bb._testing.setFetch(fakeFetch([{ match: /\/pullrequests\?/, reply: res(200, { values: [fork] }) }]));
      assert.equal(await bb.findPrForBranch({ head: 'worca/x', baseRepo: REPO, env: ENV }), null);
    } },
    { name: 'find: a quote or backslash in the branch name is escaped in the BBQL literal', run: async () => {
      const f = fakeFetch([{ match: /\/pullrequests\?/, reply: res(200, { values: [] }) }]);
      bb._testing.setFetch(f);
      assert.equal(await bb.findPrForBranch({ head: 'a"b\\c', baseRepo: REPO, env: ENV }), null);
      const q = new URL(f.calls[0].url).searchParams.get('q');
      assert.equal(q, 'source.branch.name="a\\"b\\\\c"');
    } },
    { name: 'ready: PUT title, description and reviewers as read + draft:false; decline after the comment', run: async () => {
      const f = fakeFetch([
        { match: /\/pullrequests\/12$/, method: 'GET', reply: res(200, prJson({ draft: true, description: 'D', reviewers: [{ uuid: '{r}', display_name: 'R' }] })) },
        { match: /\/pullrequests\/12$/, method: 'PUT', reply: res(200, {}) },
        { match: /\/comments$/, method: 'POST', reply: res(201, { id: 1 }) },
        { match: /\/decline$/, method: 'POST', reply: res(200, {}) },
      ]);
      bb._testing.setFetch(f);
      assert.deepEqual(await bb.markReady({ prUrl: PR, env: ENV }), { ok: true });
      assert.deepEqual(f.calls.find((c) => c.method === 'PUT').body, { title: 'T', description: 'D', reviewers: [{ uuid: '{r}' }], draft: false });
      assert.deepEqual(await bb.closePr({ prUrl: PR, comment: 'superseded', env: ENV }), { ok: true });
      assert.deepEqual(f.calls.filter((c) => c.method === 'POST').map((c) => c.url.split('/').pop()), ['comments', 'decline']);
    } },
    { name: 'metrics listing: branches ORed 10 per query, all states, next followed, forks dropped', run: async () => {
      const branches = Array.from({ length: 12 }, (_, i) => `b${i}`);
      const f = fakeFetch([{ match: /\/pullrequests\?/, reply: (u) => res(200, u.includes('page=2')
        ? { values: [{ id: 2, state: 'MERGED', source: src('b1') }] }
        : decodeURIComponent(u).includes('"b0"')
          ? { values: [{ id: 1, state: 'OPEN', source: src('b0') }, { id: 9, state: 'OPEN', source: src('b0', 'x/api') }], next: `${API}/pullrequests?page=2` }
          : { values: [] }) }]);
      bb._testing.setFetch(f);
      const r = await bb.listPullRequestsForBranches(REPO, branches, { env: ENV });
      assert.deepEqual(r.prs.map((p) => p.id), [1, 2]);
      assert.equal(r.complete, true);
      assert.equal(f.calls.length, 3, 'two queries, one followed page');
      assert.match(decodeURIComponent(f.calls[0].url), /state=OPEN&state=MERGED&state=DECLINED&state=SUPERSEDED/);
    } },
  ]);
});

test('the token never leaves api.bitbucket.org: no off-origin URL, no header on a foreign redirect', async () => {
  await assert.rejects(bb.bbFetch('read', 'https://bitbucket.org.evil.io/2.0/x', { env: ENV }), /not a Bitbucket API URL/);
  const f = fakeFetch([
    { match: /^https:\/\/api\.bitbucket\.org\/2\.0\/x$/, reply: res(307, null, { location: 'https://logs.example-storage.net/step.txt' }) },
    { match: /^https:\/\/logs\.example-storage\.net\//, reply: res(200, null, { text: 'log line' }) },
  ]);
  bb._testing.setFetch(f);
  await assert.rejects(bb.bbFetch('read', 'https://api.bitbucket.org/2.0/x', { env: ENV }), /redirected to logs\.example-storage\.net/);
  const r = await bb.bbFetch('read', 'https://api.bitbucket.org/2.0/x', { env: ENV, text: true, foreignRedirect: true });
  assert.equal(r.text, 'log line');
  const foreign = f.calls.filter((c) => c.url.startsWith('https://logs.'));
  assert.equal(foreign.length, 1);
  assert.equal('authorization' in foreign[0].headers, false, 'no credential on the storage host');
  for (const c of f.calls.filter((x) => x.url.startsWith('https://api.'))) assert.equal(c.headers.authorization, 'Bearer read-tok');
  bb._testing.setFetch(fakeFetch([{ match: /\/2\.0\/y$/, reply: res(302, null, { location: 'http://logs.example-storage.net/step.txt' }) }]));
  await assert.rejects(bb.bbFetch('read', 'https://api.bitbucket.org/2.0/y', { env: ENV, text: true, foreignRedirect: true }), /redirected off https/);
});
