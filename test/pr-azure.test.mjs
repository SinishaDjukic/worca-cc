// test/pr-azure.test.mjs
// src/core/pr/azure.mjs: Azure DevOps pull requests over REST 7.1 through an injectable fetch —
// create (with 409 recovery and fork refusal), view, find-by-branch, and the metrics listing.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as az from '../src/core/pr/azure.mjs';
import { checkRows } from './helpers/rows.mjs';

const ENV = { WORCA_ADO_TOKEN: 'pat' };
const REPO = { name: 'origin', host: 'dev.azure.com', org: 'acme', project: 'My Project', owner: 'acme/My Project', repo: 'api', forge: 'azure' };
const res = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers });
    for (const r of routes) if (r.match.test(String(url)) && (!r.method || r.method === (init.method || 'GET'))) return typeof r.reply === 'function' ? r.reply(String(url), init) : r.reply;
    throw new Error(`unrouted ${init.method || 'GET'} ${url}`);
  };
  fn.calls = calls;
  return fn;
}
afterEach(() => az._testing.reset());

test('Azure PR provider', async () => {
  await checkRows([
    { name: 'create: POST pullrequests with refs, api-version and auth; canonical URL', run: async () => {
      const f = fakeFetch([{ match: /\/pullrequests\?api-version=7\.1$/, method: 'POST', reply: res(201, { pullRequestId: 12 }) }]);
      az._testing.setFetch(f);
      const r = await az.createPr({ base: 'main', head: 'feat/x', title: 'T', body: 'B', baseRepo: REPO, pushRepo: REPO, env: ENV });
      assert.deepEqual(r, { ok: true, url: 'https://dev.azure.com/acme/My%20Project/_git/api/pullrequest/12', number: 12, existed: false });
      const c = f.calls[0];
      assert.equal(c.url, 'https://dev.azure.com/acme/My%20Project/_apis/git/repositories/api/pullrequests?api-version=7.1');
      assert.deepEqual(c.body, { sourceRefName: 'refs/heads/feat/x', targetRefName: 'refs/heads/main', title: 'T', description: 'B' });
      assert.match(c.headers.authorization, /^Basic /);
      assert.equal(c.headers['x-tfs-fedauthredirect'], 'Suppress');
    } },
    { name: 'create: 409 recovers the active non-fork PR (existed:true)', run: async () => {
      az._testing.setFetch(fakeFetch([
        { match: /\/pullrequests\?api-version/, method: 'POST', reply: res(409, { message: 'TF401179: An active pull request … already exists.' }) },
        { match: /searchCriteria\.status=active/, reply: res(200, { value: [{ pullRequestId: 6, status: 'active', forkSource: { repository: { name: 'api-fork' } } },
          { pullRequestId: 5, status: 'active', mergeStatus: 'succeeded' }] }) },
      ]));
      const r = await az.createPr({ base: 'main', head: 'feat/x', title: 'T', baseRepo: REPO, env: ENV });
      assert.deepEqual(r, { ok: true, url: 'https://dev.azure.com/acme/My%20Project/_git/api/pullrequest/5', number: 5, existed: true });
    } },
    { name: 'create: 401 and 203 → kind auth; no token → kind auth without a request', run: async () => {
      for (const status of [401, 203]) {
        az._testing.setFetch(fakeFetch([{ match: /./, reply: res(status, null) }]));
        assert.equal((await az.createPr({ base: 'm', head: 'h', title: 'T', baseRepo: REPO, env: ENV })).kind, 'auth');
      }
      const f = fakeFetch([]);
      az._testing.setFetch(f);
      assert.equal((await az.createPr({ base: 'm', head: 'h', title: 'T', baseRepo: REPO, env: {} })).kind, 'auth');
      assert.equal(f.calls.length, 0);
    } },
    { name: 'create: 500 → kind failed with the server message', run: async () => {
      az._testing.setFetch(fakeFetch([{ match: /./, reply: res(500, { message: 'boom' }) }]));
      const r = await az.createPr({ base: 'm', head: 'h', title: 'T', baseRepo: REPO, env: ENV });
      assert.deepEqual(r, { ok: false, kind: 'failed', error: 'Azure DevOps 500: boom' });
    } },
    { name: 'create: cross-repo refused as unsupported, no request', run: async () => {
      const f = fakeFetch([]);
      az._testing.setFetch(f);
      const r = await az.createPr({ base: 'm', head: 'h', title: 'T', baseRepo: REPO, pushRepo: { ...REPO, name: 'fork', repo: 'api-fork' }, env: ENV });
      assert.equal(r.kind, 'unsupported');
      assert.match(r.error, /forks\) are not supported yet — push to origin/);
      assert.equal(f.calls.length, 0);
    } },
    { name: 'create: workItemRefs when a work item id is given', run: async () => {
      const f = fakeFetch([{ match: /pullrequests/, method: 'POST', reply: res(201, { pullRequestId: 1 }) }]);
      az._testing.setFetch(f);
      await az.createPr({ base: 'm', head: 'h', title: 'T', baseRepo: REPO, workItemId: 77, env: ENV });
      assert.deepEqual(f.calls[0].body.workItemRefs, [{ id: '77' }]);
    } },
    { name: 'fitDescription: ≤4000, cut at a paragraph, footer kept', run: () => {
      const footer = '\n\n---\nStarted by ann@x.io via worca';
      const long = `${'para one. '.repeat(200)}\n\n${'para two. '.repeat(300)}${footer}`;
      const out = az.fitDescription(long);
      assert.ok(out.length <= az.DESCRIPTION_MAX);
      assert.ok(out.endsWith(footer));
      assert.ok(out.startsWith('para one. '));
      assert.ok(!out.includes('para two.'), 'cut at the paragraph boundary');
      assert.match(out, /shortened to fit Azure DevOps/);
      assert.equal(az.fitDescription('short'), 'short');
    } },
    { name: 'viewPr: state + mergeStatus mapping, project-level endpoint', run: async () => {
      const rows = [['active', 'succeeded', 'OPEN', 'MERGEABLE'], ['completed', 'succeeded', 'MERGED', 'MERGEABLE'],
        ['abandoned', 'notSet', 'CLOSED', 'UNKNOWN'], ['active', 'conflicts', 'OPEN', 'CONFLICTING'], ['active', 'queued', 'OPEN', 'UNKNOWN']];
      for (const [status, mergeStatus, state, mergeable] of rows) {
        const f = fakeFetch([{ match: /\/_apis\/git\/pullrequests\/9\?/, reply: res(200, { pullRequestId: 9, status, mergeStatus }) }]);
        az._testing.setFetch(f);
        const v = await az.viewPr({ prUrl: 'https://dev.azure.com/acme/My%20Project/_git/api/pullrequest/9', env: ENV });
        assert.deepEqual({ state: v.state, mergeable: v.mergeable }, { state, mergeable }, `${status}/${mergeStatus}`);
        assert.equal(f.calls[0].url, 'https://dev.azure.com/acme/My%20Project/_apis/git/pullrequests/9?api-version=7.1');
      }
    } },
    { name: 'findPrForBranch: OPEN beats MERGED; CLOSED dropped; none → null', run: async () => {
      az._testing.setFetch(fakeFetch([{ match: /sourceRefName=refs%2Fheads%2Ffeat%2Fx/, reply: res(200, { value: [
        { pullRequestId: 1, status: 'completed' }, { pullRequestId: 2, status: 'abandoned' }, { pullRequestId: 3, status: 'active' }] }) }]));
      assert.equal((await az.findPrForBranch({ head: 'feat/x', baseRepo: REPO, env: ENV })).number, 3);
      az._testing.setFetch(fakeFetch([{ match: /./, reply: res(200, { value: [{ pullRequestId: 2, status: 'abandoned' }] }) }]));
      assert.equal(await az.findPrForBranch({ head: 'feat/x', baseRepo: REPO, env: ENV }), null);
    } },
    { name: 'listPullRequests: pages by $skip until a short page (complete); filters by minTime locally', run: async () => {
      const page = (n, from) => Array.from({ length: n }, (_, i) => ({ pullRequestId: from + i, status: 'active', creationDate: '2026-09-10T00:00:00Z' }));
      const f = fakeFetch([
        { match: /\$skip=0/, reply: res(200, { value: page(100, 1) }) },
        { match: /\$skip=100/, reply: res(200, { value: page(1, 101) }) },
      ]);
      az._testing.setFetch(f);
      const { prs, complete } = await az.listPullRequests({ org: 'acme', project: 'Shop', repo: 'api' }, { minTime: '2026-08-01T00:00:00.000Z', env: ENV });
      assert.equal(f.calls.length, 2);
      assert.match(f.calls[0].url, /searchCriteria\.minTime=2026-08-01T00%3A00%3A00\.000Z&searchCriteria\.queryTimeRangeType=created/);
      assert.equal(prs.length, 101);
      assert.equal(complete, true);
    } },
    { name: 'listPullRequests: a full page reaching past minTime stops early (an ignored minTime costs no extra pages)', run: async () => {
      const f = fakeFetch([{ match: /\$skip=0/, reply: res(200, { value: [
        ...Array.from({ length: 99 }, (_, i) => ({ pullRequestId: 500 - i, status: 'active', creationDate: '2026-09-10T00:00:00Z' })),
        { pullRequestId: 7, status: 'completed', creationDate: '2026-01-01T00:00:00Z' }] }) }]);
      az._testing.setFetch(f);
      const { prs, complete } = await az.listPullRequests({ org: 'acme', project: 'Shop', repo: 'api' }, { minTime: '2026-08-01T00:00:00.000Z', env: ENV });
      assert.equal(f.calls.length, 1, 'no second page');
      assert.equal(prs.length, 99, 'the January PR is dropped by the local filter');
      assert.equal(complete, true);
    } },
    { name: 'listPullRequests: an old PR in the MIDDLE of a full page does not stop the listing; only the last (oldest) item does (m4)', run: async () => {
      const f = fakeFetch([
        { match: /\$skip=0/, reply: res(200, { value: Array.from({ length: 100 }, (_, i) => ({ pullRequestId: 900 - i, status: 'active',
          creationDate: i === 50 ? '2026-01-01T00:00:00Z' : '2026-09-10T00:00:00Z' })) }) },
        { match: /\$skip=100/, reply: res(200, { value: [] }) },
      ]);
      az._testing.setFetch(f);
      const { prs, complete } = await az.listPullRequests({ org: 'acme', project: 'Shop', repo: 'api' }, { minTime: '2026-08-01T00:00:00.000Z', env: ENV });
      assert.equal(f.calls.length, 2, 'the second page is still read');
      assert.equal(prs.length, 99);
      assert.equal(complete, true);
    } },
    { name: 'listPullRequests: maxPages full pages inside the window → complete:false (M2)', run: async () => {
      const f = fakeFetch([{ match: /pullrequests/, reply: (url) => {
        const skip = Number(/\$skip=(\d+)/.exec(url)[1]);
        return res(200, { value: Array.from({ length: 100 }, (_, i) => ({ pullRequestId: 1000 - skip - i, status: 'active', creationDate: '2026-09-10T00:00:00Z' })) });
      } }]);
      az._testing.setFetch(f);
      const { prs, complete } = await az.listPullRequests({ org: 'acme', project: 'Shop', repo: 'api' }, { minTime: '2026-08-01T00:00:00.000Z', maxPages: 2, env: ENV });
      assert.equal(f.calls.length, 2);
      assert.equal(prs.length, 200);
      assert.equal(complete, false);
    } },
    { name: 'create: a 2xx without an integer pullRequestId is a failure, not …/pullrequest/NaN', run: async () => {
      az._testing.setFetch(fakeFetch([{ match: /./, method: 'POST', reply: res(200, null) }]));
      const r = await az.createPr({ base: 'm', head: 'h', title: 'T', baseRepo: REPO, env: ENV });
      assert.equal(r.ok, false);
      assert.equal(r.kind, 'failed');
      assert.match(r.error, /no pull request id/);
    } },
    { name: 'findPrForBranch skips a fork\'s PR for a same-named branch', run: async () => {
      az._testing.setFetch(fakeFetch([{ match: /./, reply: res(200, { value: [
        { pullRequestId: 4, status: 'active', forkSource: { repository: { name: 'api-fork' } } }, { pullRequestId: 3, status: 'completed' }] }) }]));
      assert.equal((await az.findPrForBranch({ head: 'feat/x', baseRepo: REPO, env: ENV })).number, 3);
    } },
    { name: 'available()', run: async () => {
      assert.deepEqual(await az.available({ env: ENV }), { ok: true });
      assert.match((await az.available({ env: {} })).reason, /WORCA_ADO_TOKEN/);
    } },
    { name: 'workItemIdFromSourceRef: same org only', run: () => {
      const ref = JSON.stringify({ plugin: 'azure-boards-source', sourceId: 'azure-boards', taskId: 'acme/My Project#77' });
      assert.equal(az.workItemIdFromSourceRef(ref, REPO), 77);
      assert.equal(az.workItemIdFromSourceRef(ref, { ...REPO, org: 'other' }), null);
      assert.equal(az.workItemIdFromSourceRef(JSON.stringify({ plugin: 'github-source', taskId: 'o/r#1' }), REPO), null);
      assert.equal(az.workItemIdFromSourceRef('not json', REPO), null);
    } },
  ]);
});
