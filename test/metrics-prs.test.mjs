// test/metrics-prs.test.mjs
// Timeline PR states (src/core/metrics/prs.mjs): Action event files on the metrics branch, the
// batched gh lookup + its cache, the local pipelines table, and graceful degradation when gh is
// missing or signed out. gh is never spawned for real: every call goes through the test runner.
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, symlinkSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { worktreePath } from '../src/core/metrics/sync.mjs';
import {
  resolveRunPrs, listPrEvents, parsePrEvent, readPrEventsFromDir, buildBranchQuery, cacheFresh, cachePath, isGithubSlug, parsePrUrl,
  GH_BATCH, OPEN_TTL_MS, _testing,
} from '../src/core/metrics/prs.mjs';

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
