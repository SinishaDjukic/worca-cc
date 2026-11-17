// test/pr-watch-azure.test.mjs — the Azure DevOps adapter behind Watch PR (#619). Every REST call goes
// through pr/azure.mjs's injectable fetch, so nothing here reaches dev.azure.com.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as az from '../src/core/pr/azure.mjs';
import { prWatchSnapshot, prWatchJobLog, prWatchRerun, prWatchReply, prWatchComment, prChecks, PR_WATCH_LOG_BYTES,
  _testing as gitInfo } from '../src/core/git-info.mjs';
import { watchablePrUrl } from '../src/core/forge.mjs';
import { collectTriggers, buildFixTask } from '../src/core/pr-watch.mjs';
import { withEnv } from './helpers/with-env.mjs';

const PR = 'https://dev.azure.com/acme/My%20Project/_git/api/pullrequest/12';
const API = 'https://dev.azure.com/acme/My%20Project/_apis';
const REPO_API = `${API}/git/repositories/api`;
const PR_API = `${REPO_API}/pullRequests/12`;
const ENV = { WORCA_ADO_READ_TOKEN: 'read-pat', WORCA_ADO_WRITE_TOKEN: 'write-pat' };
const BUILD = '0609b952-1397-4640-95ec-e00a01b2c241';
const STATUS = 'cbdc66da-9728-4af8-aada-9a5a32e4a226';
const MIN_REVIEWERS = 'fa4e907d-c16b-4a4c-9dfa-4906e5d171dd';
const WORK_ITEMS = '40e92b44-2fe1-4dd6-b3d8-74a9c21d0c6e';
const REVIEWERS = '9c1d4ab3-1111-2222-3333-444455556666';
const EV = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

const res = (status, body, text = null) => ({ status, ok: status >= 200 && status < 300,
  json: async () => body, text: async () => (text ?? JSON.stringify(body)) });
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers });
    for (const r of routes) if (r.match.test(u) && (!r.method || r.method === (init.method || 'GET'))) return typeof r.reply === 'function' ? r.reply(u, init) : r.reply;
    throw new Error(`unrouted ${init.method || 'GET'} ${u}`);
  };
  fn.calls = calls;
  return fn;
}
afterEach(() => { az._testing.reset(); gitInfo.reset(); });

const token = (call) => Buffer.from(call.headers.authorization.replace(/^Basic /, ''), 'base64').toString().slice(1);
const evaluation = (id, status, cfg, context = {}) => ({ evaluationId: EV(id), status, context,
  configuration: { id, isEnabled: true, isBlocking: true, ...cfg } });
const prBody = (extra = {}) => ({
  pullRequestId: 12, status: 'active', mergeStatus: 'succeeded', isDraft: false,
  sourceRefName: 'refs/heads/feat/x', targetRefName: 'refs/heads/main',
  lastMergeSourceCommit: { commitId: 'sha1' }, lastMergeTargetCommit: { commitId: 'base-old' },
  createdBy: { uniqueName: 'me@acme.com', id: 'u-me' }, repository: { project: { id: 'proj-guid' } },
  reviewers: [
    { id: 'u-rev', uniqueName: 'rev@acme.com', displayName: 'Rev', vote: -10 },
    { id: 'u-wait', uniqueName: 'wait@acme.com', displayName: 'Wait', vote: -5 },
    { id: 'u-ok', uniqueName: 'ok@acme.com', displayName: 'Ok', vote: 10 },
    { id: REVIEWERS, uniqueName: '[My Project]\\Reviewers', displayName: 'Reviewers', vote: -10, isContainer: true },
  ],
  ...extra,
});
const threads = [
  { id: 5, status: 'active', comments: [
    { id: 1, commentType: 'text', content: 'please rename', author: { uniqueName: 'rev@acme.com' } },
    { id: 2, commentType: 'text', content: 'gone', isDeleted: true, author: { uniqueName: 'rev@acme.com' } },
  ] },
  { id: 6, status: 'fixed', comments: [{ id: 1, commentType: 'text', content: 'done already', author: { uniqueName: 'rev@acme.com' } }] },
  { id: 7, comments: [{ id: 1, commentType: 'system', content: 'Rev voted -10', author: { uniqueName: 'rev@acme.com' } }] },
  { id: 8, status: 'pending', comments: [{ id: 3, commentType: 'text', content: 'and this', author: { uniqueName: 'other@acme.com' } }] },
];
const statuses = [
  { id: 1, state: 'pending', context: { genre: 'ci', name: 'lint' } },
  { id: 2, state: 'failed', context: { genre: 'ci', name: 'lint' }, targetUrl: 'https://ci/lint' },
  { id: 3, state: 'failed', context: { genre: 'sec', name: 'scan' } },
];
const evaluations = [
  evaluation(1, 'rejected', { type: { id: BUILD, displayName: 'Build' }, settings: { displayName: 'PR build', buildDefinitionId: 41 } }, { buildId: 900 }),
  evaluation(2, 'approved', { type: { id: BUILD }, isBlocking: false, settings: { displayName: 'Optional build', buildDefinitionId: 42 } }, { buildId: 901 }),
  evaluation(3, 'broken', { type: { id: BUILD }, settings: { displayName: 'No build' } }),
  evaluation(4, 'notApplicable', { type: { id: BUILD }, settings: { displayName: 'Path filtered' } }, { buildId: 902 }),
  evaluation(5, 'rejected', { type: { id: STATUS }, settings: { statusGenre: 'sec', statusName: 'scan' } }),
  evaluation(6, 'rejected', { type: { id: MIN_REVIEWERS, displayName: 'Minimum reviewers' } }),
];
/** The base head (`base-live`) results: definition 41's newest build there, and the commit's statuses. */
function snapshotRoutes({ pr = prBody(), evals = evaluations, prStatuses = statuses, baseBuilds = [], baseStatuses = [], behindCount = 0 } = {}) {
  return [
    { match: /\/pullRequests\/12\?api-version=7\.1$/, reply: res(200, pr) },
    { match: /\/pullRequests\/12\/threads\?/, reply: res(200, { value: threads }) },
    { match: /\/pullRequests\/12\/statuses\?/, reply: res(200, { value: prStatuses }) },
    { match: /\/policy\/evaluations\?/, reply: res(200, { value: evals }) },
    { match: /\/refs\?filter=/, reply: res(200, { value: [{ name: 'refs/heads/main-old', objectId: 'nope' }, { name: 'refs/heads/main', objectId: 'base-live' }] }) },
    { match: /\/diffs\/commits\?/, reply: res(200, { behindCount, aheadCount: 1 }) },
    { match: /\/build\/builds\?definitions=/, reply: (u) => res(200, { value: baseBuilds.filter((b) => u.includes(`definitions=${b.def}&`)) }) },
    { match: /\/commits\/base-live\/statuses\?/, reply: res(200, { value: baseStatuses }) },
  ];
}
const settledSnapshot = async (opts) => {
  az._testing.setFetch(fakeFetch(snapshotRoutes(opts)));
  const snap = await az.prWatchSnapshot({ prUrl: PR, env: ENV });
  assert.equal(snap.ok, true, snap.error);
  return snap.pr;
};
// Every build check re-run once already: what the watcher sees after its re-runs failed again.
const rerunDone = (pr) => pr.contexts.filter((c) => c.type === 'check').map((c) => `rerun:check:${c.name}@${pr.headSha}`);

test('watchablePrUrl takes github.com and Azure DevOps PRs only', () => {
  assert.equal(watchablePrUrl(PR), true);
  assert.equal(watchablePrUrl('https://acme.visualstudio.com/Shop/_git/api/pullrequest/3'), true);
  assert.equal(watchablePrUrl('https://github.com/acme/app/pull/7'), true);
  for (const bad of ['https://ghe.corp/acme/app/pull/7', 'https://gitlab.com/a/b/-/merge_requests/1', null]) assert.equal(watchablePrUrl(bad), false, String(bad));
});

test('snapshot: PR facts, live base, policy checks, statuses, unresolved threads and rejecting votes in the watcher\'s shape', async () => {
  const f = fakeFetch(snapshotRoutes({ behindCount: 3 }));
  az._testing.setFetch(f);
  const snap = await az.prWatchSnapshot({ prUrl: PR, env: ENV });
  assert.equal(snap.ok, true, snap.error);
  const { contexts, threads: th, reviews, ...facts } = snap.pr;
  assert.deepEqual(facts, { url: PR, state: 'OPEN', branch: 'feat/x', headSha: 'sha1', base: 'main', baseSha: 'base-live',
    author: { login: 'me@acme.com' }, mergeable: 'MERGEABLE', behindBy: 3,
    baseFailing: [], basePassing: [], basePending: [], baseSettled: true });

  assert.deepEqual(contexts.map((c) => [c.type, c.databaseId ?? c.context, c.isRequired, c.conclusion ?? c.state, c.runId ?? null]), [
    ['check', 900, true, 'FAILURE', EV(1)],
    ['check', 901, false, 'SUCCESS', EV(2)],
    ['status', 'No build', true, 'ERROR', null],
    ['status', 'sec/scan', true, 'FAILURE', null],
    ['status', 'ci/lint', false, 'FAILURE', null],     // the newest of its two posts; sec/scan is covered by its policy
  ]);
  assert.equal(contexts[0].detailsUrl, 'https://dev.azure.com/acme/My%20Project/_build/results?buildId=900');

  assert.deepEqual(th.map((t) => [t.nodeId, t.isResolved, t.comments.map((c) => c.databaseId)]),
    [[5, false, ['5.1']], [6, true, ['6.1']], [7, true, []], [8, false, ['8.3']]]);
  assert.deepEqual(th[0].comments[0], { databaseId: '5.1', body: 'please rename', author: { login: 'rev@acme.com' }, authorAssociation: 'MEMBER' });
  assert.deepEqual(reviews.map((r) => [r.databaseId, r.body]), [['u-rev:-10', 'Rev voted "Rejected".'], ['u-wait:-5', 'Wait voted "Waiting for author".']]);

  const ev = f.calls.find((c) => c.url.includes('/policy/evaluations'));
  assert.ok(ev.url.startsWith(`${API}/policy/evaluations?artifactId=${encodeURIComponent('vstfs:///CodeReview/CodeReviewId/proj-guid/12')}`));
  assert.match(ev.url, /api-version=7\.1-preview\.1$/);
  const diff = f.calls.find((c) => c.url.includes('/diffs/commits'));
  assert.equal(diff.url, `${REPO_API}/diffs/commits?baseVersion=base-live&baseVersionType=commit&targetVersion=sha1&targetVersionType=commit&$top=1&api-version=7.1`);
  assert.ok(f.calls.some((c) => c.url === `${API}/build/builds?definitions=41&branchName=${encodeURIComponent('refs/heads/main')}&queryOrder=queueTimeDescending&$top=20&api-version=7.1`));
  for (const c of f.calls) { assert.equal(c.method, 'GET'); assert.equal(token(c), 'read-pat'); }
});

test('a failed build is re-queued once before any fix; then the PR\'s own failures, comments and votes fire and dedupe', async () => {
  const pr = await settledSnapshot();
  const first = collectTriggers(pr, []);
  assert.deepEqual(first.reruns, [{ runId: EV(1), keys: ['rerun:check:PR build@sha1'] }]);
  assert.deepEqual(first.failures, []);

  const t = collectTriggers(pr, rerunDone(pr));
  assert.equal(t.fire, true);
  assert.deepEqual(t.handledKeys, ['check:PR build@sha1', 'status:No build@sha1', 'status:sec/scan@sha1',
    'comment:5.1', 'comment:8.3', 'review:u-rev:-10', 'review:u-wait:-5']);
  assert.deepEqual(t.threads.map((x) => [x.nodeId, x.commentIds]), [[5, ['5.1']], [8, ['8.3']]]);
  assert.equal(collectTriggers(pr, [...rerunDone(pr), ...t.handledKeys]).fire, false);
  const task = buildFixTask({ pr, triggers: t, logs: [{ databaseId: 900, text: 'error TS2322' }] });
  assert.match(task, /Failed check: PR build\n> error TS2322/);
  assert.match(task, /Review comment:\n> please rename/);
  assert.match(task, /Changes requested:\n> Rev voted "Rejected"\./);
});

test('the base head: a check failing there too is skipped, one still running there holds the failure back', async () => {
  const failingOnBase = await settledSnapshot({ baseBuilds: [{ def: 41, sourceVersion: 'base-live', status: 'completed', result: 'failed' }],
    baseStatuses: [{ id: 1, state: 'failed', context: { genre: 'sec', name: 'scan' } }] });
  assert.deepEqual([failingOnBase.baseFailing, failingOnBase.baseSettled], [['PR build', 'sec/scan'], true]);
  const t = collectTriggers(failingOnBase, rerunDone(failingOnBase));
  assert.deepEqual(t.skipped, ['PR build', 'sec/scan']);
  assert.deepEqual(t.failures.map((f) => f.name || f.context), ['No build']);
  assert.match(buildFixTask({ pr: failingOnBase, triggers: t }), /Also failing on the base branch `main`, not this PR's to fix; leave them alone: PR build, sec\/scan\./);

  // An older build of the definition on the base is not the base head's result.
  const running = await settledSnapshot({ baseBuilds: [
    { def: 41, sourceVersion: 'base-live', status: 'inProgress' },
    { def: 41, sourceVersion: 'base-older', status: 'completed', result: 'failed' },
  ] });
  assert.deepEqual([running.basePending, running.baseFailing, running.baseSettled], [['PR build'], [], false]);
  const held = collectTriggers(running, rerunDone(running));
  assert.ok(held.waitingOnBase.includes('PR build'));
  assert.deepEqual(held.failures, []);
});

test('behind its base, whose head passes the failing check: merge the base in first', async () => {
  const pr = await settledSnapshot({ behindCount: 4, baseBuilds: [{ def: 41, sourceVersion: 'base-live', status: 'completed', result: 'partiallySucceeded' }] });
  const t = collectTriggers(pr, rerunDone(pr));
  assert.deepEqual(t.conflict, { base: 'main', baseSha: 'base-live', why: 'behind', checks: ['PR build'] });
  assert.deepEqual(t.handledKeys, ['behind:PR build']);
});

test('a merge conflict goes alone, keyed by head and the live base', async () => {
  const pr = await settledSnapshot({ pr: prBody({ mergeStatus: 'conflicts' }) });
  const t = collectTriggers(pr, []);
  assert.deepEqual([t.conflict, t.handledKeys], [{ base: 'main', baseSha: 'base-live' }, ['conflict:sha1@base-live']]);
});

test('base reads are best effort: no Build (Read) still answers, with every failure the PR\'s own', async () => {
  const routes = snapshotRoutes();
  routes.unshift({ match: /\/build\/builds\?|\/commits\/|\/diffs\/|\/refs\?/, reply: res(403, { message: 'no scope' }) });
  az._testing.setFetch(fakeFetch(routes));
  const snap = await az.prWatchSnapshot({ prUrl: PR, env: ENV });
  assert.equal(snap.ok, true, snap.error);
  assert.deepEqual([snap.pr.baseSha, snap.pr.behindBy, snap.pr.baseFailing, snap.pr.baseSettled], ['base-old', 0, [], true]);
  // A rate limit is not swallowed: the whole read backs off.
  const limited = snapshotRoutes();
  limited.unshift({ match: /\/diffs\//, reply: res(429, {}) });
  az._testing.setFetch(fakeFetch(limited));
  assert.equal((await az.prWatchSnapshot({ prUrl: PR, env: ENV })).class, 'rate-limit');
});

test('a queued required build holds every failure until the checks settle', async () => {
  const evals = [evaluation(1, 'queued', { type: { id: BUILD }, settings: { displayName: 'PR build' } }),
    evaluation(5, 'rejected', { type: { id: STATUS }, settings: { statusGenre: 'sec', statusName: 'scan' } })];
  const pr = await settledSnapshot({ evals });
  const t = collectTriggers(pr, []);
  assert.equal(t.checksSettled, false);
  assert.deepEqual(t.failures, []);
});

test('a merged or abandoned PR answers its state without listing anything', async () => {
  for (const [status, state] of [['completed', 'MERGED'], ['abandoned', 'CLOSED']]) {
    const f = fakeFetch([{ match: /\/pullRequests\/12\?/, reply: res(200, prBody({ status })) }]);
    az._testing.setFetch(f);
    const snap = await az.prWatchSnapshot({ prUrl: PR, env: ENV });
    assert.equal(snap.pr.state, state);
    assert.equal(f.calls.length, 1);
  }
});

test('failures carry the watcher\'s classes: 429 rate-limit, 401/403 auth, the rest failed', async () => {
  for (const [status, cls] of [[429, 'rate-limit'], [401, 'auth'], [403, 'auth'], [500, 'failed']]) {
    az._testing.setFetch(fakeFetch([{ match: /./, reply: res(status, { message: 'x' }) }]));
    const snap = await az.prWatchSnapshot({ prUrl: PR, env: ENV });
    assert.deepEqual([snap.ok, snap.class], [false, cls], String(status));
  }
  az._testing.setFetch(fakeFetch([{ match: /\/pullRequests\/12\?/, reply: res(200, { status: 'active' }) }]));
  assert.deepEqual(await az.prWatchSnapshot({ prUrl: PR, env: ENV }), { ok: false, class: 'failed', error: 'malformed Azure DevOps pull request' });
  assert.equal((await az.prWatchSnapshot({ prUrl: 'https://github.com/a/b/pull/1', env: ENV })).class, 'failed');
  assert.equal((await az.prWatchSnapshot({ prUrl: PR, env: {} })).class, 'auth');
});

test('policy evaluations page by $top/$skip', async () => {
  const page = (n, from) => Array.from({ length: n }, (_, i) => evaluation(from + i, 'approved', { type: { id: BUILD }, isBlocking: false }, { buildId: from + i }));
  const routes = snapshotRoutes();
  routes[3] = { match: /\/policy\/evaluations\?/, reply: (u) => res(200, { value: /\$skip=0&/.test(u) ? page(100, 1) : page(3, 101) }) };
  const f = fakeFetch(routes);
  az._testing.setFetch(f);
  const snap = await az.prWatchSnapshot({ prUrl: PR, env: ENV });
  assert.equal(snap.pr.contexts.filter((c) => c.type === 'check').length, 103);
  assert.equal(f.calls.filter((c) => c.url.includes('/policy/evaluations')).length, 2);
});

test('the build log: each failed task\'s name, error issues and log tail, timestamps cut, read as text', async () => {
  const lines = Array.from({ length: 250 }, (_, i) => `2026-10-10T08:00:${String(i % 60).padStart(2, '0')}.1234567Z line ${i}`);
  const f = fakeFetch([
    { match: /\/build\/builds\/900\/timeline\?/, reply: res(200, { records: [
      { type: 'Task', result: 'succeeded', name: 'Checkout', log: { id: 1 } },
      { type: 'Task', result: 'failed', name: 'npm test', log: { id: 7 }, issues: [{ type: 'error', message: 'Bash exited with code 1' }, { type: 'warning', message: 'slow' }] },
      { type: 'Job', result: 'failed', name: 'Job', log: { id: 2 } },
    ] }) },
    { match: /\/build\/builds\/900\/logs\/7\?/, reply: res(200, null, lines.join('\r\n')) },
  ]);
  az._testing.setFetch(f);
  const r = await az.failedBuildLog({ prUrl: PR, databaseId: 900, env: ENV });
  assert.equal(r.ok, true, r.error);
  const out = r.text.split('\n');
  assert.deepEqual(out.slice(0, 3), ['## npm test', 'Bash exited with code 1', 'line 50']);
  assert.equal(out.at(-1), 'line 249');
  assert.equal(out.length, 2 + 200);
  const logCall = f.calls.find((c) => c.url.includes('/logs/7'));
  assert.equal(logCall.headers.accept, 'text/plain');
  assert.equal(logCall.url, `${API}/build/builds/900/logs/7?api-version=7.1`);
  assert.equal((await az.failedBuildLog({ prUrl: PR, databaseId: 'x', env: ENV })).ok, false);
});

test('git-info dispatches by the PR URL: Azure logs are redacted and tail-capped, GitHub keeps gh', () => withEnv(ENV, async () => {
  const secret = 'wbt_' + 'a'.repeat(30);
  const big = `${'x'.repeat(PR_WATCH_LOG_BYTES * 2)}\ntoken ${secret}\nthe failing assertion`;
  az._testing.setFetch(fakeFetch([
    { match: /\/timeline\?/, reply: res(200, { records: [{ type: 'Task', result: 'failed', name: 'T', log: { id: 3 } }] }) },
    { match: /\/logs\/3\?/, reply: res(200, null, big) },
  ]));
  const log = await prWatchJobLog({ projectDir: '/p', prUrl: PR, databaseId: 900 });
  assert.equal(log.ok, true, log.error);
  assert.ok(!log.text.includes(secret), 'the broker token was redacted');
  assert.ok(Buffer.byteLength(log.text) <= PR_WATCH_LOG_BYTES);
  assert.ok(log.text.endsWith('the failing assertion'), 'the end of the log is kept');

  const gh = [];
  gitInfo.setRunner(async (cmd, args) => { gh.push([cmd, ...args]); return { ok: false, stdout: '', stderr: 'boom', code: 1 }; });
  assert.equal((await prWatchSnapshot({ projectDir: '/p', prUrl: 'https://github.com/acme/app/pull/7' })).ok, false);
  await prWatchRerun({ projectDir: '/p', prUrl: 'https://github.com/acme/app/pull/7', runId: 55 });
  assert.ok(gh.some((a) => a[0] === 'gh' && a[1] === 'api'), 'a github.com snapshot still goes through gh');
  assert.ok(gh.some((a) => a.join(' ').startsWith('gh run rerun 55 --failed')), 'a github.com re-run still goes through gh');
}));

test('re-run on Azure re-queues the build policy\'s evaluation with the write token', () => withEnv(ENV, async () => {
  const f = fakeFetch([{ match: /\/policy\/evaluations\//, method: 'PATCH', reply: res(200, { status: 'queued' }) }]);
  az._testing.setFetch(f);
  assert.deepEqual(await prWatchRerun({ projectDir: '/p', prUrl: PR, runId: EV(1) }), { ok: true });
  assert.equal(f.calls[0].url, `${API}/policy/evaluations/${EV(1)}?api-version=7.1-preview.1`);
  assert.equal(token(f.calls[0]), 'write-pat');
  assert.equal((await prWatchRerun({ projectDir: '/p', prUrl: PR, runId: '../x' })).ok, false);
  az._testing.setFetch(fakeFetch([{ match: /./, reply: res(429, {}) }]));
  assert.equal((await prWatchRerun({ projectDir: '/p', prUrl: PR, runId: EV(1) })).class, 'rate-limit');
}));

test('the PR card: Azure policies and votes become GitHub\'s merge verdict, base failures counted apart', () => withEnv(ENV, async () => {
  const verdict = async (opts) => { az._testing.setFetch(fakeFetch(snapshotRoutes({ prStatuses: [], ...opts }))); return prChecks({ projectDir: '/p', prUrl: PR }); };
  const passing = [evaluation(1, 'approved', { type: { id: BUILD }, settings: { displayName: 'PR build', buildDefinitionId: 41 } }, { buildId: 900 })];
  const noVotes = { reviewers: [] };

  let r = await verdict({ evals: evaluations });
  assert.equal(r.mergeable, 'MERGEABLE');
  assert.equal(r.base, 'main');
  assert.deepEqual([r.status.tone, r.status.label], ['bad', 'Changes requested']);   // a rejecting vote

  r = await verdict({ pr: prBody(noVotes), evals: [...passing, evaluation(6, 'queued', { type: { id: MIN_REVIEWERS } })] });
  assert.deepEqual([r.status.tone, r.status.label, r.status.detail], ['wait', 'Review required', 'Check passed']);

  r = await verdict({ pr: prBody(noVotes), evals: [...passing, evaluation(7, 'rejected', { type: { id: WORK_ITEMS } })] });
  assert.equal(r.status.label, 'Blocked by branch rules');

  r = await verdict({ pr: prBody(noVotes), evals: passing });
  assert.deepEqual([r.status.tone, r.status.label], ['ok', 'Ready to merge']);

  r = await verdict({ pr: prBody({ ...noVotes, isDraft: true }), evals: passing });
  assert.equal(r.status.label, 'Draft');

  r = await verdict({ pr: prBody({ ...noVotes, mergeStatus: 'conflicts' }), evals: passing });
  assert.deepEqual([r.mergeable, r.status.label], ['CONFLICTING', 'Merge conflicts']);

  r = await verdict({ pr: prBody(noVotes), evals: [evaluations[0]],
    baseBuilds: [{ def: 41, sourceVersion: 'base-live', status: 'completed', result: 'failed' }] });
  assert.deepEqual([r.checks.failed, r.checks.inherited, r.status.label], [0, 1, 'Ready to merge']);
  assert.equal(r.status.detail, '0 of 1 checks passed · 1 also failing on main');

  az._testing.setFetch(fakeFetch([{ match: /./, reply: res(500, {}) }]));
  assert.equal(await prChecks({ projectDir: '/p', prUrl: PR }), null);
}));

test('reply and comment post with the write token: a reply on the thread, a comment as a closed thread', () => withEnv(ENV, async () => {
  const f = fakeFetch([
    { match: /\/threads\/5\/comments\?/, method: 'POST', reply: res(200, { id: 2 }) },
    { match: /\/pullRequests\/12\/threads\?/, method: 'POST', reply: res(200, { id: 9 }) },
  ]);
  az._testing.setFetch(f);
  assert.deepEqual(await prWatchReply({ projectDir: '/p', prUrl: PR, threadId: 5, body: 'fixed' }), { ok: true });
  assert.deepEqual(await prWatchComment({ projectDir: '/p', prUrl: PR, body: 'done' }), { ok: true });
  const [reply, comment] = f.calls;
  assert.equal(reply.url, `${PR_API}/threads/5/comments?api-version=7.1`);
  assert.deepEqual(reply.body, { content: 'fixed', parentCommentId: 1, commentType: 1 });
  assert.equal(comment.url, `${PR_API}/threads?api-version=7.1`);
  assert.deepEqual(comment.body, { comments: [{ parentCommentId: 0, content: 'done', commentType: 1 }], status: 4 });
  for (const c of f.calls) assert.equal(token(c), 'write-pat');

  az._testing.setFetch(fakeFetch([{ match: /./, reply: res(429, {}) }]));
  assert.equal((await prWatchReply({ projectDir: '/p', prUrl: PR, threadId: 5, body: 'x' })).class, 'rate-limit');
  assert.equal((await prWatchReply({ projectDir: '/p', prUrl: PR, threadId: 'T_node', body: 'x' })).ok, false);
}));
