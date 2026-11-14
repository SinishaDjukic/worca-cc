// test/stillhet-task-page.test.mjs — ui/public/stillhet/live/task-page.mjs: one input, two places (D3). taskPageOf meets
// TASK_PAGE_SHAPE for every fixture state; taskCardOf gives c17's (failed) and c18's (approved) fields; newTaskBodyOf
// copies only keys POST /api/run reads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readServerSource } from '../src/core/read-server-source.mjs';
import { taskPageOf, taskCardOf, newTaskBodyOf, NEW_TASK_KEYS, stagesOf, stageOfStep, patchFiles, docsOf, logLinesOf, actionsOf, groupOf, commentsByPath, DIFF_PREVIEW } from '../ui/public/stillhet/live/task-page.mjs';
import { taskPageErrors } from '../ui/public/stillhet/live/model-shape.mjs';
import { TASK_DETAILS, NOW, PR_URL } from './helpers/stillhet-live-fixture.mjs';
import { shortDetail } from '../ui/public/stillhet/live/live-map.mjs';

test('taskPageOf meets the page shape for every fixture state', () => {
  for (const [name, input] of Object.entries(TASK_DETAILS)) {
    const v = taskPageOf(input, { now: NOW });
    assert.deepEqual(taskPageErrors(v), [], name);
  }
  assert.deepEqual(taskPageErrors({}).slice(0, 1), ['taskPage.id: expected string']);
});

test('the failed task (c17): branch into base, "Build · REASON", its failing items; the page shows the same case and line', () => {
  const card = taskCardOf(TASK_DETAILS.failed);
  assert.deepEqual(card, { case: 'failed', branch: 'chore/node-24', base: 'dev', detail: 'Build · 3 tests failed',
    why: ['✗ test/a.test.mjs: timeout', '✗ test/b.test.mjs: expected 2', '✗ test/c.test.mjs: ENOENT'], git: 'branch' });
  const page = taskPageOf(TASK_DETAILS.failed, { now: NOW });
  // the page's head never repeats the failure: its bold head and one row per failure are the page's What broke
  assert.deepEqual([page.case, page.branch, page.base, page.why], [card.case, card.branch, card.base, card.why]);
  assert.equal(page.detail, '');
  assert.deepEqual(page.failure, { head: 'Build · 3 tests failed', rows: ['test/a.test.mjs: timeout', 'test/b.test.mjs: expected 2', 'test/c.test.mjs: ENOENT'] });
  assert.equal(taskPageOf(TASK_DETAILS.approved).failure, null);
  assert.deepEqual([page.cost, page.mins], [4.2, 31]);
  // dev's core stores a paused run's error on one line (run-harness clipMiddle folds the whitespace): the items still split
  const oneLine = { ...TASK_DETAILS.failed, state: { ...TASK_DETAILS.failed.state, steps: [{ key: 'x:n_impl:1', status: 'paused' }], error: null,
    status: 'paused', pauseReason: 'error', pauseDetail: '3 tests failed ✗ test/a.test.mjs: timeout ✗ test/b.test.mjs: expected 2 ✗ test/c.test.mjs: ENOENT' } };
  assert.deepEqual([taskCardOf(oneLine).detail, taskCardOf(oneLine).why], [card.detail, card.why]);
  // an error that starts with its first ✗ keeps that item (code review r9); the card's line is Pulse's and the bell's
  // (R-arch-3: live-map.mjs shortDetail), so it counts the items
  const bare = { ...oneLine, state: { ...oneLine.state, pauseDetail: '✗ test/a.test.mjs: timeout ✗ test/b.test.mjs: expected 2' } };
  assert.deepEqual([taskCardOf(bare).detail, taskCardOf(bare).why], ['Build · 2 tests failed', ['✗ test/a.test.mjs: timeout', '✗ test/b.test.mjs: expected 2']]);
  const free = { ...oneLine, state: { ...oneLine.state, pauseDetail: 'npm ci exited 1 (code >= 1)\nsee the log' } };
  assert.equal(taskCardOf(free).detail, shortDetail({ status: 'failed', error: 'npm ci exited 1 (code >= 1)\nsee the log' }));
  assert.equal(taskCardOf(free).detail, 'Build · npm ci exited 1');
});

test('the approved PR (c18): its case from the checks entry, the checks list and the approvals, the pass mark', () => {
  const card = taskCardOf(TASK_DETAILS.approved);
  assert.deepEqual(card, { case: 'approved', branch: 'feat/audit-log-pager', base: 'dev', why: ['✓ All 12 checks pass', 'Approved by maya'], git: 'pass', prUrl: PR_URL });
  assert.equal(taskPageOf(TASK_DETAILS.approved).pr, '#959');
  const failing = taskCardOf(TASK_DETAILS.failing);
  assert.deepEqual([failing.case, failing.git, failing.watch, failing.why], ['failing', 'fail', 'idle', ['✗ 2 of 5 checks failing']]);
  assert.equal(failing.failedChecks, 2, 'the card\'s Fix checks confirm says its own count (code review r9)');
  // Without a checks entry the store's case stands and no checks list shows.
  const bare = taskCardOf({ ...TASK_DETAILS.approved, checks: null });
  assert.deepEqual([bare.case, bare.why], ['checks', undefined]);
});

test('a field dev cannot fill is left out; the cap and the pause-after flag reach the page', () => {
  const card = taskCardOf({ row: { id: 'x', case: 'working' }, state: { status: 'running' } });
  assert.deepEqual(card, { case: 'working' });
  assert.equal(taskPageOf(TASK_DETAILS.capped).cap, 2);
  assert.equal(taskPageOf({ ...TASK_DETAILS.plan, state: { ...TASK_DETAILS.plan.state, pauseAfterStep: true } }).pauseAfterStep, true);
});

test('stagesOf folds dev\'s steps into Plan, Build, Review', () => {
  assert.equal(stageOfStep({ agentKey: 'refiner' }), 'plan');
  assert.equal(stageOfStep({ agentKey: 'reviewer' }), 'review');
  assert.equal(stageOfStep({ agentKey: 'implementer' }), 'build');
  assert.deepEqual(stagesOf(TASK_DETAILS.failed.state.steps).map((s) => [s.key, s.state]), [['plan', 'done'], ['build', 'failed'], ['review', 'next']]);
  assert.equal(stagesOf([{ agentKey: 'implementer', status: 'start' }])[1].state, 'now', 'a ledger row in flight reads start');
});

test('stagesOf: dev\'s bookend rows are no stage\'s step; a workflow with no planner has no Plan (web-UI review cycle 1)', () => {
  const bookends = ['preflight', 'sync', 'done'].map((n) => ({ key: `x:${n}:1`, executionId: `x:${n}:1`, nodeId: n, agentKey: null, status: 'done' }));
  const capped = stagesOf([...bookends, { agentKey: 'planner', status: 'done' }, { agentKey: 'plan_review', status: 'paused' }]);
  assert.deepEqual(capped.map((s) => [s.key, s.state]), [['plan', 'paused'], ['build', 'next'], ['review', 'next']]);
  const fixNodes = [{ id: 'n_impl', kind: 'agent', key: 'implementer' }, { id: 'n_rev', kind: 'agent', key: 'reviewer' }];
  assert.deepEqual(stagesOf([{ agentKey: 'implementer', status: 'done' }], fixNodes).map((s) => s.key), ['build', 'review']);
  assert.deepEqual(stagesOf([], []).map((s) => s.key), ['plan', 'build', 'review'], 'Auto still deciding (no nodes): all three');
});

test('stagesOf: each stage carries the workflow\'s own steps, named and placed by its nodes, marked by the ledger (web-UI review cycle 2)', () => {
  const node = (id, label, progressStage, kind = 'agent') => ({ id, kind, key: id.slice(2), label, ...(progressStage ? { progressStage } : {}) });
  const row = (nodeId, status, n = 1) => ({ key: `x:${nodeId}:${n}`, executionId: `x:${nodeId}:${n}`, nodeId, agentKey: nodeId.slice(2), status });
  // wf_default capped at Plan: Clarify done, Plan paused; there is no Plan review node, and Build never ran
  const def = [node('n_task', 'Task', '', 'task'), node('n_clarify', 'Clarify', 'plan'), node('n_plan', 'Plan', 'plan'), node('n_impl', 'Implementation', 'build'),
    node('n_rev', 'Review Implementation', 'review'), { id: 'n_end', kind: 'end', key: null, label: 'End' }];
  const capped = stagesOf([row('n_clarify', 'done'), row('n_plan', 'paused')], def);
  assert.deepEqual(capped.map((s) => [s.key, s.state, s.steps.map((x) => `${x.name}:${x.state}`)]), [
    ['plan', 'paused', ['Clarify:done', 'Plan:paused']], ['build', 'next', ['Implementation:next']], ['review', 'next', ['Review Implementation:next']]]);
  // a Restart Build round (wf_pr_fix): Task, Implementation, Review Implementation; a node's second pass is still one step
  const fix = [node('n_task', 'Task', '', 'task'), node('n_impl', 'Implementation', 'build'), node('n_rev', 'Review Implementation', 'review')];
  const round = stagesOf([row('n_impl', 'done'), row('n_rev', 'done'), row('n_impl', 'start', 2)], fix);
  assert.deepEqual(round.map((s) => [s.key, s.state, s.steps.map((x) => `${x.name}:${x.state}`)]), [['build', 'now', ['Implementation:now']], ['review', 'done', ['Review Implementation:done']]]);
  // no nodes (Auto deciding, or a saved run without its manifest): the ledger's own steps, by their agent
  assert.deepEqual(stagesOf(TASK_DETAILS.failed.state.steps).map((s) => s.steps.map((x) => `${x.name}:${x.state}`)), [['planner:done'], ['implementer:failed'], []]);
});

test('stagesOf: the ledger\'s rows for the Task input and End are no step; a finished task with no ledger and no graph draws no work stage (web-UI review cycle 3)', () => {
  const node = (id, label, progressStage, kind = 'agent') => ({ id, kind, key: id.slice(2), label, ...(progressStage ? { progressStage } : {}) });
  const row = (nodeId, status, agentKey = nodeId.slice(2)) => ({ key: `x:${nodeId}:1`, executionId: `x:${nodeId}:1`, nodeId, agentKey, status });
  const fix = [node('n_task', 'Task', '', 'task'), node('n_impl', 'Implementation', 'build'), node('n_rev', 'Review Implementation', 'review'), { id: 'n_end', kind: 'end', key: null, label: 'End' }];
  const done = stagesOf([row('n_task', 'done', null), row('n_impl', 'done'), row('n_rev', 'done'), row('n_end', 'done', null)], fix);
  assert.deepEqual(done.map((s) => [s.key, s.steps.map((x) => `${x.name}:${x.state}`)]), [['build', ['Implementation:done']], ['review', ['Review Implementation:done']]]);
  const approved = { ...TASK_DETAILS.approved, state: { ...TASK_DETAILS.approved.state, steps: [], stepper: undefined } };
  assert.deepEqual(taskPageOf(approved).stages, [], 'no step ran that dev knows of: no "Not yet" stage on a finished task');
  assert.deepEqual(taskPageOf({ row: { id: 'r1' }, state: { status: 'running', steps: [] } }).stages.map((s) => s.key), ['plan', 'build', 'review'], 'a running task still deciding keeps all three');
});

test('the head\'s reason never repeats the state word or the cap\'s numbers; the cap falls back to Settings\' (capUsd)', () => {
  const capped = taskPageOf({ row: { ...TASK_DETAILS.capped.row, detail: 'pipeline cost limit reached ($0.80 >= $0.50)' },
    state: { ...TASK_DETAILS.capped.state, pipelineCapUsd: undefined, capUsd: 0.5, pauseDetail: 'pipeline cost limit reached ($0.80 >= $0.50)' } });
  assert.equal(capped.cap, 0.5);
  assert.doesNotMatch(capped.detail, /\$|>=/);
  assert.notEqual(capped.detail, '');
  assert.equal(taskPageOf(TASK_DETAILS.stopped).detail, 'Stopped by you · the branch and changes stay', 'a stopped task says what stays');
  assert.equal(taskPageOf({ row: { ...TASK_DETAILS.capped.row, case: 'paused', detail: 'Paused' }, state: { ...TASK_DETAILS.capped.state, pauseReason: null } }).detail, '');
  assert.equal(taskPageOf({ ...TASK_DETAILS.failing }).failedChecks, 2);
  // the row's '2 checks failing' (live-map.mjs prLine) is the why list's '✗ 2 of 5 checks failing': the head says it once
  assert.equal(taskPageOf({ ...TASK_DETAILS.failing, row: { ...TASK_DETAILS.failing.row, detail: '2 checks failing' } }).detail, '');
});

test('newTaskBodyOf copies the project, prompt, workflow, guardrails, labels and tags, and only keys startRunHandler reads', () => {
  const body = newTaskBodyOf(TASK_DETAILS.failed.state);
  assert.deepEqual(body, { projectDir: '/src/web', prompt: 'Update Node to 24', workflowId: 'wf_default', guardrailsId: 'g1', labels: ['infra'], tags: [{ key: 'team', value: 'web' }] });
  const server = readServerSource();
  const handler = server.slice(server.indexOf('const startRunHandler = async'), server.indexOf('async function invokeStartRun'));
  for (const k of NEW_TASK_KEYS) assert.match(handler, new RegExp(`body\\.${k}\\b|\\b${k}\\b`), `startRunHandler reads ${k}`);
  for (const k of Object.keys(body)) assert.ok(NEW_TASK_KEYS.includes(k), k);
  assert.deepEqual(newTaskBodyOf({ workspaceId: 'ws-1', projectDir: '/x', source: { type: 'ticket', id: 't1' }, prompt: 'p', runEngine: 'codex' }),
    { workspaceId: 'ws-1', source: { type: 'ticket', id: 't1' }, engine: 'codex' });
});

test('the page\'s parts on dev\'s data (D4): a patch, artifacts, the log, the worktree\'s actions', () => {
  const long = Array.from({ length: DIFF_PREVIEW + 5 }, (_, i) => `+line ${i}`).join('\n');
  const p = patchFiles(['diff --git a/a.mjs b/a.mjs', 'index 1..2 100644', '--- a/a.mjs', '+++ b/a.mjs', '@@ -1,2 +1,2 @@ fn', ' keep', '-old', '+new',
    'diff --git a/b.mjs b/b.mjs', 'new file mode 100644', '--- /dev/null', '+++ b/b.mjs', '@@ -0,0 +1,45 @@', long, ''].join('\n'));
  assert.deepEqual(p.files, [['a.mjs', 1, 1], ['b.mjs', DIFF_PREVIEW + 5, 0]]);
  assert.deepEqual([p.fileMeta['a.mjs'].st, p.fileMeta['b.mjs'].st], ['M', 'A']);
  assert.deepEqual(p.hunks['a.mjs'], { at: '@@ -1,2 +1,2 @@ fn', lines: [[' ', 'keep', 'new', 1], ['-', 'old', 'old', 2], ['+', 'new', 'new', 2]], more: false }, 'each row carries the side and line a diff comment anchors to');
  assert.equal(p.hunks['b.mjs'].lines.length, DIFF_PREVIEW, 'a preview; the whole file is Open the whole diff');
  assert.equal(p.hunks['b.mjs'].more, true);
  assert.match(p.full['b.mjs'], /line 44/);
  assert.deepEqual(patchFiles(''), { files: [], fileMeta: {}, hunks: {}, full: {} });
  // a workspace: two projects changing the same path stay two files (keyed by project), and a file's whole patch carries no `# KEY` line
  const ws = patchFiles(['# api', 'diff --git a/src/x.mjs b/src/x.mjs', '--- a/src/x.mjs', '+++ b/src/x.mjs', '@@ -1 +1 @@', '-a', '+b', '',
    '# web', 'diff --git a/src/x.mjs b/src/x.mjs', '--- a/src/x.mjs', '+++ b/src/x.mjs', '@@ -1 +1,2 @@', ' a', '+c', ''].join('\n'));
  assert.deepEqual(ws.files, [['api/src/x.mjs', 1, 1], ['web/src/x.mjs', 1, 0]]);
  assert.deepEqual([ws.fileMeta['api/src/x.mjs'], ws.fileMeta['web/src/x.mjs']], [{ st: 'M', member: 'api', path: 'src/x.mjs' }, { st: 'M', member: 'web', path: 'src/x.mjs' }]);
  assert.doesNotMatch(ws.full['api/src/x.mjs'], /^# /m, 'the next project\'s `# KEY` line is not this file\'s');
  assert.match(ws.full['web/src/x.mjs'], /^\+c$/m);
  assert.deepEqual(commentsByPath({ comments: [{ projectKey: 'web', path: 'src/x.mjs', lineText: 'c', body: 'ok', author: 'user' }] }), { 'web/src/x.mjs': [{ who: 'You', line: 'c', t: 'ok' }] });
  assert.deepEqual(docsOf([{ relPath: 'docs/plan.md', stepKey: 'plan' }, { relPath: 'live-log.ndjson', kind: 'live-log' }, null]), [['plan.md', 'plan', 'docs/plan.md']]);
  const log = logLinesOf([JSON.stringify({ source: 'sync', level: 'info', text: 'fetched', ts: '2026-11-12T08:00:01Z', executionId: 'x:sync:1' }), 'not json', JSON.stringify({ source: 'agent', level: 'warn', text: 'Bash ls', desc: 'List files', nodeId: 'n_impl', cycle: 2 })].join('\n'));
  assert.deepEqual(log.map((l) => [l.t, l.step, l.lvl, l.cycle, l.sum, l.raw]), [['08:00:01', 'Sync', 'info', '1', 'fetched', 'fetched'], ['', 'n_impl', 'warn', '2', 'List files', 'Bash ls']]);
  const a = actionsOf({ enabled: false, members: [{ projectKey: 'web', state: 'checked-out', actions: [{ id: 'dev', label: 'Dev server' }], builtins: [{ key: 'editor', label: 'Editor' }] }],
    instances: [{ actionId: 'dev', member: 'web', status: 'running', ports: { PORT: 4417 }, url: 'http://localhost:4417' }] });
  assert.deepEqual(a, { services: [{ key: 'web/dev', id: 'dev', name: 'Dev server', port: 4417, running: true, url: 'http://localhost:4417', member: 'web' }], builtins: [{ key: 'web/editor', id: 'editor', label: 'Editor', member: 'web' }], stacks: [], enabled: false, checkedOut: true });
  assert.equal(actionsOf(null), null);
  // a workspace: two projects with the same service id stay two services (keyed by project), each project keeps its tools,
  // and its stacks carry dev's state
  const w = actionsOf({ members: [{ projectKey: 'api', projectName: 'API', actions: [{ id: 'dev', label: 'Dev' }], builtins: [{ key: 'editor', label: 'Editor' }] },
    { projectKey: 'web', projectName: 'Web', actions: [{ id: 'dev', label: 'Dev' }], builtins: [{ key: 'editor', label: 'Editor' }] }],
  instances: [{ actionId: 'dev', member: 'web', status: 'running', ports: { http: 5173 } }],
  stacks: [{ id: 's1', label: 'Both', steps: [{}, {}] }], stackStates: [{ stackId: 's1', status: 'starting', step: 1 }] });
  assert.deepEqual(w.services.map((x) => [x.key, x.name, x.running]), [['api/dev', 'API · Dev', false], ['web/dev', 'Web · Dev', true]]);
  assert.deepEqual(w.builtins.map((x) => [x.key, x.id, x.member, x.label]), [['api/editor', 'editor', 'api', 'API · Editor'], ['web/editor', 'editor', 'web', 'Web · Editor']], 'each project\'s tool is its own (keyed by project)');
  assert.deepEqual(w.stacks, [{ id: 's1', name: 'Both', steps: 2, status: 'starting', step: 1, error: '' }]);
  assert.deepEqual(commentsByPath({ comments: [{ path: 'a.mjs', lineText: 'new', body: 'why?', author: 'user', authorName: 'Maya' }, { path: 'a.mjs', parentId: 'c1', body: 'a reply' }] }), { 'a.mjs': [{ who: 'Maya', line: 'new', t: 'why?' }] });
});

test('groupOf: dev\'s run group in stack order, each member\'s case and cost read from its store row', () => {
  const rows = { p1: { case: 'merged', cost: 1.2, title: 'One' }, p2: { case: 'approved', cost: 0.5 } };
  const g = groupOf({ id: 'G', kind: 'feature', title: 'Pager', cost: { usd: 1.7 }, members: [
    { position: 2, title: 'Two', pipelineId: 'p2', pr: { url: 'https://github.com/o/r/pull/960' } }, { position: 1, title: '', pipelineId: 'p1', pr: null }] }, (id) => rows[id]);
  assert.deepEqual(g, { id: 'G', title: 'Pager', kind: 'Feature', cost: 1.7, members: [
    { pipelineId: 'p1', title: 'One', case: 'merged', pr: '', prUrl: '', cost: 1.2 }, { pipelineId: 'p2', title: 'Two', case: 'approved', pr: '#960', prUrl: 'https://github.com/o/r/pull/960', cost: 0.5 }] });
});

test('the page\'s plan review is the run\'s own: its role findings, its shape check and its concern, else none', () => {
  const roleReviews = { rounds: [{ pass: 1, round: 1, target: 'plan', roles: [{ key: 'product', label: 'Product', findings: [] }, { key: 'qa', label: 'QA', findings: [{ id: 'qa-1-1', severity: 'minor', title: 'qa: mock finding', status: 'open' }] }] }] };
  const page = taskPageOf({ ...TASK_DETAILS.plan, state: { ...TASK_DETAILS.plan.state, roleReviews } });
  assert.deepEqual(page.review.roles.map((r) => [r.role, r.n, r.findings]), [['Product', 0, []], ['QA', 1, ['qa: mock finding']]]);
  const viaAsk = taskPageOf({ ...TASK_DETAILS.plan, state: { ...TASK_DETAILS.plan.state, pendingQuestion: { id: 'q', kind: 'plan', plan: { roleReviews, check: { items: [{ id: 'tests', label: 'Has a test plan', pass: false }] } } } } });
  assert.equal(viaAsk.review.roles.length, 2);
  assert.deepEqual(viaAsk.review.issues.map((x) => x.t), ['Has a test plan']);
  assert.deepEqual(taskPageOf(TASK_DETAILS.plan).review, { roles: [], issues: [] }, 'no review, no findings');
});

test('the PR\'s own facts reach the page: its checks entry\'s counts', () => {
  assert.deepEqual(taskPageOf(TASK_DETAILS.approved).checks, { total: 12, failed: 0, pending: 0 });
  assert.deepEqual(taskPageOf(TASK_DETAILS.failing).checks, { total: 5, failed: 2, pending: 0 });
  assert.equal(taskPageOf(TASK_DETAILS.stopped).checks, null);
});

test('a plan waiting for approval has no reason line under its word (the prototype\'s plan case), and its row line stays the list\'s', () => {
  assert.equal(taskPageOf({ ...TASK_DETAILS.plan, row: { ...TASK_DETAILS.plan.row, detail: 'Waits for your OK on the plan' } }).detail, '');
});

test('slice 7 D17: taskPageOf names the task\'s workflow from stepper.template, and null without one', () => {
  const input = { ...TASK_DETAILS.approved, state: { ...TASK_DETAILS.approved.state, stepper: { template: { id: 'wf_full', name: 'Full' } } } };
  assert.deepEqual(taskPageOf(input, { now: NOW }).workflow, { id: 'wf_full', name: 'Full' });
  assert.equal(taskPageOf({ ...TASK_DETAILS.approved, state: { ...TASK_DETAILS.approved.state, stepper: null } }, { now: NOW }).workflow, null);
});
