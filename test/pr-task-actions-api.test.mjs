// test/pr-task-actions-api.test.mjs — the Tasks page's PR actions: POST /api/pr/merge, /api/pr/rerun-checks and
// /api/pr/fix-checks. Each refuses what dev's /api/pr/resolve refuses (one shared table, run against all four), plus its
// own codes; a refusal changes nothing (no gh pr merge, no run started).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app } from '../ui/server.mjs';
import { _testing as gitInfo } from '../src/core/git-info.mjs';
import { _testing as gitSync } from '../src/core/git-sync.mjs';
import { _resetForTests, getDb } from '../src/core/db.mjs';
import { writeStoreMeta, persistPrState, readPrState } from '../src/core/artifacts.mjs';
import { getWatch, updateWatch, setWatch } from '../src/core/pr-watch.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';

const GH = 'https://github.com/me/repo/pull/7';
const NEXT = 'https://github.com/me/repo/pull/8';
const PREV = 'https://github.com/me/repo/pull/6';
let srv, base, home, prevHome, prevTok, repo, seeded, next, prev;

async function seedRun(title, branch) {
  const s = await seedPipeline(repo, { title, status: 'done', startedAt: '2026-06-01T00:00:00Z', branch: { ...branch, branchKept: true },
    stepper: { version: 2, template: { id: 'wf_default', name: 'Default' } } });
  writeStoreMeta(s.key, 'project', { key: s.key, name: 'Repo', path: repo });
  return s;
}
function chain(pipelineId, afterId) {
  const at = '2026-06-01T00:00:00Z';
  getDb().prepare(`INSERT INTO scheduled_runs (id, run_at, request, status, pipeline_id, after_kind, after_id, source_from_previous, created_at, updated_at)
    VALUES (?, ?, '{}', 'fired', ?, 'pipeline', ?, 1, ?, ?)`).run(`t-${pipelineId}`, at, pipelineId, afterId, at, at);
}

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-prtask-'));
  prevHome = process.env.WORCA_HOME; process.env.WORCA_HOME = home;
  prevTok = process.env.WORCA_GH_READ_TOKEN; process.env.WORCA_GH_READ_TOKEN = 'read-token';
  _resetForTests();
  repo = await mkdtemp(join(tmpdir(), 'worca-cc-prtask-repo-'));
  seeded = await seedRun('Merge me', { source: 'main', feature: 'worca-cc/merge-me' });
  next = await seedRun('Stacked on it', { source: 'worca-cc/merge-me', feature: 'worca-cc/next' });
  prev = await seedRun('Before it', { source: 'main', feature: 'worca-cc/prev' });
  chain(next.id, seeded.id);
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  gitInfo.reset(); gitSync.reset(); _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  if (prevTok === undefined) delete process.env.WORCA_GH_READ_TOKEN; else process.env.WORCA_GH_READ_TOKEN = prevTok;
  await rm(home, { recursive: true, force: true });
});

/** gh as the PR's host answers it. `pr` sets the PR's facts; `refuse` names the verbs that fail with their stderr. */
let gh, seen;
function fakeGh(over = {}) {
  gh = { mergeable: 'MERGEABLE', checks: [{ name: 'unit', status: 'COMPLETED', conclusion: 'SUCCESS', runId: 11 }], refuse: {}, ...over };
  seen = [];
  const ok = (v) => ({ ok: true, code: 0, stderr: '', stdout: typeof v === 'string' ? v : JSON.stringify(v) });
  const no = (stderr) => ({ ok: false, code: 1, stdout: '', stderr });
  gitInfo.setRunner(async (cmd, args) => {
    if (cmd !== 'gh') return no('no');
    seen.push(args.join(' '));
    const verb = `${args[0]} ${args[1]}`;
    if (gh.refuse[verb]) return no(gh.refuse[verb]);
    if (verb === 'pr merge' && gh.hold) await gh.hold;
    if (args[0] === '--version') return ok('gh version 2');
    if (verb === 'pr view') return ok({ mergeable: gh.mergeable, mergeStateStatus: 'CLEAN', reviewDecision: 'APPROVED', isDraft: false,
      statusCheckRollup: gh.checks.map((c) => ({ __typename: 'CheckRun', name: c.name, status: c.status, conclusion: c.conclusion })),
      latestReviews: [{ author: { login: 'maya' }, state: 'APPROVED' }], headRefOid: gh.noHead ? null : 'h1' });
    if (verb === 'api graphql') return ok({ data: { repository: { pullRequest: {
      url: GH, state: 'OPEN', headRefName: 'worca-cc/merge-me', headRefOid: 'h1', baseRefName: 'main', baseRefOid: 'b1',
      mergeable: gh.mergeable, author: { login: 'me' },
      statusCheckRollup: { contexts: { nodes: gh.checks.map((c) => ({ __typename: 'CheckRun', name: c.name, status: c.status,
        conclusion: c.conclusion, isRequired: false, databaseId: c.runId * 10, checkSuite: { workflowRun: { databaseId: c.runId } } })),
      pageInfo: { hasNextPage: false, endCursor: null } } },
      reviewThreads: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
      reviews: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } } } });
    if (verb === 'repo view') return ok({ squashMergeAllowed: false, mergeCommitAllowed: true, rebaseMergeAllowed: true });
    return ok('');
  });
}
const failingCheck = (name, runId) => ({ name, status: 'COMPLETED', conclusion: 'FAILURE', runId });

beforeEach(() => {
  gitInfo.reset(); gitSync.reset();
  getDb().exec('DELETE FROM pr_watch_runs; DELETE FROM pr_watches; UPDATE pipelines SET archived_at = NULL');
  persistPrState(seeded.id, { url: GH, number: 7, state: 'OPEN' });
  persistPrState(next.id, { url: NEXT, number: 8, state: 'OPEN' });
  fakeGh();
});

const post = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const scope = () => ({ id: seeded.id, projectKey: seeded.key });
const ROUTES = ['/api/pr/merge', '/api/pr/rerun-checks', '/api/pr/fix-checks', '/api/pr/resolve'];

test('every Tasks PR route refuses exactly what dev\'s Resolve refuses: archived, closed, no PR, no id', async () => {
  const cases = [
    ['archived', () => getDb().prepare('UPDATE pipelines SET archived_at = ? WHERE id = ?').run('2026-06-02T00:00:00Z', seeded.id), scope],
    ['closed PR', () => persistPrState(seeded.id, { url: GH, number: 7, state: 'CLOSED' }), scope],
    ['no PR', () => getDb().prepare('UPDATE pipelines SET pr_url = NULL, pr_state = NULL WHERE id = ?').run(seeded.id), scope],
    ['no id', () => {}, () => ({ projectKey: seeded.key })],
  ];
  for (const [name, arrange, body] of cases) {
    const answers = [];
    for (const route of ROUTES) {
      getDb().exec('UPDATE pipelines SET archived_at = NULL');
      persistPrState(seeded.id, { url: GH, number: 7, state: 'OPEN' });
      arrange();
      const r = await post(route, body());
      answers.push([r.status, (await r.json()).error]);
    }
    for (const a of answers.slice(0, 3)) assert.deepEqual(a, answers[3], `${name}: same refusal as /api/pr/resolve`);
    assert.ok(answers[3][0] >= 400, name);
  }
  assert.ok(!seen.some((s) => s.startsWith('pr merge')), 'a refused merge sends no gh pr merge');
});

test('Merge PR: merges with the first allowed method, persists MERGED, and retargets only the OPEN successor on the merged head', async () => {
  const r = await post('/api/pr/merge', scope());
  const out = await r.json();
  assert.equal(r.status, 200, JSON.stringify(out));
  assert.deepEqual(out, { merged: true, pr: { url: GH, state: 'MERGED' }, next: { url: NEXT, retargeted: true } });
  assert.ok(seen.includes(`pr merge ${GH} --merge --match-head-commit h1`), `merges only the head whose checks it read:\n${seen.join('\n')}`);
  assert.ok(seen.includes(`pr edit ${NEXT} --base main`), 'the successor now targets the merged PR\'s base');
  assert.equal(readPrState(seeded.id).state, 'MERGED');
});

test('Merge PR: a successor whose PR is not OPEN is left alone; no successor answers next: null', async () => {
  persistPrState(next.id, { url: NEXT, number: 8, state: 'CLOSED' });
  const r = await post('/api/pr/merge', scope());
  assert.deepEqual(await r.json(), { merged: true, pr: { url: GH, state: 'MERGED' }, next: null });
  assert.ok(!seen.some((s) => s.startsWith('pr edit')));
});

test('Merge PR: a failed retarget still answers merged: true, with the reason', async () => {
  fakeGh({ refuse: { 'pr edit': 'HTTP 422: base branch is protected' } });
  const r = await post('/api/pr/merge', scope());
  const out = await r.json();
  assert.equal(r.status, 200);
  assert.deepEqual(out.next, { url: NEXT, retargeted: false, error: 'HTTP 422: base branch is protected' });
  assert.equal(out.merged, true);
  assert.equal(readPrState(seeded.id).state, 'MERGED');
});

test('Merge PR: out of stack order is 409 STACK_ORDER and sends no gh pr merge', async () => {
  persistPrState(prev.id, { url: PREV, number: 6, state: 'OPEN' });
  chain(seeded.id, prev.id);
  try {
    const r = await post('/api/pr/merge', scope());
    assert.deepEqual([r.status, await r.json()], [409, { error: 'Merge #6 first: it comes before this one in the stack.', code: 'STACK_ORDER' }]);
    assert.ok(!seen.some((s) => s.startsWith('pr merge')));
    persistPrState(prev.id, { url: PREV, number: 6, state: 'MERGED' });
    assert.equal((await post('/api/pr/merge', scope())).status, 200, 'once the predecessor merged');
  } finally { getDb().prepare('DELETE FROM scheduled_runs WHERE pipeline_id = ?').run(seeded.id); }
});

test('Merge PR: each refusal code with its status and message, and no gh pr merge before the host refuses', async () => {
  const cases = [
    [{ refuse: { 'pr view': 'boom' } }, 502, 'READ_FAILED', 'Could not read the pull request from GitHub.'],
    [{ mergeable: 'CONFLICTING' }, 409, 'CONFLICTS', 'GitHub reports merge conflicts on this pull request; fix them first.'],
    [{ checks: [failingCheck('unit', 11)] }, 409, 'CHECKS_FAILING', 'Some checks are failing on this pull request; fix them first.'],
    [{ checks: [{ name: 'unit', status: 'IN_PROGRESS', conclusion: null, runId: 11 }] }, 409, 'CHECKS_PENDING', 'The checks are still running; merge once they pass.'],
    [{ refuse: { 'pr merge': 'HTTP 401: Bad credentials (authentication)' } }, 409, 'AUTH', 'GitHub refused Worca\'s credentials for this merge.'],
    [{ refuse: { 'pr merge': 'API rate limit exceeded' } }, 429, 'RATE_LIMITED', 'GitHub is rate limiting Worca; try again in a minute.'],
    [{ refuse: { 'pr merge': 'Pull request is not mergeable: the base branch policy prohibits the merge' } }, 409, 'REFUSED',
      'GitHub refused the merge: Pull request is not mergeable: the base branch policy prohibits the merge'],
  ];
  for (const [over, status, code, error] of cases) {
    fakeGh(over);
    const r = await post('/api/pr/merge', scope());
    assert.deepEqual([r.status, await r.json()], [status, { error, code }], code);
    assert.equal(readPrState(seeded.id).state, 'OPEN', `${code}: nothing persisted`);
    if (!['AUTH', 'RATE_LIMITED', 'REFUSED'].includes(code)) assert.ok(!seen.some((s) => s.startsWith('pr merge')), code);
  }
  setWatch({ prUrl: GH, pipelineId: seeded.id, enabled: false });
  updateWatch(GH, { status: 'fixing' });
  fakeGh();
  const r = await post('/api/pr/merge', scope());
  assert.deepEqual([r.status, (await r.json()).code], [409, 'BUSY']);
});

test('Re-run checks: one gh run rerun --failed per failing workflow run, no fix run; its refusals', async () => {
  fakeGh({ checks: [failingCheck('unit', 11), failingCheck('lint', 11), failingCheck('e2e', 12), { name: 'ok', status: 'COMPLETED', conclusion: 'SUCCESS', runId: 13 }] });
  let r = await post('/api/pr/rerun-checks', scope());
  assert.deepEqual([r.status, await r.json()], [200, { rerun: 2, failed: 0 }]);
  assert.deepEqual(seen.filter((s) => s.startsWith('run rerun')), ['run rerun 11 --failed --repo me/repo', 'run rerun 12 --failed --repo me/repo']);
  assert.equal(getWatch(GH), null, 'no watch row, no fix run');

  fakeGh();
  r = await post('/api/pr/rerun-checks', scope());
  assert.deepEqual([r.status, (await r.json()).code], [409, 'NO_FAILING_CHECKS']);
  fakeGh({ checks: [failingCheck('unit', 11)], refuse: { 'run rerun': 'HTTP 403: Resource not accessible by integration' } });
  r = await post('/api/pr/rerun-checks', scope());
  assert.deepEqual([r.status, (await r.json()).code], [409, 'AUTH']);
  fakeGh({ checks: [failingCheck('unit', 11)], refuse: { 'run rerun': 'run 11 cannot be rerun; it is too old' } });
  r = await post('/api/pr/rerun-checks', scope());
  assert.deepEqual([r.status, await r.json()], [502, { error: 'GitHub did not re-run any of the failing checks.', code: 'RERUN_FAILED' }]);
  fakeGh({ refuse: { 'api graphql': 'boom' } });
  r = await post('/api/pr/rerun-checks', scope());
  assert.deepEqual([r.status, (await r.json()).code], [502, 'READ_FAILED']);
});

test('Re-run checks on Bitbucket is 409 RERUN_UNSUPPORTED', async () => {
  persistPrState(seeded.id, { url: 'https://bitbucket.org/ws/repo/pull-requests/4', number: 4, state: 'OPEN' });
  const r = await post('/api/pr/rerun-checks', scope());
  assert.deepEqual([r.status, await r.json()], [409, { error: 'Bitbucket checks cannot be re-run from Worca.', code: 'RERUN_UNSUPPORTED' }]);
});

test('Fix checks: BUSY while a fix runs, NO_FAILING_CHECKS when none fail; a refusal starts no run', async () => {
  let r = await post('/api/pr/fix-checks', scope());
  let out = await r.json();
  assert.deepEqual([r.status, out.code, out.error], [409, 'NO_FAILING_CHECKS', 'GitHub reports no failing checks on this pull request now.']);
  assert.equal(getWatch(GH).fixRuns, 0, 'nothing counted');
  updateWatch(GH, { status: 'fixing' });
  fakeGh({ checks: [failingCheck('unit', 11)] });
  r = await post('/api/pr/fix-checks', scope());
  out = await r.json();
  assert.deepEqual([r.status, out.code, out.watch.status], [409, 'BUSY', 'fixing']);
});

test('Merge PR: a head that moved after the checks were read is refused HEAD_MOVED and nothing is persisted', async () => {
  fakeGh({ refuse: { 'pr merge': 'GraphQL: Head branch was modified. Review and try the merge again. (mergePullRequest)' } });
  const r = await post('/api/pr/merge', scope());
  const out = await r.json();
  assert.deepEqual([r.status, out.code], [409, 'HEAD_MOVED'], JSON.stringify(out));
  assert.equal(readPrState(seeded.id).state, 'OPEN');
  assert.ok(!seen.some((x) => x.startsWith('pr edit')), 'no successor is retargeted');
});

test('Merge PR: a second press while the first merge is out answers BUSY and sends one gh pr merge', async () => {
  let release; fakeGh({ hold: new Promise((r) => { release = r; }) });
  const first = post('/api/pr/merge', scope());
  for (let i = 0; i < 200 && !seen.some((x) => x.startsWith('pr merge')); i++) await new Promise((r) => setTimeout(r, 5));
  const second = await post('/api/pr/merge', scope());
  assert.deepEqual([second.status, (await second.json()).code], [409, 'BUSY']);
  const fix = await post('/api/pr/fix-checks', scope());
  assert.deepEqual([fix.status, (await fix.json()).code], [409, 'BUSY'], 'Fix checks waits for the merge in flight');
  assert.equal(getWatch(GH)?.fixRuns || 0, 0, 'no fix run');
  release();
  assert.equal((await first).status, 200);
  assert.equal(seen.filter((x) => x.startsWith('pr merge')).length, 1);
});

test('Merge PR: a head SHA that could not be read is READ_FAILED, never an unpinned merge', async () => {
  fakeGh({ noHead: true });
  const r = await post('/api/pr/merge', scope());
  assert.deepEqual([r.status, (await r.json()).code], [502, 'READ_FAILED']);
  assert.ok(!seen.some((x) => x.startsWith('pr merge')), 'no gh pr merge');
});
