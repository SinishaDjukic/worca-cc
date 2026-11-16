// test/stillhet-task-live.test.mjs — ui/public/stillhet/live/task-live.mjs: the task page's load states, the one checks
// cache (D5), the shared action path (D13) and its refusals. In-process, with a fake fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTaskLive, TASK_ACTIONS, CHECKS_FRESH_MS, capOf } from '../ui/public/stillhet/live/task-live.mjs';
import { caseOf } from '../ui/public/stillhet/live/live-map.mjs';
import { TASK_DETAILS, PR_URL } from './helpers/stillhet-live-fixture.mjs';

const settle = (ms = 5) => new Promise((r) => setTimeout(r, ms));
function host({ routes = {}, loaded = true, live = {}, rows = {}, clock = { t: 1_000_000 }, flags = {}, scopes = {} } = {}) {
  const calls = [], toasts = [];
  const fetch = async (url, init = {}) => {
    calls.push([init.method || 'GET', url, init.body ? JSON.parse(init.body) : undefined]);
    for (const [re, answer] of Object.entries(routes)) {
      if (new RegExp(re).test(`${init.method || 'GET'} ${url}`)) {
        const [status, data] = typeof answer === 'function' ? await answer(url, init) : answer;
        if (status === 0) throw new Error('Failed to fetch');
        return { ok: status < 400, status, json: async () => data, text: async () => (typeof data === 'string' ? data : JSON.stringify(data)) };
      }
    }
    return { ok: false, status: 404, json: async () => ({ error: 'not found' }) };
  };
  const t = startTaskLive({ fetch, toast: (s) => toasts.push(s), now: () => clock.t, listLoaded: () => loaded, flag: (k) => !!flags[k],
    rowOf: (id) => rows[id] || null, liveOf: (id) => live[id] || null,
    runOf: (id) => (rows[id] ? (scopes[id] || { pipelineId: id, projectKey: 'web-1', projectDir: '/src/web', prState: 'OPEN' }) : {}) });   // dev's history row says its PR is open (F-G-G1-01)
  return { t, calls, toasts, clock };
}
const failedRow = { ...TASK_DETAILS.failed.row };
const approvedRow = { ...TASK_DETAILS.approved.row };

test('open: loading, then ready; a 500 is failed and Try again with a 200 is ready; a 404 is gone; unknown ids are gone', async () => {
  let fail = true;
  const { t } = host({ rows: { h3: failedRow }, routes: { 'GET /api/history/web-1/h3': () => (fail ? [500, { error: 'boom' }] : [200, { state: TASK_DETAILS.failed.state }]) } });
  const p = t.open('h3');
  assert.equal(t.state('h3'), 'loading');
  await p;
  assert.equal(t.state('h3'), 'failed');
  fail = false;
  await t.open('h3');
  assert.equal(t.state('h3'), 'ready');
  assert.equal(t.detail('h3').failure.head, 'Build · 3 tests failed', 'the failure is the page\'s What broke, never its head (D9)');
  const g = host({ rows: { h9: { id: 'h9', case: 'stopped' } }, routes: { 'GET /api/history/': [404, { error: 'pipeline not found' }] } });
  await g.t.open('h9');
  assert.equal(g.t.state('h9'), 'gone');
  await g.t.open('nope');
  assert.equal(g.t.state('nope'), 'gone');
});

test('a deep link before the first list load stays loading; a live run with no history row draws from its frames', async () => {
  const a = host({ loaded: false, rows: { h3: failedRow } });
  const heard = []; a.t.onChange((x) => heard.push(x));
  await a.t.open('h3'); await a.t.open('h3');
  assert.equal(a.t.state('h3'), 'loading');
  assert.deepEqual(heard, [], 'still loading is no change: a listener that routes again on a change cannot loop (cold deep link)');
  assert.deepEqual(a.calls, [], 'nothing is read before the list');
  const live = { 'run-a': { runId: 'run-a', pipelineId: 'pa', status: 'running', state: { branch: { feature: 'feat/ask', source: 'dev' } }, pendingQuestion: { id: 'q-plan', kind: 'plan' } } };
  const b = host({ live, routes: { 'GET /api/history/': [404, {}] } });
  await b.t.open('run-a');
  assert.equal(b.t.state('run-a'), 'ready');
  assert.equal(b.t.card('run-a').branch, 'feat/ask');
  assert.equal(b.t.resolve('run-a').pipelineId, 'pa', 'a resumed run resolves through its pipeline id too');
});

test('a deep link whose list failed to load reads failed, not loading; Try again reloads the list and says so', async () => {
  let loaded = false, failed = true, retries = 0;
  const heard = [];
  const t = startTaskLive({ fetch: async () => ({ ok: true, status: 200, json: async () => ({ state: TASK_DETAILS.failed.state }) }),
    listLoaded: () => loaded, listFailed: () => failed, rowOf: (id) => (id === 'h3' ? failedRow : null),
    runOf: () => ({ pipelineId: 'h3', projectKey: 'web-1' }),
    retryList: async () => { retries++; failed = false; assert.equal(t.state('h3'), 'loading', 'loading while the list is read again'); await null; loaded = true; } });
  t.onChange((x) => heard.push(x));
  await t.open('h3');
  assert.equal(t.state('h3'), 'failed', 'the list never came: the page can say so and offer Try again');
  assert.equal(retries, 0, 'a plain open does not read the list again');
  t.listChanged();
  assert.ok(heard.includes(null), 'a list load that failed tells the page');
  await t.open('h3', { force: true });
  assert.equal(retries, 1, 'Try again reads the list again');
  await t.open('h3');
  assert.equal(t.state('h3'), 'ready');
});

test('one checks entry feeds the row, the card and the page; it is fresh for 60 s; a pr-watch-changed frame refetches it', async () => {
  let reads = 0;
  const { t, clock } = host({ rows: { h2: approvedRow }, routes: {
    'GET /api/history/web-1/h2': [200, { state: TASK_DETAILS.approved.state }],
    'GET /api/pr/checks': () => { reads++; return [200, TASK_DETAILS.approved.checks]; } } });
  await t.open('h2'); await settle();
  const entry = t.checks('h2');
  assert.equal(caseOf({ kind: 'hist', status: 'done', pr: { url: PR_URL, state: 'OPEN' } }, { checks: entry }), 'approved', 'the row');
  assert.equal(t.card('h2').case, 'approved', 'the card');
  assert.equal(t.detail('h2').case, 'approved', 'the page');
  const n = reads;
  t.checks('h2'); await settle();
  assert.equal(reads, n, 'fresh: no second read');
  clock.t += CHECKS_FRESH_MS; t.checks('h2'); await settle();
  assert.equal(reads, n + 1, 'stale after 60 s');
  t.frame({ type: 'pr-watch-changed', pipelineId: 'h2' }); t.checks('h2'); await settle();
  assert.equal(reads, n + 2, 'a pr-watch-changed frame drops it');
});

test('at most two checks reads in flight', async () => {
  let open = 0, most = 0; const rows = {};
  for (let i = 0; i < 5; i++) rows[`p${i}`] = { id: `p${i}`, case: 'checks', pr: `https://github.com/a/b/pull/${i + 1}` };
  const { t } = host({ rows, routes: { 'GET /api/pr/checks': async () => { open++; most = Math.max(most, open); await settle(10); open--; return [200, { checks: { state: 'pending' } }]; } } });
  await Promise.all(Object.keys(rows).map((id) => t.refreshChecks(id)));
  assert.equal(most, 2);
});

test('act: each id\'s route and body; a second press is refused; a refusal says Could not ACTION: REASON once', async () => {
  let release;
  const { t, calls, toasts } = host({ rows: { h2: approvedRow }, routes: {
    'POST /api/pr/merge': () => new Promise((r) => { release = () => r([409, { error: 'GitHub reports merge conflicts on this pull request; fix them first.', code: 'CONFLICTS' }]); }) } });
  const first = t.act('merge', { taskId: 'h2', pr: PR_URL });
  const second = await t.act('merge', { taskId: 'h2', pr: PR_URL });
  assert.deepEqual([second.ok, second.error], [false, 'it is already on its way']);
  release();
  const res = await first;
  assert.equal(res.ok, false);
  assert.deepEqual(calls.filter(([m]) => m === 'POST'), [['POST', '/api/pr/merge', { id: 'h2', projectKey: 'web-1' }]]);
  assert.deepEqual(toasts, ['Could not merge #959: it is already on its way', 'Could not merge #959: GitHub reports merge conflicts on this pull request; fix them first.']);
  const draft = host({ rows: { h2: approvedRow }, routes: { 'POST /api/pr/merge': [409, { error: 'This pull request is a draft; mark it ready for review first.', code: 'DRAFT' }] } });
  await draft.t.act('merge', { taskId: 'h2', pr: PR_URL });
  assert.deepEqual(draft.toasts, ['Could not merge #959: This pull request is a draft; mark it ready for review first.'], 'the server\'s own refusal words');
  assert.equal(Object.keys(TASK_ACTIONS).length, 34, 'the ten Step 7 actions and the page\'s Resume (F-G-G2-03), the page\'s Check out, Apply and Discard, and its Terminal, service start and stop, built-in tool, preset, Switch model, Resume at…, Publish branch, away mode, a diff comment, labels and cost tags, a stack\'s start and stop, a group\'s Create PR, a review gate\'s two answers, and COV-3\'s restore, run direction and Resume on ‹Engine›');
});

test('retry on a moved base is a prompt, not a refusal; Resume anyway posts baseAck', async () => {
  let n = 0;
  const { t, calls, toasts } = host({ rows: { h3: failedRow }, routes: { 'POST /api/resume': () => (++n === 1 ? [409, { error: 'the base moved', code: 'base-moved' }] : [200, { ok: true, runId: 'r2' }]) } });
  const r = await t.act('retry', { taskId: 'h3' });
  assert.deepEqual([r.ok, r.prompt], [false, 'base']);
  assert.deepEqual(toasts, []);
  assert.equal((await t.act('retry', { taskId: 'h3', baseAck: true })).ok, true);
  assert.deepEqual(calls.filter(([m]) => m === 'POST').map((c) => c[2]), [{ pipelineId: 'h3', baseCheck: true }, { pipelineId: 'h3', baseCheck: true, baseAck: true }]);
});

test('report: the reason follows the task; GitHub not filing opens the prefilled issue', async () => {
  const opened = [];
  const calls = [];
  const r2 = startTaskLive({ fetch: async (u, i) => { calls.push([i.method, u, JSON.parse(i.body)]); return { ok: true, status: 200, json: async () => ({ ok: false, issue: { url: 'https://github.com/w/w/issues/new' } }) }; },
    open: (u) => { opened.push(u); return {}; }, rowOf: () => failedRow, runOf: () => ({ pipelineId: 'h3', projectKey: 'web-1' }) });
  const res = await r2.act('report', { taskId: 'h3', value: 'It hung' });
  assert.deepEqual([res.ok, res.say], [true, 'Opened the issue form on GitHub']);
  assert.deepEqual(calls.at(-1)[2], { reason: 'failed-or-stuck', expectation: 'It hung' });
  assert.deepEqual(opened, ['https://github.com/w/w/issues/new']);
});

test('a checks reply asked for before an invalidation never overwrites the newer read', async () => {
  const replies = [];
  const { t } = host({ rows: { h2: approvedRow }, routes: { 'GET /api/pr/checks': () => new Promise((r) => replies.push(r)) } });
  t.refreshChecks('h2'); await settle();
  t.frame({ type: 'pr-watch-changed', pipelineId: 'h2' });
  t.refreshChecks('h2'); await settle();
  assert.equal(replies.length, 2);
  replies[1]([200, { checks: { state: 'failing' }, mergeable: 'MERGEABLE' }]); await settle();
  replies[0]([200, { checks: { state: 'passing' }, mergeable: 'MERGEABLE' }]); await settle();
  assert.equal(t.checks('h2').checks.state, 'failing', 'the older reply is dropped');
});

test('a resume keeps the task: its new run id and the run id it superseded both resolve to the pipeline', async () => {
  const live = { 'run-old': { runId: 'run-old', pipelineId: 'h1', status: 'paused', state: {} } };
  const { t } = host({ live, rows: { h1: { id: 'h1', case: 'capped' } }, routes: { 'POST /api/resume': [200, { ok: true, runId: 'run-new' }] } });
  assert.equal(t.resolve('run-old').pipelineId, 'h1');
  assert.equal((await t.act('raise-cap', { taskId: 'run-old', value: '$180' })).ok, true);
  delete live['run-old'];   // the adapter drops the superseded run
  assert.equal(t.resolve('run-old')?.pipelineId, 'h1', 'the old run id still finds its task');
  assert.equal(t.resolve('run-new')?.pipelineId, 'h1', 'and so does the new one, before its first frame');
});

test('Raise the cap reads dollars as typed: "$180" posts 180; a value that is not money is refused before any post', async () => {
  assert.deepEqual(['$180', '1,200', ' 99.5 ', '$', 'abc', '-5', '12e3'].map(capOf), [180, 1200, 99.5, NaN, NaN, NaN, NaN]);
  const { t, calls, toasts } = host({ rows: { h1: { id: 'h1', case: 'capped' } }, routes: { 'POST /api/resume': [200, { ok: true, runId: 'r2' }] } });
  assert.equal((await t.act('raise-cap', { taskId: 'h1', value: '$180' })).ok, true);
  assert.deepEqual(calls.filter(([m]) => m === 'POST').map((c) => c[2]), [{ pipelineId: 'h1', baseCheck: true, costCapUsd: 180 }]);
  const bad = await t.act('raise-cap', { taskId: 'h1', value: 'a lot' });
  assert.equal(bad.ok, false);
  assert.equal(calls.filter(([m]) => m === 'POST').length, 1, 'nothing posted');
  assert.deepEqual(toasts, ['Could not raise the cap: write the new cap in dollars, like $180']);
});

test('canFlow: Re-run checks needs a PR, and never on Bitbucket', () => {
  const { t } = host();
  assert.equal(t.canFlow('Re-run checks', {}), false);
  assert.equal(t.canFlow('Re-run checks', { pr: PR_URL }), true);
  assert.equal(t.canFlow('Re-run checks', { pr: 'https://bitbucket.org/a/b/pull-requests/1' }), false);
  for (const label of ['Merge PR', 'Merge', 'Fix checks']) {
    assert.equal(t.canFlow(label, {}), false, `${label} is never offered without a PR`);
    assert.equal(t.canFlow(label, { pr: PR_URL }), true, label);
  }
  assert.equal(t.canFlow('Discard', { case: 'ready' }), false, 'Discard elsewhere is not dev\'s discard-worktree');
  assert.equal(t.canFlow('Discard', { case: 'failed-kept' }), true);
  assert.equal(t.canFlow('Ask for changes', { case: 'plan' }), true);
  assert.equal(t.canFlow('Ask for changes', { case: 'ready' }), false);
  assert.equal(t.canFlow('Check out', {}), true);
});

test('the page\'s own tools: Check out, Apply to branch and Discard post dev\'s run routes with the scope in the query', async () => {
  const { t, calls } = host({ rows: { h1: failedRow }, routes: {
    'POST /api/runs/h1/checkout': [200, { members: [{ projectKey: 'web-1', worktreeDir: '/w/h1', branch: 'worca-cc/pager', state: 'checked-out' }] }],
    'POST /api/runs/h1/apply-retained': [200, { applied: ['web-1'], failed: [] }],
    'POST /api/runs/h1/discard-worktree': [409, { error: 'cannot discard a running pipeline worktree' }] } });
  const co = await t.flow('Check out', { taskId: 'h1' });
  assert.deepEqual([co.ok, co.say], [true, 'Checked out worca-cc/pager at /w/h1']);
  assert.equal((await t.flow('Apply to branch', { taskId: 'h1' })).ok, true);
  const dis = await t.flow('Discard', { taskId: 'h1', quiet: true });
  assert.deepEqual([dis.ok, dis.error], [false, 'cannot discard a running pipeline worktree']);
  assert.deepEqual(calls.filter(([m]) => m === 'POST').map(([m, u]) => `${m} ${u}`), [
    'POST /api/runs/h1/checkout?projectKey=web-1', 'POST /api/runs/h1/apply-retained?projectKey=web-1', 'POST /api/runs/h1/discard-worktree?projectKey=web-1']);
});

test('Ask for changes on a plan sends Chat\'s plan-changes with what was written; an empty note posts nothing', async () => {
  const sent = [];
  const t = startTaskLive({ fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }), listLoaded: () => true,
    liveOf: (id) => (id === 'r1' ? { runId: 'r1', pipelineId: 'p1', projectKey: 'web-1', pendingQuestion: { id: 'q1', kind: 'plan' }, state: {} } : null),
    chat: { act: async (id, a) => { sent.push([id, a]); return { ok: true }; } } });
  assert.equal((await t.flow('Ask for changes', { taskId: 'r1', value: '  ', quiet: true })).ok, false);
  assert.equal((await t.flow('Ask for changes', { taskId: 'r1', value: 'Split the pager out' })).ok, true);
  assert.deepEqual(sent, [['plan-changes', { runId: 'r1', id: 'q1', feedback: 'Split the pager out', key: 'plan-changes:r1' }]]);
});

test('a task deleted here, or whose row leaves the store, is gone even after its page was read', async () => {
  const rows = { h1: failedRow, h2: approvedRow };
  const { t } = host({ rows, routes: { 'GET /api/history/': [200, { state: TASK_DETAILS.failed.state }], 'POST /api/runs/bulk': [200, { done: [{ pipelineId: 'h1' }], skipped: [] }] } });
  await t.open('h1'); await t.open('h2');
  assert.deepEqual([t.state('h1'), t.state('h2')], ['ready', 'ready']);
  const seen = []; t.onChange((x) => seen.push(x));
  assert.equal((await t.list('delete', { ids: ['h1'] })).ok, true);
  assert.ok(seen.includes('h1'), 'the open page hears of it');
  delete rows.h1; delete rows.h2;                     // the store dropped both rows
  assert.deepEqual([t.state('h1'), t.state('h2')], ['gone', 'gone']);
});

test('a bulk answer that did nothing is a refusal: no row done, no schedule cancelled (code review r9)', async () => {
  let answer = { done: [], skipped: [], cancelled: [] };
  const { t } = host({ rows: { h1: failedRow }, routes: { 'POST /api/runs/bulk': () => [200, answer] } });
  let r = await t.list('archive', { ids: ['h1'], quiet: true });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'nothing changed');
  answer = { done: [], skipped: [{ pipelineId: 'h1', reason: 'it is running' }], cancelled: [] };
  r = await t.list('archive', { ids: ['h1'], quiet: true });
  assert.deepEqual([r.ok, r.error], [false, 'it is running']);
  answer = { done: [], skipped: [], cancelled: [{ id: 't1' }] };
  assert.equal((await t.list('archive', { ids: ['h1'], quiet: true })).ok, true, 'a cancelled schedule is something done');
});

test('a workspace task\'s Check out, Apply and Discard send workspaceId, as dev\'s run page scopes it', async () => {
  const calls = [];
  const t = startTaskLive({ fetch: async (url, init = {}) => { calls.push(`${init.method || 'GET'} ${url}`); return { ok: true, status: 200, json: async () => ({}) }; },
    listLoaded: () => true, rowOf: (id) => (id === 'w1' ? { id: 'w1', case: 'kept' } : null),
    runOf: (id) => (id === 'w1' ? { pipelineId: 'w1', projectKey: 'workspaces/ws-9', projectDir: '' } : {}) });
  for (const label of ['Check out', 'Apply to branch', 'Discard']) await t.flow(label, { taskId: 'w1', case: 'kept' });
  assert.deepEqual(calls.filter((c) => c.startsWith('POST')), ['POST /api/runs/w1/checkout?workspaceId=ws-9',
    'POST /api/runs/w1/apply-retained?workspaceId=ws-9', 'POST /api/runs/w1/discard-worktree?workspaceId=ws-9']);
});

test('a failed re-read of a page already drawn keeps its state and detail, and says Could not read the task again once', async () => {
  let fail = false;
  const live = { 'run-a': { runId: 'run-a', pipelineId: 'pa', projectKey: 'web-1', status: 'running', state: {} } };
  for (const [id, opts] of [['h3', { rows: { h3: failedRow } }], ['run-a', { live }]]) {
    const { t, toasts } = host({ ...opts, routes: { 'GET /api/history/': () => (fail ? [500, { error: 'boom' }] : [200, { state: TASK_DETAILS.failed.state }]) } });
    fail = false; await t.open(id);
    assert.equal(t.state(id), 'ready');
    const before = JSON.stringify(t.detail(id));
    fail = true; const x = await t.open(id, { force: true });
    assert.equal(t.state(id), 'ready', `${id}: still drawn`);
    assert.equal(x.state, 'failed', `${id}: the caller hears the read failed`);
    assert.equal(JSON.stringify(t.detail(id)), before, `${id}: the page model is unchanged`);
    assert.deepEqual(toasts.filter((s) => /^Could not/.test(s)), ['Could not read the task again: boom']);
  }
});

test('a live run\'s empty frame fields (no branch, no cost, no steps yet) never hide what dev saved; its store row is found by its run id', async () => {
  const { t } = host({ rows: { 'run-x': { ...failedRow, id: 'run-x', case: 'failed' } }, live: { h3: { runId: 'run-x', pipelineId: 'h3', projectKey: 'web-1', status: 'paused', state: { branch: null, totalCostUsd: null, steps: [] } } },
    routes: { 'GET /api/history/web-1/h3': [200, { state: TASK_DETAILS.failed.state }] } });
  await t.open('h3');
  const d = t.detail('h3');
  assert.equal(d.branch, 'chore/node-24');
  assert.equal(d.cost, 4.2);
  assert.equal(d.stages[1].state, 'failed', 'the saved steps still draw its stages');
  assert.equal(d.case, 'failed', 'the case is its store row\'s, found through its live run');
});

// a workspace task: its saved run lives under dev's workspace routes, and its project-scoped actions name the member
function wsHost({ projects = [{ projectKey: 'api-1', projectName: 'api' }], branches = null, answer = () => [200, {}] } = {}) {
  // dev's workspace state: each Git project's branch record carries its feature branch (src/core/workspace-prs.mjs)
  const br = branches || Object.fromEntries(projects.filter((p) => p.workMode !== 'folder').map((p) => [p.projectKey, { feature: `feat/${p.projectKey}`, source: 'dev' }]));
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push([init.method || 'GET', url, init.body ? JSON.parse(init.body) : undefined]);
    const [status, data] = /^\/api\/workspaces\/ws-9\/runs\/w1$/.test(url) ? [200, { state: { status: 'done', projects, branches: br } }] : answer(url, init);
    return { ok: status < 400, status, json: async () => data, text: async () => (typeof data === 'string' ? data : JSON.stringify(data)) };
  };
  const t = startTaskLive({ fetch, listLoaded: () => true, rowOf: (id) => (id === 'w1' ? { id: 'w1', case: 'approved', pr: PR_URL } : null),
    runOf: (id) => (id === 'w1' ? { pipelineId: 'w1', projectKey: 'workspaces/ws-9', projectDir: '', prState: 'OPEN' } : {}) });
  return { t, calls };
}

test('a workspace task reads its page, diff, log and comments from dev\'s workspace routes, and comments name the member', async () => {
  const { t, calls } = wsHost({ answer: (url) => (/\/diff$/.test(url) ? [200, '# api-1\ndiff --git a/x.js b/x.js\n@@ -1,1 +1,2 @@\n a\n+b\n'] : [200, {}]) });
  await t.open('w1'); await settle(20);
  assert.equal(t.state('w1'), 'ready', 'never "This task no longer exists"');
  const gets = calls.filter((c) => c[0] === 'GET').map((c) => c[1]);
  for (const u of ['/api/workspaces/ws-9/runs/w1', '/api/workspaces/ws-9/runs/w1/diff', '/api/workspaces/ws-9/runs/w1/log', '/api/workspaces/ws-9/runs/w1/comments']) assert.ok(gets.includes(u), u);
  assert.ok(!gets.some((u) => u.startsWith('/api/history/')), 'no History read for a workspace key');
  assert.equal(t.parts('w1').changes.fileMeta['api-1/x.js'].member, 'api-1', 'the patch names the file\'s project');
  assert.deepEqual(t.parts('w1').changes.hunks['api-1/x.js'].lines.map((r) => r[1]), ['a', 'b'], 'the member line is not a diff row');
  await t.act('comment', { taskId: 'w1', path: 'x.js', side: 'new', line: 2, member: 'api-1', value: 'why?' });
  assert.deepEqual(calls.find((c) => c[0] === 'POST'), ['POST', '/api/workspaces/ws-9/runs/w1/comments', { project: 'api-1', path: 'x.js', side: 'new', line: 2, body: 'why?' }]);
});

test('a workspace task\'s Publish, PR routes and checks carry its member; with several projects Publish goes per project and PR actions are not offered', async () => {
  const one = wsHost();
  await one.t.open('w1'); await settle(20);
  assert.ok(one.calls.some(([m, u]) => m === 'GET' && u === `/api/pr/checks?id=w1&projectKey=workspaces%2Fws-9&memberKey=api-1`), 'the checks read names the member');
  await one.t.act('publish', { taskId: 'w1' });
  await one.t.act('merge', { taskId: 'w1', key: 'm1' });
  const posts = one.calls.filter((c) => c[0] === 'POST');
  assert.deepEqual(posts[0][2], { projectKey: 'workspaces/ws-9', memberKey: 'api-1' });
  assert.deepEqual(posts[1].slice(1), ['/api/pr/merge', { id: 'w1', projectKey: 'workspaces/ws-9', memberKey: 'api-1' }]);
  await one.t.act('terminal', { taskId: 'w1' });
  assert.deepEqual(one.calls.at(-1).slice(1), ['/api/runs/w1/terminal?workspaceId=ws-9', { member: 'api-1' }], 'its one project is the shell\'s');

  const two = wsHost({ projects: [{ projectKey: 'api-1', projectName: 'api' }, { projectKey: 'web-1', projectName: 'web' }, { projectKey: 'docs', projectName: 'docs', workMode: 'folder' }] });
  await two.t.open('w1'); await settle(20);
  assert.ok(!two.calls.some(([, u]) => u.startsWith('/api/pr/checks')), 'no checks read without its member');
  assert.equal(two.t.canFlow('Merge PR', { pr: PR_URL, page: true, taskId: 'w1' }), false, 'a PR per project: not one Merge');
  assert.deepEqual(two.t.members('w1').map((m) => m.name), ['api', 'web', 'docs'], 'Terminal\'s member pick');
  const r = await two.t.act('publish', { taskId: 'w1' });
  assert.equal(r.say, 'Published 2 branches');
  assert.deepEqual(two.calls.filter((c) => c[0] === 'POST').map((c) => c[2].memberKey), ['api-1', 'web-1'], 'each Git project, never the Folder one');
  const m = await two.t.act('merge', { taskId: 'w1', quiet: true });
  assert.equal(m.ok, false);
  assert.equal(two.calls.filter((c) => c[1] === '/api/pr/merge').length, 0, 'never a memberless merge');
});

test('a workspace project with no feature branch counts for neither Publish nor the PR actions; a failed Publish names its project', async () => {
  // api-1 and web-1 are Git projects, but only api-1 made a branch: Publish is api-1's alone, and the PR is api-1's
  const one = wsHost({ projects: [{ projectKey: 'api-1', projectName: 'api' }, { projectKey: 'web-1', projectName: 'web' }], branches: { 'api-1': { feature: 'feat/x', source: 'dev' }, 'web-1': { source: 'dev' } } });
  await one.t.open('w1'); await settle(20);
  assert.equal(one.t.canFlow('Merge PR', { pr: PR_URL, page: true, taskId: 'w1' }), true, 'one project with a branch: its PR');
  await one.t.act('publish', { taskId: 'w1', quiet: true });
  assert.deepEqual(one.calls.filter((c) => c[0] === 'POST').map((c) => c[2].memberKey), ['api-1'], 'never the project with no branch');
  // two with branches, the second refuses: the refusal says whose, and what was published already
  const two = wsHost({ projects: [{ projectKey: 'api-1', projectName: 'api' }, { projectKey: 'web-1', projectName: 'web' }],
    answer: (url, init) => (init.method === 'POST' && JSON.parse(init.body).memberKey === 'web-1' ? [409, { error: 'no remote' }] : [200, { ok: true }]) });
  await two.t.open('w1'); await settle(20);
  const r = await two.t.act('publish', { taskId: 'w1', quiet: true });
  assert.equal(r.ok, false);
  assert.match(r.error, /^web: no remote; api was published$/);
  const none = wsHost({ projects: [{ projectKey: 'api-1', projectName: 'api' }], branches: {} });
  await none.t.open('w1'); await settle(20);
  const n = await none.t.act('publish', { taskId: 'w1', quiet: true });
  assert.equal(n.ok, false);
  assert.equal(none.calls.filter((c) => c[0] === 'POST').length, 0);
});

test('a saved tag or label change stays on the next redraw; a re-read that fails keeps the parts shown', async () => {
  let fail = false;
  const rows = { h3: { ...failedRow, labels: ['ui'] } };
  const { t } = host({ rows, routes: { 'GET /api/history/web-1/h3$': [200, { state: { ...TASK_DETAILS.failed.state, tags: ['team:web'], labels: ['ui'] } }],
    'GET /api/history/web-1/h3/log': () => (fail ? [500, { error: 'boom' }] : [200, {}]), 'PUT /api/runs/h3/': [200, {}],
    'GET /api/runs/h3/sessions': () => (fail ? [500, {}] : [200, { sessions: [{ sid: 's1', label: 'Plan' }] }]) } });
  await t.open('h3'); await settle(20);
  await t.act('tags', { taskId: 'h3', tags: ['team: api'] });
  await t.act('labels', { taskId: 'h3', labels: [] });
  assert.deepEqual(t.detail('h3').tags, ['team: api'], 'the saved tag, not the read one');
  assert.deepEqual(t.detail('h3').labels, [], 'the last label removed stays removed while the store row lags');
  rows.h3 = { ...rows.h3, labels: [] };
  assert.deepEqual(t.detail('h3').labels, []);
  assert.equal(t.parts('h3').sessions.length, 1);
  fail = true; t.loadParts('h3'); await settle(20);
  assert.equal(t.parts('h3').sessions.length, 1, 'a failed re-read never blanks what was shown');
});

test('a group\'s Create PR posts dev\'s ship (one or separate for a user group, stacked for a feature); a user group\'s One PR waits for dev\'s combine check', async () => {
  const groups = { groups: [{ id: 'g1', kind: 'user', title: 'Two', members: [{ pipelineId: 'h3', position: 1 }] }, { id: 'f1', kind: 'feature', title: 'Feat', members: [] }] };
  const { t, calls } = host({ rows: { h3: failedRow }, routes: { 'GET /api/run-groups$': [200, groups], 'GET /api/run-groups/g1/combine': [200, { oneOff: 'The runs conflict in a.js' }],
    'POST /api/run-groups/g1/ship': [200, { ok: true, prs: ['u1', 'u2'] }], 'POST /api/shape/features/f1/ship': [200, { ok: true, prs: ['u3'] }] } });
  await t.open('group:g1');
  assert.equal(t.group('g1').combine, null, 'checking');
  await settle(10);
  assert.equal(t.group('g1').combine, 'The runs conflict in a.js');
  assert.equal((await t.act('ship-group', { taskId: 'group:g1', groupId: 'g1', groupKind: 'Group', ship: 'separate' })).say, 'Created 2 PRs');
  assert.equal((await t.act('ship-group', { taskId: 'group:f1', groupId: 'f1', groupKind: 'Feature', ship: 'stacked' })).say, 'Created the PR');
  assert.deepEqual(calls.filter((c) => c[0] === 'POST').map((c) => [c[1], c[2]]), [['/api/run-groups/g1/ship', { mode: 'separate' }], ['/api/shape/features/f1/ship', { mode: 'stacked' }]]);
});

test('a re-planned feature\'s old id draws its newest group (dev\'s GET /api/shape/features/:id); an unknown one is gone', async () => {
  const { t } = host({ routes: { 'GET /api/run-groups$': [200, { groups: [{ id: 'f2', kind: 'feature', title: 'Newest', members: [] }] }],
    'GET /api/shape/features/f1': [200, { id: 'f2' }], 'GET /api/shape/features/zz': [404, {}] } });
  await t.open('group:f1');
  assert.equal(t.state('group:f1'), 'loading', 'asking dev where it went');
  await settle(10);
  assert.equal(t.state('group:f1'), 'ready');
  assert.equal(t.detail('group:f1').group.id, 'f2');
  t.state('group:zz'); await settle(10);
  assert.equal(t.state('group:zz'), 'gone');
});

test('a failed group load reads failed and is not asked again on every paint; Try again (open, force) asks once more (code review r9)', async () => {
  let fail = true;
  const { t, calls } = host({ routes: { 'GET /api/run-groups$': () => (fail ? [500, { error: 'boom' }] : [200, { groups: [{ id: 'g1', kind: 'feature', title: 'Feat', members: [] }] }]) } });
  const asks = () => calls.filter((c) => c[1] === '/api/run-groups').length;
  // the shell's route: read the state on every change, open while it reads loading
  t.onChange(() => { if (t.state('group:g1') === 'loading') t.open('group:g1'); });
  assert.equal(t.state('group:g1'), 'loading');
  assert.equal(asks(), 0, 'reading the state asks nothing');
  await t.open('group:g1'); await settle(10);
  assert.equal(t.state('group:g1'), 'failed');
  t.state('group:g1'); t.detail('group:g1'); t.groups(); await settle(10);
  assert.equal(asks(), 1, 'one ask, no loop');
  fail = false;
  await t.open('group:g1', { force: true }); await settle(10);
  assert.equal(asks(), 2);
  assert.equal(t.state('group:g1'), 'ready');
});

test('a round that ended reads its saved diff; a live or paused one its live patch, the saved diff only when that read fails (no 404 for a diff not saved yet); telemetry only with runTelemetry on; a removed run id leaves the cache', async () => {
  const gets = (calls) => calls.filter(([m]) => m === 'GET').map(([, u]) => u);
  const ended = { 'run-r': { runId: 'run-r', pipelineId: 'h3', status: 'done', projectKey: 'web-1', state: { branch: { feature: 'feat/x', source: 'dev' } } } };
  const a = host({ live: ended, rows: { 'run-r': failedRow }, routes: { 'GET /api/history/web-1/h3$': [200, { state: TASK_DETAILS.failed.state }] } });
  await a.t.open('run-r'); await settle(20);
  assert.ok(gets(a.calls).includes('/api/history/web-1/h3/diff'), 'a round that ended: the saved diff');
  assert.ok(!gets(a.calls).some((u) => /live-diff/.test(u)));
  const paused = { 'run-r': { ...ended['run-r'], status: 'paused' } };
  const p = host({ live: paused, rows: { 'run-r': failedRow }, routes: { 'GET /api/history/web-1/h3$': [200, { state: TASK_DETAILS.failed.state }], 'GET /api/runs/run-r/live-diff': [200, { patch: '' }] } });
  await p.t.open('run-r'); await settle(20);
  assert.ok(gets(p.calls).includes('/api/runs/run-r/live-diff'), 'a paused round: its live patch');
  assert.ok(!gets(p.calls).includes('/api/history/web-1/h3/diff'), 'an empty live patch is the answer: no saved diff is asked for (it would be a 404)');
  const gone = host({ live: paused, rows: { 'run-r': failedRow }, routes: { 'GET /api/history/web-1/h3$': [200, { state: TASK_DETAILS.failed.state }], 'GET /api/runs/run-r/live-diff': [404, { error: 'no worktree' }] } });
  await gone.t.open('run-r'); await settle(20);
  assert.ok(gets(gone.calls).includes('/api/history/web-1/h3/diff'), 'a live read that fails falls back to the saved diff');
  assert.ok(!gets(a.calls).some((u) => /\/telemetry$/.test(u)), 'runTelemetry off: no telemetry read (no 404 in the console)');
  const running = { 'run-r': { ...ended['run-r'], status: 'running' } };
  const b = host({ live: running, rows: { 'run-r': failedRow }, flags: { runTelemetry: true }, routes: { 'GET /api/history/web-1/h3$': [200, { state: TASK_DETAILS.failed.state }],
    'GET /api/runs/run-r/live-diff': [200, { patch: '' }] } });
  await b.t.open('run-r'); await settle(20);
  assert.ok(!gets(b.calls).includes('/api/history/web-1/h3/diff'), 'a running round with no changes yet asks for no saved diff');
  assert.ok(gets(b.calls).includes('/api/runs/h3/telemetry'), 'runTelemetry on: asked');
  assert.equal(b.t.state('run-r'), 'ready');
  const told = []; b.t.onChange((id) => told.push(id));
  b.t.frame({ type: 'pipelines-changed', removedRunIds: ['run-r'] });
  assert.notEqual(b.t.state('run-r'), 'ready', 'the page cache drops a removed run id: nothing drawn from it any more');
  assert.deepEqual(told, ['run-r'], 'an open page is told its run is gone');
});

test('a merge that succeeded drops the checks entry and reads no checks again', async () => {
  const { t, calls } = host({ rows: { h2: approvedRow }, routes: { 'GET /api/history/web-1/h2': [200, { state: TASK_DETAILS.approved.state }],
    'GET /api/pr/checks': [200, TASK_DETAILS.approved.checks], 'POST /api/pr/merge': [200, { merged: true, next: null }] } });
  await t.open('h2'); await settle();
  const before = calls.length;
  const res = await t.act('merge', { taskId: 'h2', pr: PR_URL }); await settle();
  assert.equal(res.ok, true);
  assert.deepEqual(calls.slice(before).filter(([, u]) => /\/api\/pr\/checks/.test(u)), [], 'a merged PR has no checks to read');
});

// B1.6 (#1318): a review gate's two answers, on dev's answer API (D2), only to the gate that is pending now (D3)
const GATE_Q = { id: 'gate-w5-3', kind: 'gate', wireId: 'w5', nodeId: 'n_rev', issues: [] };
const gateLive = (pendingQuestion, over = {}) => ({ 'run-g': { runId: 'run-g', pipelineId: 'pg', projectKey: 'web-1', status: 'running', state: {}, pendingQuestion, ...over } });

test('O1: Accept as is and Run another cycle post /api/answer with the pending gate\'s id and decision continue / another', async () => {
  const { t, calls } = host({ live: gateLive(GATE_Q), routes: { 'POST /api/answer': [200, { ok: true }] } });
  assert.equal((await t.flow('Accept as is', { taskId: 'run-g', questionId: 'stale-id' })).ok, true);
  assert.equal((await t.flow('Run another cycle', { taskId: 'run-g' })).ok, true);
  assert.deepEqual(calls.filter(([m]) => m === 'POST'), [
    ['POST', '/api/answer', { runId: 'run-g', id: 'gate-w5-3', payload: { decision: 'continue' } }],
    ['POST', '/api/answer', { runId: 'run-g', id: 'gate-w5-3', payload: { decision: 'another' } }]], 'the id is the pending gate\'s, never a caller\'s');
  // a double click sends one request
  const two = host({ live: gateLive(GATE_Q), routes: { 'POST /api/answer': [200, { ok: true }] } });
  await Promise.all([two.t.act('gate-continue', { taskId: 'run-g' }), two.t.act('gate-continue', { taskId: 'run-g' })]);
  assert.equal(two.calls.filter(([m]) => m === 'POST').length, 1);
  // dev's refusal is said once
  const bad = host({ live: gateLive(GATE_Q), routes: { 'POST /api/answer': [400, { error: 'unknown runId' }] } });
  const r = await bad.t.act('gate-another', { taskId: 'run-g' });
  assert.deepEqual([r.ok, bad.toasts.length], [false, 1]);
});

test('O1: with no pending gate (none, or a plan question) a gate action sends nothing and refuses', async () => {
  for (const pq of [null, { id: 'q-plan', kind: 'plan' }, { kind: 'gate', id: '' }]) {
    const { t, calls, toasts } = host({ live: gateLive(pq), routes: { 'POST /api/answer': [200, { ok: true }] } });
    const r = await t.flow('Accept as is', { taskId: 'run-g' });
    assert.deepEqual([r.ok, r.error], [false, 'the review is no longer waiting for you'], JSON.stringify(pq));
    assert.equal(calls.filter(([m]) => m === 'POST').length, 0, 'nothing posted');
    assert.equal(toasts.length, 1, 'said once');
  }
  // a saved task (no live run id) whose state still holds a gate: no answer
  const saved = host({ rows: { pg: { id: 'pg', case: 'question' } }, routes: { 'GET /api/history/web-1/pg': [200, { state: { status: 'paused', pendingQuestion: GATE_Q } }], 'POST /api/answer': [200, {}] } });
  await saved.t.open('pg');
  const r = await saved.t.act('gate-another', { taskId: 'pg', quiet: true });
  assert.deepEqual([r.ok, r.error], [false, 'the task is not running']);
  assert.equal(saved.calls.filter(([m]) => m === 'POST').length, 0);
});

test('O1: canFlow offers Accept as is and Run another cycle on the gate case only', () => {
  const { t } = host();
  for (const label of ['Accept as is', 'Run another cycle']) {
    assert.equal(t.canFlow(label, { case: 'gate' }), true, `${label} on the chat TaskCard (no page)`);
    assert.equal(t.canFlow(label, { case: 'gate', page: true }), true, label);
    for (const c of ['question', 'working', 'plan', 'paused', 'ready']) assert.equal(t.canFlow(label, { case: c, page: true }), false, `${label} on ${c}`);
  }
});

// B1.9 (#1329): a running task opened by its run id before the run names its pipeline (F-a1-09, F-a4-03)
const pidless = () => ({ 'run-c': { runId: 'run-c', pipelineId: '', status: 'running', state: {}, pendingQuestion: null } });
const pidRoutes = { 'GET /api/runs/run-c/live-diff': [200, { patch: '' }], 'GET /api/runs/pc/': [200, {}], 'GET /api/pipelines/pc/setup': [200, {}] };

test('F-a1-09: a running task opened by its run id before its pipeline id is known reads no pipeline route; learned() then reads its parts by the pipeline id, once', async () => {
  const gets = (calls) => calls.filter(([m]) => m === 'GET').map(([, u]) => u);
  const live = pidless();
  const { t, calls } = host({ live, routes: pidRoutes });
  await t.open('run-c'); await settle(20);
  assert.equal(t.state('run-c'), 'ready');
  assert.deepEqual(gets(calls), ['/api/runs/run-c/live-diff'], 'only the run-id route: no artifacts, setup, sessions or history keyed by the run id');
  assert.equal(t.parts('run-c').docs, null, 'not read yet, never [] from a failed read');
  assert.equal(t.detail('run-c').liveRunning, false, 'no Pause or Stop before the pipeline id is known');
  const heard = []; t.onChange((x) => heard.push(x));
  live['run-c'].pipelineId = 'pc';
  t.learned('run-c', 'pc'); t.learned('run-c', 'pc'); await settle(20);
  for (const u of ['/api/runs/pc/artifacts', '/api/pipelines/pc/setup', '/api/runs/pc/sessions']) assert.equal(gets(calls).filter((x) => x === u).length, 1, u);
  assert.ok(!gets(calls).some((u) => /\/(runs|pipelines)\/run-c\/(?!live-diff)/.test(u)), 'never the run id in place of the pipeline id');
  assert.ok(heard.includes('run-c'), 'the page hears it');
  assert.equal(t.detail('run-c').liveRunning, true, 'a running task whose pipeline is known is not over');
  t.learned('run-x', 'px');   // a task nobody opened: nothing
  // learned() while the first open is still loading: the parts are read with the pipeline id, once
  const live2 = pidless();
  const b = host({ live: live2, routes: pidRoutes });
  const p = b.t.open('run-c');
  live2['run-c'].pipelineId = 'pc';
  b.t.learned('run-c', 'pc');
  await p; await settle(20);
  assert.equal(gets(b.calls).filter((x) => x === '/api/runs/pc/artifacts').length, 1);
  assert.ok(!gets(b.calls).some((u) => /\/(runs|pipelines)\/run-c\/(?!live-diff)/.test(u)));
});

test('F-a1-09: before the pipeline id is known a pipeline-keyed action refuses with no request, its control is not offered; Pause and Stop are', async () => {
  const { t, calls, toasts } = host({ live: pidless(), routes: { ...pidRoutes, 'POST /api/pause': [200, { ok: true }] } });
  await t.open('run-c'); await settle(20);
  const before = calls.length;
  for (const id of ['labels', 'preset']) {
    const r = await t.act(id, { taskId: 'run-c', labels: ['x'], value: 'p' });
    assert.deepEqual([r.ok, r.error], [false, 'the task is still starting; try again in a moment'], id);
  }
  assert.equal(calls.length, before, 'nothing sent');
  assert.deepEqual(toasts, ['Could not change the labels: the task is still starting; try again in a moment', 'Could not save the preset: the task is still starting; try again in a moment']);
  assert.equal(t.canFlow('Save as preset', { page: true, taskId: 'run-c' }), false);
  assert.equal(t.canFlow('Report this task', { page: true, taskId: 'run-c' }), false);
  for (const label of ['Stop', 'Pause', 'Copy link', 'Pause after this step']) assert.equal(t.canFlow(label, { page: true, taskId: 'run-c' }), true, label);
  assert.equal((await t.act('pause-after-step', { taskId: 'run-c' })).ok, true);
  assert.deepEqual(calls.slice(before), [['POST', '/api/pause', { runId: 'run-c', afterStep: true }]]);
});

test('restartOff (F-a4-11): an errored task with no plan needs a plan; with one, nothing; a workspace task says its own reason; unknown until the read lands, and one read per task', async () => {
  const NEEDS = 'Needs a plan: this task saved none to build from';
  const arts = (calls, pid) => calls.filter((c) => c[1] === `/api/runs/${pid}/artifacts`).length;
  let release; const gate = new Promise((r) => { release = r; });
  const a = host({ rows: { h3: failedRow }, routes: { 'GET /api/history/web-1/h3$': [200, { state: TASK_DETAILS.failed.state }],
    'GET /api/runs/h3/artifacts': async () => { await gate; return [200, { runId: 'h3', artifacts: [{ kind: 'prompt', relPath: 'prompt.md' }], truncated: false }]; } } });
  await a.t.open('h3');
  assert.equal(a.t.restartOff('h3'), '', 'before the read lands, \'\': never disabled on an unknown');
  release(); await settle(20);
  assert.equal(a.t.restartOff('h3'), NEEDS);
  assert.equal(a.t.detail('h3').restartOff, NEEDS, 'the page reads it from detail');
  assert.equal(arts(a.calls, 'h3'), 1, 'loadParts\'s own read: none of its own');
  // with a plan: offered
  const b = host({ rows: { h3: failedRow }, routes: { 'GET /api/history/web-1/h3$': [200, { state: TASK_DETAILS.failed.state }], 'GET /api/runs/h3/artifacts': [200, { artifacts: [{ kind: 'plan', relPath: 'plan.md' }] }] } });
  await b.t.open('h3'); await settle(20);
  assert.equal(b.t.restartOff('h3'), '');
  // a failed read: unknown, offered
  const c = host({ rows: { h3: failedRow }, routes: { 'GET /api/history/web-1/h3$': [200, { state: TASK_DETAILS.failed.state }], 'GET /api/runs/h3/artifacts': [500, { error: 'boom' }] } });
  await c.t.open('h3'); await settle(20);
  assert.equal(c.t.restartOff('h3'), '');
  // a task that is not stopped or failed: nothing to say, nothing read
  const d = host({ rows: { h2: approvedRow } });
  assert.equal(d.t.restartOff('h2'), '');
  assert.equal(arts(d.calls, 'h2'), 0);
  // a card's task never opened (a live errored run): restartOff reads once itself and tells the card
  const live = { 'run-z': { runId: 'run-z', pipelineId: 'pz', projectKey: 'web-1', status: 'error' }, 'run-y': { runId: 'run-y', projectKey: 'web-1', status: 'error' } };
  const e = host({ live, routes: { 'GET /api/runs/pz/artifacts': [200, { artifacts: [] }] } });
  const told = []; e.t.onChange((x) => told.push(x));
  assert.equal(e.t.restartOff('run-z'), '');
  assert.equal(e.t.restartOff('run-z'), '', 'still reading');
  await settle(20);
  assert.equal(e.t.restartOff('run-z'), NEEDS);
  assert.ok(told.includes('run-z'), 'the card is told when the read lands');
  assert.equal(arts(e.calls, 'pz'), 1, 'one read per task');
  assert.equal(e.t.restartOff('run-y'), '', 'a run whose pipeline is not named yet: nothing (F-a1-09)');
  assert.ok(!e.calls.some((c) => /run-y/.test(c[1])), 'and nothing is read');
  // a chat card's saved task never opened: its store row's case says it failed, and it reads once itself
  const f = host({ rows: { h3: failedRow }, routes: { 'GET /api/runs/h3/artifacts': [200, { artifacts: [] }] } });
  assert.equal(f.t.restartOff('h3'), '');
  await settle(20);
  assert.equal(f.t.restartOff('h3'), NEEDS, 'the row\'s case stands in for a status not read yet');
  assert.ok(!f.calls.some((c) => c[1] === '/api/history/web-1/h3'), 'the page is not opened for it');
  // a workspace task: its own reason, before anything else, with no read
  const w = wsHost();
  assert.equal(w.t.restartOff('w1'), 'Not offered for a workspace task yet');
  assert.equal(w.calls.length, 0);
});

test('restartOff (F-a4-11 review): a round that ends drops the cached answer, so a task that ran again and saved a plan is offered again; a read in flight across the end lands on nothing', async () => {
  const NEEDS = 'Needs a plan: this task saved none to build from';
  let artifacts = [];
  const live = { 'run-z': { runId: 'run-z', pipelineId: 'pz', projectKey: 'web-1', status: 'error' } };
  const { t, calls } = host({ live, routes: { 'GET /api/runs/pz/artifacts': () => [200, { artifacts }] } });
  const arts = () => calls.filter((c) => c[1] === '/api/runs/pz/artifacts').length;
  t.restartOff('run-z'); await settle(20);
  assert.equal(t.restartOff('run-z'), NEEDS);
  // it continues on the same pipeline, writes a plan and fails again: the round's end frame drops the false
  artifacts = [{ kind: 'plan', relPath: 'plan.md' }];
  t.frame({ type: 'error', runId: 'run-z', pipelineId: 'pz' });
  assert.equal(t.restartOff('run-z'), '', 'unknown again: offered while it reads');
  await settle(20);
  assert.equal(t.restartOff('run-z'), '', 'it saved a plan: offered');
  assert.equal(arts(), 2, 'read once more, after the end');
  // a read started before a round ends lands on nothing: its stale answer is not kept
  let release; const gate = new Promise((r) => { release = r; });
  const b = host({ live, routes: { 'GET /api/runs/pz/artifacts': async () => { if (!release.done) { await gate; return [200, { artifacts: [] }]; } return [200, { artifacts: [{ kind: 'plan', relPath: 'plan.md' }] }]; } } });
  b.t.restartOff('run-z');
  b.t.frame({ type: 'done', runId: 'run-z', pipelineId: 'pz' });
  release.done = true; release(); await settle(20);
  assert.equal(b.t.restartOff('run-z'), '', 'the old read\'s false is not kept; a new read starts');
  await settle(20);
  assert.equal(b.t.restartOff('run-z'), '', 'the new read saw the plan');
});

test('F-3-11: the task page\'s log names each line\'s step from the task\'s workflow, even when the log was read before the state that names it', async () => {
  const named = { ...TASK_DETAILS.failed.state, stepper: { graph: { nodes: [{ id: 'n_plan', kind: 'agent', key: 'planner', label: 'Plan', progressStage: 'plan' }] } } };
  let state = { ...TASK_DETAILS.failed.state, stepper: undefined, steps: [] }, logReads = 0;
  // the log answers once; a later read fails, so the line shown after the state lands is the one read before it
  const { t } = host({ rows: { h3: failedRow }, routes: { 'GET /api/history/web-1/h3$': () => [200, { state }],
    'GET /api/history/web-1/h3/log': () => (logReads++ ? [500, { error: 'boom' }] : [200, JSON.stringify({ nodeId: 'n_plan', source: 'agent', text: 'planning' }) + '\n']) } });
  await t.open('h3'); await settle(20);
  assert.equal(t.parts('h3').log, t.parts('h3').log, 'a read does not rebuild the named log while the state stays');
  assert.equal(t.parts('h3').log[0].step, 'n_plan', 'the log landed while no state names the step yet: its id');
  state = named;
  await t.open('h3', { force: true }); await settle(20);
  assert.equal(logReads, 2);
  assert.equal(t.parts('h3').log[0].step, 'Plan', 'the state landed after the log: the workflow\'s label, not the node id');
});

// ---- COV-3: classic's run extras on the task page (restore per run, a run direction, Resume on ‹Engine›, an old link) ----
const archivedRow = { id: 'h7', case: 'ready', archived: true };
const writes = (calls) => calls.filter(([m]) => m !== 'GET');

test('COV-3 #3: restore posts the per-run route with classic\'s scope (project, workspace) and no body; offered only on an archived task', async () => {
  const { t, calls } = host({ rows: { h7: archivedRow, h3: failedRow }, routes: { 'POST /api/runs/h7/restore': [200, { ok: true }] } });
  assert.equal(t.canFlow('Restore', { taskId: 'h7', page: true }), true);
  assert.equal(t.canFlow('Restore', { taskId: 'h3', page: true }), false, 'a task that is not archived has nothing to restore');
  const r = await t.flow('Restore', { taskId: 'h7' });
  assert.equal(r.ok, true);
  assert.deepEqual(writes(calls), [['POST', '/api/runs/h7/restore?projectKey=web-1', undefined]]);
  const w = host({ rows: { h8: { id: 'h8', archived: true } }, scopes: { h8: { pipelineId: 'h8', projectKey: 'workspaces/ws1' } }, routes: { 'POST /api/runs/h8/restore': [200, { ok: true }] } });
  await w.t.flow('Restore', { taskId: 'h8' });
  assert.deepEqual(writes(w.calls), [['POST', '/api/runs/h8/restore?workspaceId=ws1', undefined]], 'a workspace row: its id without the workspaces/ prefix');
  const d = host({ rows: { h9: { id: 'h9', archived: true } }, scopes: { h9: { pipelineId: 'h9', projectDir: '/src/x' } }, routes: { 'POST /api/runs/h9/restore': [200, { ok: true }] } });
  await d.t.flow('Restore', { taskId: 'h9' });
  assert.deepEqual(writes(d.calls), [['POST', '/api/runs/h9/restore?projectDir=%2Fsrc%2Fx', undefined]]);
});

test('COV-3 #3: no scope → bulk restore for that one id; a refused restore says why and leaves the row', async () => {
  const n = host({ rows: { h9: { id: 'h9', archived: true } }, scopes: { h9: { pipelineId: 'h9' } }, routes: { 'POST /api/runs/bulk': [200, { done: [{ pipelineId: 'h9' }] }] } });
  const r = await n.t.flow('Restore', { taskId: 'h9' });
  assert.equal(r.ok, true);
  assert.deepEqual(writes(n.calls), [['POST', '/api/runs/bulk', { action: 'restore', targets: [{ pipelineId: 'h9' }] }]]);
  const rows = { h7: archivedRow };
  const f = host({ rows, routes: { 'POST /api/runs/h7/restore': [409, { error: 'cannot restore a running pipeline' }] } });
  const x = await f.t.flow('Restore', { taskId: 'h7' });
  assert.equal(x.ok, false);
  assert.deepEqual(f.toasts, ['Could not restore the task: cannot restore a running pipeline']);
  assert.equal(rows.h7.archived, true, 'COV-3: a refused restore leaves the archived row');
  assert.equal(f.t.canFlow('Restore', { taskId: 'h7', page: true }), true);
});

const liveRun = (status, o = {}) => ({ 'run-a': { runId: 'run-a', pipelineId: 'pa', status, state: {}, ...o } });
test('COV-3 #1: the direction posts {text} to the run; an empty one asks nothing; a pid not yet known is still starting; a finished run\'s 409 says why', async () => {
  const { t, calls, toasts } = host({ live: liveRun('running'), routes: { 'POST /api/runs/pa/directions': [201, { id: 'd1' }] } });
  assert.equal(t.canFlow('Send a direction', { taskId: 'run-a', page: true }), true);
  assert.equal(t.canFlow('Send a direction', { taskId: 'run-a' }), false, 'a card never posts it: the page only');
  const r = await t.act('run-direction', { taskId: 'run-a', text: '  use the v2 API  ' });
  assert.equal(r.ok, true);
  assert.deepEqual(writes(calls), [['POST', '/api/runs/pa/directions', { text: '  use the v2 API  ' }]]);
  const e = await t.act('run-direction', { taskId: 'run-a', text: '   ' });
  assert.equal(e.ok, false);
  assert.equal(writes(calls).length, 1, 'COV-3 #1: an empty direction asks nothing');
  assert.match(toasts.at(-1), /say what it should take into account first/);
  const s = host({ live: { 'run-b': { runId: 'run-b', status: 'running', state: {} } } });
  const x = await s.t.act('run-direction', { taskId: 'run-b', text: 'hi' });
  assert.match(x.error, /still starting/);
  assert.deepEqual(writes(s.calls), []);
  const f = host({ live: liveRun('running'), routes: { 'POST /api/runs/pa/directions': [409, { error: 'run is finished; a direction would never be read' }] } });
  const y = await f.t.act('run-direction', { taskId: 'run-a', text: 'hi', quiet: true });
  assert.equal(y.ok, false); assert.equal(y.status, 409);
  for (const st of ['done', 'stopped', 'error']) assert.equal(host({ live: liveRun(st) }).t.canFlow('Send a direction', { taskId: 'run-a', page: true }), false, `${st}: no direction`);
  assert.equal(host({ rows: { h3: failedRow } }).t.canFlow('Send a direction', { taskId: 'h3', page: true }), false, 'a saved task is not live');
});

test('COV-3 #12: resume-engine posts classic\'s body; base-moved asks before resuming, then sends baseAck with the engine; a missing engine is refused', async () => {
  let n = 0;
  const { t, calls, toasts } = host({ rows: { h3: failedRow }, routes: { 'POST /api/resume': () => (++n === 1 ? [409, { error: 'the base moved', code: 'base-moved' }] : [200, { ok: true, runId: 'r9' }]) } });
  const none = await t.act('resume-engine', { taskId: 'h3' });
  assert.equal(none.ok, false); assert.match(toasts.at(-1), /pick an engine first/);
  assert.deepEqual(writes(calls), [], 'a missing engine makes no request');
  const p = await t.flow('Resume on…', { taskId: 'h3', engine: 'codex', quiet: true });
  assert.equal(p.prompt, 'base', 'COV-3 #12: base-moved asks before resuming');
  const ok = await t.flow('Resume on…', { taskId: 'h3', engine: 'codex', baseAck: true });
  assert.equal(ok.ok, true);
  assert.equal(ok.say, 'Resumed on OpenAI Codex');
  assert.deepEqual(writes(calls), [['POST', '/api/resume', { pipelineId: 'h3', baseCheck: true, engine: 'codex' }], ['POST', '/api/resume', { pipelineId: 'h3', baseCheck: true, baseAck: true, engine: 'codex' }]]);
  assert.equal(t.resolve('r9')?.pipelineId, 'h3', 'the new run id finds the same task');
  assert.equal(t.canFlow('Resume on…', { taskId: 'h3' }), false, 'the page only');
  assert.equal(t.canFlow('Resume on…', { taskId: 'h3', page: true }), true);
});

test('COV-3 #11: an id no source holds asks run-links once; a 200 opens its pipeline; a 404 is gone and never asked again', async () => {
  const rows = { pz: { id: 'pz', case: 'ready' } };
  const { t, calls } = host({ rows, routes: { 'GET /api/run-links/old-run': [200, { pipelineId: 'pz', historyKey: 'web-1' }], 'GET /api/history/web-1/pz': [200, { state: TASK_DETAILS.failed.state }], 'GET /api/run-links/': [404, { error: 'No saved run for that link' }] } });
  await t.open('old-run'); await settle(20);
  assert.equal(t.state('old-run'), 'ready', 'the old link opens the saved task');
  assert.equal(t.resolve('old-run')?.pipelineId, 'pz');
  await t.open('gone-run'); await settle(20);
  assert.equal(t.state('gone-run'), 'gone');
  await t.open('gone-run'); await t.open('gone-run', { force: true }); await settle(20);
  assert.equal(calls.filter(([, u]) => u === '/api/run-links/gone-run').length, 1, 'COV-3 #11: a 404 link is asked once');
  assert.equal(calls.filter(([, u]) => u === '/api/run-links/old-run').length, 1);
});

test('COV-3 #11: a run-links network failure or 5xx reads failed (Try again), a plain open does not ask again, a forced open asks once more', async () => {
  const rows = { pz: { id: 'pz', case: 'ready' } };
  let answer = [0, {}];
  const { t, calls } = host({ rows, routes: { 'GET /api/run-links/old-run': () => answer, 'GET /api/history/web-1/pz': [200, { state: TASK_DETAILS.failed.state }] } });
  const asked = () => calls.filter(([, u]) => u === '/api/run-links/old-run').length;
  await t.open('old-run'); await settle(20);
  assert.equal(t.state('old-run'), 'failed', 'a lookup that could not answer is not "no longer exists"');
  await t.open('old-run'); await settle(20);
  assert.equal(asked(), 1, 'a notify-driven re-route does not loop');
  assert.equal(t.state('old-run'), 'failed');
  answer = [502, { error: 'bad gateway' }];
  await t.open('old-run', { force: true }); await settle(20);
  assert.equal(asked(), 2, 'Try again asks after a network failure');
  assert.equal(t.state('old-run'), 'failed');
  answer = [200, { pipelineId: 'pz', historyKey: 'web-1' }];
  await t.open('old-run', { force: true }); await settle(20);
  assert.equal(asked(), 3, 'Try again asks after a 5xx');
  assert.equal(t.state('old-run'), 'ready');
  await t.open('old-run', { force: true }); await settle(20);
  assert.equal(asked(), 3, 'a definitive answer is kept');
});

// F-G-G2-03: Resume now, Continue without cap and Raise the cap are classic's resumeBody (baseCheck), and a moved base asks
// before resuming, as Switch model… does; Resume anyway resends the same resume with baseAck
test('F-G-G2-03: every resume sends baseCheck; a moved base is a prompt, and the resend keeps the cap or the no-cap', async () => {
  for (const [label, given, body] of [['Resume now', {}, {}], ['Continue without cap', {}, { ignoreCostCap: true }], ['Raise the cap', { value: '$180' }, { costCapUsd: 180 }]]) {
    let n = 0;
    const { t, calls, toasts } = host({ rows: { h1: { id: 'h1', case: 'capped' } }, routes: { 'POST /api/resume': () => (++n === 1 ? [409, { error: 'main moved 1 commit', code: 'base-moved' }] : [200, { ok: true, runId: 'r2' }]) } });
    const first = await t.flow(label, { taskId: 'h1', ...given });
    assert.deepEqual([first.ok, first.prompt], [false, 'base'], `${label}: a moved base asks`);
    assert.deepEqual(toasts, [], `${label}: a prompt, not a refusal`);
    assert.equal((await t.flow(label, { taskId: 'h1', ...given, baseAck: true })).ok, true);
    assert.deepEqual(calls.filter(([m]) => m === 'POST').map((c) => c[2]), [{ pipelineId: 'h1', baseCheck: true, ...body }, { pipelineId: 'h1', baseCheck: true, baseAck: true, ...body }], label);
  }
});

// F-G-G1-01: checks are read only for a PR known to be open; a merged, closed or unknown-state PR asks nothing (dev answers
// 400 for those, and a chat that opened its cards logged console errors)
test('F-G-G1-01: GET /api/pr/checks only for a PR known open', async () => {
  for (const [prState, asks] of [['OPEN', 1], ['MERGED', 0], ['CLOSED', 0], ['', 0]]) {
    const { t, calls } = host({ rows: { h2: { id: 'h2', case: 'ready', pr: PR_URL } }, scopes: { h2: { pipelineId: 'h2', projectKey: 'web-1', projectDir: '/src/web', prState } },
      routes: { 'GET /api/pr/checks': [200, TASK_DETAILS.approved.checks] } });
    t.checks('h2'); await settle(10);
    assert.equal(calls.filter(([m, u]) => m === 'GET' && u.startsWith('/api/pr/checks')).length, asks, `a PR whose state is "${prState}"`);
  }
});
