// test/metrics-prs.test.mjs
// Timeline PR states (src/core/metrics/prs.mjs): Action event files on the metrics branch, the
// batched gh lookup + its cache, the local pipelines table, and graceful degradation when gh is
// missing or signed out. gh is never spawned for real: every call goes through the test runner.
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, symlinkSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { withEnv } from './helpers/with-env.mjs';
import { worktreePath, azureCoordsForSlug } from '../src/core/metrics/sync.mjs';
import {
  resolveRunPrs, listPrEvents, parsePrEvent, readPrEventsFromDir, buildBranchQuery, cacheFresh, cachePath, isGithubSlug, parsePrUrl,
  forgeOfSlug, GH_BATCH, OPEN_TTL_MS, AZURE_MAX_PAGES, _testing,
} from '../src/core/metrics/prs.mjs';
import * as azurePr from '../src/core/pr/azure.mjs';

useTempHome(after);
afterEach(() => _testing.reset());

const NOW = Date.parse('2026-09-24T14:30:00Z');
const SLUG = 'acme/billing-api';

function writeEvent(slug, ev) {
  const dir = join(worktreePath(slug), '.worca-metrics', 'prs');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${ev.number}.json`), JSON.stringify({ v: 1, kind: 'pr', repo: 'Acme/Billing-API', ...ev }));
}

/** A fake gh: `auth status` answers per `auth`; graphql answers from `prsByBranch`. */
function fakeGh({ auth = 'ok', prsByBranch = {}, calls = [] } = {}) {
  return async (cmd, args) => {
    calls.push(args);
    if (args[0] === 'auth') {
      if (auth === 'missing') return { ok: false, stdout: '', stderr: 'spawn gh ENOENT', code: -1, missing: true };
      if (auth === 'signed-out') return { ok: false, stdout: '', stderr: 'You are not logged into any GitHub hosts.', code: 1 };
      return { ok: true, stdout: '', stderr: '', code: 0 };
    }
    const query = args[args.length - 1].slice('query='.length);
    const data = {};
    for (const m of query.matchAll(/(q\d+): repository\(owner: "([^"]+)", name: "([^"]+)"\) \{ pullRequests\(headRefName: "([^"]+)"/g)) {
      const [, alias, , , branch] = m;
      data[alias] = branch === 'no-access' ? null : { pullRequests: { nodes: prsByBranch[branch] || [] } };
    }
    return { ok: true, stdout: JSON.stringify({ data }), stderr: '', code: 0 };
  };
}

test('helpers: github slugs, PR urls, event parsing', () => {
  assert.ok(isGithubSlug('acme/billing-api'));
  assert.ok(!isGithubSlug('gitlab.com/group/api'));
  assert.deepEqual(parsePrUrl('https://github.com/Acme/api/pull/12'), { repo: 'Acme/api', number: 12 });
  assert.equal(parsePrUrl('https://gitlab.com/a/b/-/merge_requests/1'), null);
  assert.equal(parsePrEvent('{"v":2,"kind":"pr"}'), null);
  assert.equal(parsePrEvent('nope'), null);
  const ev = parsePrEvent(JSON.stringify({ v: 1, kind: 'pr', repo: 'a/b', number: 3, head: 'x', state: 'merged', mergedAt: '2026-09-01T00:00:00Z', createdAt: 'bad' }));
  assert.equal(ev.state, 'MERGED');
  assert.equal(ev.createdAt, null);
  assert.equal(ev.via, 'action');
});

test('event files: only <number>.json regular files inside prs/, no symlinks', () => {
  const dir = worktreePath('acme/guarded');
  const prs = join(dir, '.worca-metrics', 'prs');
  mkdirSync(prs, { recursive: true });
  writeFileSync(join(prs, '1.json'), JSON.stringify({ v: 1, kind: 'pr', repo: 'a/b', number: 1, head: 'h', state: 'OPEN' }));
  writeFileSync(join(prs, 'notes.json'), JSON.stringify({ v: 1, kind: 'pr', repo: 'a/b', number: 2, head: 'h', state: 'OPEN' }));
  writeFileSync(join(dir, 'outside.json'), JSON.stringify({ v: 1, kind: 'pr', repo: 'a/b', number: 3, head: 'h', state: 'OPEN' }));
  if (process.platform !== 'win32') symlinkSync(join(dir, 'outside.json'), join(prs, '3.json'));
  return readPrEventsFromDir(dir).then((evs) => assert.deepEqual(evs.map((e) => e.number), [1]));
});

test('GraphQL batch: aliased per branch, strings JSON-escaped', () => {
  const q = buildBranchQuery([{ repo: 'acme/api', branch: 'worca/x-"y"' }, { repo: 'o/r', branch: 'b' }]);
  assert.match(q, /q0: repository\(owner: "acme", name: "api"\) \{ pullRequests\(headRefName: "worca\/x-\\"y\\""/);
  assert.match(q, /q1: repository\(owner: "o", name: "r"\)/);
});

test('cache freshness: merged is final, open re-asked after the TTL, old "none" after a day', () => {
  assert.equal(cacheFresh({ prs: [{ state: 'MERGED' }], checkedAt: 0 }, { now: NOW }), true);
  assert.equal(cacheFresh({ prs: [{ state: 'OPEN' }], checkedAt: NOW - OPEN_TTL_MS + 1 }, { now: NOW }), true);
  assert.equal(cacheFresh({ prs: [{ state: 'OPEN' }], checkedAt: NOW - OPEN_TTL_MS - 1 }, { now: NOW }), false);
  assert.equal(cacheFresh({ prs: [], checkedAt: NOW - 2 * 3_600_000 }, { now: NOW, runEndedMs: NOW - 40 * 86_400_000 }), true);
  assert.equal(cacheFresh({ prs: [], checkedAt: NOW - 2 * 3_600_000 }, { now: NOW, runEndedMs: NOW - 86_400_000 }), false);
  assert.equal(cacheFresh(null, { now: NOW }), false);
});

test('Action events answer by branch (case-insensitive repo) and gh is never asked', async () => {
  _testing.setNow(() => NOW);
  const calls = [];
  _testing.setRunner(fakeGh({ calls }));
  writeEvent(SLUG, { number: 474, head: 'worca/responses', state: 'MERGED', createdAt: '2026-09-16T14:50:00Z', mergedAt: '2026-09-22T17:30:00Z', url: 'https://github.com/Acme/Billing-API/pull/474' });
  const { prs, status } = await resolveRunPrs({ runs: [{ id: 'r1', repos: [SLUG], branch: 'worca/responses' }], sinks: [SLUG] });
  assert.equal(prs.r1.length, 1);
  assert.equal(prs.r1[0].state, 'MERGED');
  assert.equal(prs.r1[0].via, 'action');
  assert.deepEqual(status.actionRepos, ['acme/billing-api']);
  assert.equal(status.gh, 'unused');
  assert.equal(calls.length, 0);
});

test('gh fills the gaps in batches, answers are cached, and a merged PR is not asked again', async () => {
  _testing.setNow(() => NOW);
  const calls = [];
  const runs = Array.from({ length: GH_BATCH + 2 }, (_, i) => ({ id: `g${i}`, repos: ['acme/gh-repo'], branch: `b${i}` }));
  _testing.setRunner(fakeGh({ calls, prsByBranch: { b0: [{ number: 7, url: 'https://github.com/acme/gh-repo/pull/7', state: 'MERGED', createdAt: '2026-09-20T10:00:00Z', mergedAt: '2026-09-21T10:00:00Z', headRefName: 'b0' }] } }));
  const first = await resolveRunPrs({ runs, sinks: [] });
  assert.equal(first.status.gh, 'ok');
  assert.equal(calls.filter((a) => a[0] === 'api').length, 2, 'two GraphQL batches');
  assert.equal(first.prs.g0[0].state, 'MERGED');
  assert.equal(first.prs.g0[0].via, 'gh');
  assert.deepEqual(first.prs.g1, [], 'looked up, no PR');
  assert.ok(existsSync(cachePath()));
  // Second read inside the TTL: everything from the cache.
  calls.length = 0;
  const second = await resolveRunPrs({ runs, sinks: [] });
  assert.equal(calls.length, 0);
  assert.equal(second.prs.g0[0].state, 'MERGED');
  // After the TTL only the unmerged branches are asked again.
  _testing.setNow(() => NOW + OPEN_TTL_MS + 1);
  await resolveRunPrs({ runs, sinks: [] });
  const asked = calls.filter((a) => a[0] === 'api').map((a) => a[a.length - 1]).join('\n');
  assert.ok(!/headRefName: "b0"/.test(asked), 'merged b0 is final');
  assert.ok(/headRefName: "b1"/.test(asked));
  const cache = JSON.parse(readFileSync(cachePath(), 'utf8'));
  assert.equal(cache.v, 1);
});

test('degrades: no gh on PATH, gh signed out, non-GitHub repos, unreachable repos', async () => {
  _testing.setNow(() => NOW);
  const runs = [{ id: 'm1', repos: ['acme/missing-gh'], branch: 'x' }, { id: 'gl', repos: ['gitlab.com/grp/api'], branch: 'y' }];
  _testing.setRunner(fakeGh({ auth: 'missing' }));
  const missing = await resolveRunPrs({ runs, sinks: [] });
  assert.equal(missing.status.gh, 'missing');
  assert.equal(missing.prs.m1, null, 'unknown, not "no PR"');
  assert.equal(missing.prs.gl, null);
  assert.deepEqual(missing.status.unsupportedRepos, ['gitlab.com/grp/api']);

  _testing.setRunner(fakeGh({ auth: 'signed-out' }));
  const out = await resolveRunPrs({ runs: [{ id: 'm2', repos: ['acme/signed-out'], branch: 'x' }], sinks: [] });
  assert.equal(out.status.gh, 'unauthenticated');
  assert.match(out.status.ghDetail, /not logged in/);
  assert.equal(out.prs.m2, null);

  _testing.setRunner(fakeGh({}));
  const noAccess = await resolveRunPrs({ runs: [{ id: 'na', repos: ['acme/private'], branch: 'no-access' }], sinks: [] });
  assert.equal(noAccess.prs.na, null, 'a repo gh could not read stays unknown and is asked again');
});

test('the local pipelines table answers for this machine\'s own runs without gh', async () => {
  _testing.setNow(() => NOW);
  _testing.setRunner(fakeGh({ auth: 'missing' }));
  const { getDb } = await import('../src/core/db.mjs');
  const db = getDb();
  const cols = db.prepare('PRAGMA table_info(pipelines)').all().map((c) => c.name);
  const row = { id: 'loc1', project_key: 'p-0123abcd', status: 'done', started_at: '2026-09-20T10:00:00Z', updated_at: '2026-09-20T11:00:00Z', pr_url: 'https://github.com/acme/billing-api/pull/88', pr_number: 88, pr_state: 'MERGED' };
  const keys = Object.keys(row).filter((k) => cols.includes(k));
  const notNull = db.prepare('PRAGMA table_info(pipelines)').all().filter((c) => c.notnull && c.dflt_value == null && !keys.includes(c.name) && !c.pk);
  for (const c of notNull) { row[c.name] = c.type.includes('INT') ? 0 : ''; keys.push(c.name); }
  db.prepare(`INSERT INTO pipelines (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map((k) => row[k]));
  const { prs } = await resolveRunPrs({ runs: [{ id: 'loc1', repos: [SLUG], branch: 'worca/local-only' }], sinks: [] });
  assert.equal(prs.loc1.length, 1);
  assert.equal(prs.loc1[0].state, 'MERGED');
  assert.equal(prs.loc1[0].via, 'local');
  assert.equal(prs.loc1[0].repo, 'acme/billing-api');
});

test('a record that names its PR finds the Action event by number', async () => {
  _testing.setNow(() => NOW);
  _testing.setRunner(fakeGh({ auth: 'missing' }));
  writeEvent('acme/numbered', { repo: 'acme/numbered', number: 12, head: 'renamed-later', state: 'CLOSED', closedAt: '2026-09-23T10:00:00Z' });
  const { prs } = await resolveRunPrs({ runs: [{ id: 'n1', repos: ['acme/numbered'], branch: 'original', pr: { url: 'https://github.com/acme/numbered/pull/12', number: 12 } }], sinks: ['acme/numbered'] });
  assert.equal(prs.n1[0].state, 'CLOSED');
});

test('listPrEvents: the scope\'s repos only, overlapping the window, newest first, with authors', async () => {
  _testing.setNow(() => NOW);
  const slug = 'acme/listed';
  writeEvent(slug, { repo: 'Acme/Listed', number: 1, head: 'a', state: 'MERGED', author: 'sini', createdAt: '2026-08-01T10:00:00Z', mergedAt: '2026-08-02T10:00:00Z' });
  writeEvent(slug, { repo: 'Acme/Listed', number: 2, head: 'b', state: 'OPEN', createdAt: '2026-09-20T10:00:00Z' });
  writeEvent(slug, { repo: 'Acme/Listed', number: 3, head: 'c', state: 'MERGED', createdAt: '2026-09-01T10:00:00Z', mergedAt: '2026-09-03T10:00:00Z' });
  writeEvent(slug, { repo: 'other/repo', number: 4, head: 'd', state: 'OPEN', createdAt: '2026-09-21T10:00:00Z' });
  const all = await listPrEvents({ sinks: [slug], repos: [slug] });
  assert.deepEqual(all.prs.map((p) => p.number), [2, 3, 1]);
  assert.equal(all.prs.find((p) => p.number === 1).author, 'sini');
  assert.deepEqual(all.actionRepos, ['acme/listed']);
  const sep = await listPrEvents({ sinks: [slug], repos: [slug], from: Date.parse('2026-09-02T00:00:00Z'), to: Date.parse('2026-10-01T00:00:00Z') });
  assert.deepEqual(sep.prs.map((p) => p.number), [2, 3], 'open PRs reach "now"; #3 merged inside');
  assert.equal(sep.truncated, false);
  assert.deepEqual((await listPrEvents({ sinks: ['acme/none'], repos: ['acme/none'] })).prs, []);
});

test('bad lookup rows are dropped, not fatal', async () => {
  _testing.setRunner(fakeGh({ auth: 'missing' }));
  const { prs } = await resolveRunPrs({ runs: [null, { id: '' }, { id: 'ok', repos: 'nope', branch: 5 }], sinks: ['not a slug!'] });
  assert.deepEqual(Object.keys(prs), ['ok']);
  assert.equal(prs.ok, null);
});

// ---- Azure DevOps ----------------------------------------------------------------------------

const freshCache = () => rmSync(cachePath(), { force: true });
const AZ = 'dev.azure.com/acme/shop/api';
const COORDS = async () => ({ org: 'acme', project: 'shop', repo: 'api' });
const NO_ADO = { WORCA_ADO_TOKEN: undefined, WORCA_ADO_READ_TOKEN: undefined, WORCA_ADO_WRITE_TOKEN: undefined, AZURE_DEVOPS_EXT_PAT: undefined };
const AZ_RUNS = [
  { id: 'r1', repos: [AZ], branch: 'worca/a', endedAt: '2026-09-20T09:00:00Z' },
  { id: 'r2', repos: [AZ], branch: 'worca/b', endedAt: '2026-09-22T09:00:00Z' },
  { id: 'r3', repos: [AZ], branch: 'worca/none', endedAt: '2026-09-22T09:00:00Z' },
];
const AZ_PRS = [
  { pullRequestId: 7, status: 'completed', creationDate: '2026-09-20T10:00:00Z', closedDate: '2026-09-21T10:00:00Z', sourceRefName: 'refs/heads/worca/a', targetRefName: 'refs/heads/main', title: 'A' },
  { pullRequestId: 8, status: 'active', creationDate: '2026-09-22T10:00:00Z', sourceRefName: 'refs/heads/worca/b', targetRefName: 'refs/heads/main', title: 'B' },
  { pullRequestId: 9, status: 'active', creationDate: '2026-09-22T11:00:00Z', sourceRefName: 'refs/heads/someone-else', targetRefName: 'refs/heads/main', title: 'C' },
];
afterEach(() => azurePr._testing.reset());

test('Azure DevOps repos: one PR listing per repo, matched to branches, cached; status.azure ok', async () => {
  freshCache();
  _testing.setNow(() => NOW);
  const ghCalls = [];
  _testing.setRunner(fakeGh({ calls: ghCalls }));
  const urls = [];
  azurePr._testing.setFetch(async (url) => { urls.push(String(url)); return { status: 200, ok: true, json: async () => ({ value: AZ_PRS }) }; });
  await withEnv({ ...NO_ADO, WORCA_ADO_TOKEN: 'pat' }, async () => {
    const first = await resolveRunPrs({ runs: AZ_RUNS, coordsFor: COORDS });
    assert.equal(urls.length, 1, 'one listing per repo, not per branch');
    assert.match(urls[0], /^https:\/\/dev\.azure\.com\/acme\/shop\/_apis\/git\/repositories\/api\/pullrequests\?searchCriteria\.status=all&/);
    assert.match(urls[0], /searchCriteria\.minTime=2026-07-22T09%3A00%3A00\.000Z/, 'earliest run end − 60 days');
    assert.equal(first.status.azure, 'ok');
    assert.equal(first.status.azureError, null);
    assert.deepEqual(first.status.azureTruncated, []);
    assert.equal(first.status.gh, 'unused');
    assert.deepEqual(first.status.unsupportedRepos, []);
    assert.equal(ghCalls.length, 0, 'gh is never asked about an Azure repo');

    assert.equal(first.prs.r1.length, 1);
    assert.deepEqual(
      (({ state, number, url, mergedAt, head, base, via }) => ({ state, number, url, mergedAt, head, base, via }))(first.prs.r1[0]),
      { state: 'MERGED', number: 7, url: 'https://dev.azure.com/acme/shop/_git/api/pullrequest/7',
        mergedAt: '2026-09-21T10:00:00Z', head: 'worca/a', base: 'main', via: 'azure' });
    assert.equal(first.prs.r2.length, 1);
    assert.equal(first.prs.r2[0].state, 'OPEN');
    assert.equal(first.prs.r2[0].number, 8);
    assert.equal(first.prs.r2[0].mergedAt, null);
    assert.deepEqual(first.prs.r3, [], 'looked up, no PR');

    // Within the TTL: MERGED is final, OPEN and "none" were just checked → no new listing; same answers from the cache.
    const second = await resolveRunPrs({ runs: AZ_RUNS, coordsFor: COORDS });
    assert.equal(urls.length, 1, 'served from pr-cache.json');
    assert.equal(second.prs.r1[0].via, 'azure', 'the cache keeps the Azure source (m5)');
    assert.equal(second.prs.r1[0].number, 7);
    assert.equal(second.prs.r2[0].number, 8);
    assert.deepEqual(second.prs.r3, []);
  });
});

test('Azure without a token → status.azure missing; a refused token → unauthenticated; never unsupported, never cached', async () => {
  freshCache();
  _testing.setNow(() => NOW);
  _testing.setRunner(fakeGh({}));
  const runs = [{ id: 'm1', repos: ['dev.azure.com/acme/shop/missing'], branch: 'x', endedAt: '2026-09-22T09:00:00Z' }];
  const urls = [];
  azurePr._testing.setFetch(async (url) => { urls.push(String(url)); return { status: 401, ok: false, json: async () => null }; });

  const missing = await withEnv(NO_ADO, () => resolveRunPrs({ runs, coordsFor: COORDS }));
  assert.equal(missing.status.azure, 'missing');
  assert.equal(missing.prs.m1, null, 'unknown, not "no PR"');
  assert.deepEqual(missing.status.unsupportedRepos, []);
  assert.equal(urls.length, 0);

  const refused = await withEnv({ ...NO_ADO, WORCA_ADO_TOKEN: 'expired' }, () => resolveRunPrs({ runs, coordsFor: COORDS }));
  assert.equal(refused.status.azure, 'unauthenticated');
  assert.equal(refused.prs.m1, null);
  const again = await withEnv({ ...NO_ADO, WORCA_ADO_TOKEN: 'expired' }, () => resolveRunPrs({ runs, coordsFor: COORDS }));
  assert.equal(again.status.azure, 'unauthenticated');
  assert.equal(urls.length, 2, 'a failed listing is not cached: asked again next time');
});

test('a listing cut off at AZURE_MAX_PAGES leaves unmatched branches unknown and uncached (M2)', async () => {
  freshCache();
  _testing.setNow(() => NOW);
  _testing.setRunner(fakeGh({}));
  const urls = [];
  // Every page is full and inside the window; worca/a sits on the third page, worca/old on none of the ten.
  azurePr._testing.setFetch(async (url) => {
    urls.push(String(url));
    const skip = Number(/\$skip=(\d+)/.exec(String(url))[1]);
    const value = Array.from({ length: 100 }, (_, i) => ({ pullRequestId: 5000 - skip - i, status: 'active', creationDate: '2026-09-23T00:00:00Z',
      sourceRefName: skip === 200 && i === 0 ? 'refs/heads/worca/a' : `refs/heads/other-${skip + i}`, targetRefName: 'refs/heads/main' }));
    return { status: 200, ok: true, json: async () => ({ value }) };
  });
  const runs = [
    { id: 't1', repos: [AZ], branch: 'worca/a', endedAt: '2026-09-22T09:00:00Z' },
    { id: 't2', repos: [AZ], branch: 'worca/old', endedAt: '2026-09-22T09:00:00Z' },
  ];
  await withEnv({ ...NO_ADO, WORCA_ADO_TOKEN: 'pat' }, async () => {
    const first = await resolveRunPrs({ runs, coordsFor: COORDS });
    assert.equal(urls.length, AZURE_MAX_PAGES, 'all ten pages were read');
    assert.equal(first.prs.t1[0].number, 4800, 'a match inside the cap is found');
    assert.equal(first.prs.t2, null, 'beyond the cap: unknown, not "no PR"');
    assert.equal(first.status.azure, 'ok');
    assert.deepEqual(first.status.azureTruncated, [AZ], 'the notice names the cut-off repo (m5)');

    const again = await resolveRunPrs({ runs, coordsFor: COORDS });
    assert.equal(urls.length, 2 * AZURE_MAX_PAGES, 'only the unknown branch is asked again: it was not cached');
    assert.equal(again.prs.t1[0].number, 4800, 't1 is served from the cache');
    assert.equal(again.prs.t2, null);
  });
});

test('a cut-off listing that still found every needed branch names no repo (n8)', async () => {
  freshCache();
  _testing.setNow(() => NOW);
  _testing.setRunner(fakeGh({}));
  // Same ten full pages as the M2 row, but both runs' branches are on page one.
  azurePr._testing.setFetch(async (url) => {
    const skip = Number(/\$skip=(\d+)/.exec(String(url))[1]);
    const value = Array.from({ length: 100 }, (_, i) => ({ pullRequestId: 6000 - skip - i, status: 'active', creationDate: '2026-09-23T00:00:00Z',
      sourceRefName: skip === 0 && i < 2 ? `refs/heads/worca/n8-${i}` : `refs/heads/other-${skip + i}`, targetRefName: 'refs/heads/main' }));
    return { status: 200, ok: true, json: async () => ({ value }) };
  });
  const runs = [0, 1].map((i) => ({ id: `n8-${i}`, repos: [AZ], branch: `worca/n8-${i}`, endedAt: '2026-09-22T09:00:00Z' }));
  const r = await withEnv({ ...NO_ADO, WORCA_ADO_TOKEN: 'pat' }, () => resolveRunPrs({ runs, coordsFor: COORDS }));
  assert.equal(r.prs['n8-0'][0].number, 6000);
  assert.equal(r.prs['n8-1'][0].number, 5999);
  assert.deepEqual(r.status.azureTruncated, [], 'nothing was left unknown, so no notice');
});

test('a coordsFor failure is an azureError, not a rejected resolveRunPrs', async () => {
  freshCache();
  _testing.setNow(() => NOW);
  _testing.setRunner(fakeGh({}));
  azurePr._testing.setFetch(async () => { throw new Error('must not be called'); });
  const r = await withEnv({ ...NO_ADO, WORCA_ADO_TOKEN: 'pat' },
    () => resolveRunPrs({ runs: AZ_RUNS, coordsFor: async () => { throw new Error('remotes unreadable'); } }));
  assert.equal(r.status.azureError, 'remotes unreadable');
  assert.equal(r.prs.r1, null);
});

test('parsePrUrl / forgeOfSlug know Azure', () => {
  assert.deepEqual(parsePrUrl('https://dev.azure.com/acme/My%20Project/_git/Api/pullrequest/12'), { repo: 'dev.azure.com/acme/my-project/api', number: 12 });
  assert.deepEqual(parsePrUrl('https://github.com/o/r/pull/3'), { repo: 'o/r', number: 3 });
  assert.equal(forgeOfSlug('acme/api'), 'github');
  assert.equal(forgeOfSlug('dev.azure.com/acme/shop/api'), 'azure');
  assert.equal(forgeOfSlug('gitlab.com/g/api'), null);
});

test('azureCoordsForSlug: without a local repo for the slug, the slug\'s own segments (D15)', async () => {
  assert.deepEqual(await azureCoordsForSlug('dev.azure.com/Acme/Shop/Api'), { org: 'acme', project: 'shop', repo: 'api' });
  assert.equal(await azureCoordsForSlug('acme/api'), null);
});
