// test/stillhet-live-map.test.mjs — the live adapter's pure half (ui/public/stillhet/live/live-map.mjs): dev's answers into the
// demo model's shapes, dev's Needs-you rule kept (D7), nothing outside the shapes kept (D12).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { shapeErrors, SHAPES } from '../ui/public/stillhet/live/model-shape.mjs';
import { caseOf, overOf, taskOfLive, taskOfSaved, chatOf, unreadOf, scheduleOf, projectOf, costsOf, updateOf, updateOfOutcome, snapshotOf, partOf, dayOf } from '../ui/public/stillhet/live/live-map.mjs';
import { dayBucket } from '../ui/public/runs-list.mjs';
import { needsYouItems } from '../src/shared/needs-you.mjs';
import { RUN_STATES } from '../src/shared/run-model.mjs';
import { stillhetHost } from './helpers/stillhet-host.mjs';

import { SOURCES, NOW } from './helpers/stillhet-live-fixture.mjs';

test('mapper output meets the shapes for projects, tasks, chats, schedules and costs; odd input defaults', () => {
  const s = snapshotOf(SOURCES, { now: NOW });
  for (const [kind, list] of [['task', s.runs], ['chat', s.chats], ['schedule', s.schedules], ['project', s.projects], ['costs', [s.costs]], ['update', s.updates]]) {
    assert.ok(list.length > 0, kind);
    for (const x of list) assert.deepEqual(shapeErrors(kind, x), [], `${kind} ${x.id || ''}`);
  }
  for (const [kind, x] of [['task', taskOfLive({})], ['task', taskOfSaved({})], ['chat', chatOf({})], ['schedule', scheduleOf({})], ['project', projectOf({})], ['costs', costsOf()]]) assert.deepEqual(shapeErrors(kind, x), [], `${kind} from {}`);
  assert.equal(updateOf({ kind: 'nonsense' }), null);
  assert.equal(updateOfOutcome({ status: 'stopped' }), null);
});

test('snapshotOf: no field outside SHAPES, no archived row, a live-and-saved pipeline once, settings only keepAwake', () => {
  const s = snapshotOf(SOURCES, { now: NOW });
  const flat = JSON.stringify(s);
  for (const secret of ['SECRET', '/secret/', 'S1', '"sessionId"', '"context"', '"worktrees"', '"dir"', 'uiLevel', 'flags']) assert.ok(!flat.includes(secret), secret);
  for (const r of s.runs) for (const k of Object.keys(r)) assert.ok(k in SHAPES.task, `task.${k}`);
  for (const c of s.chats) for (const k of Object.keys(c)) assert.ok(k in SHAPES.chat, `chat.${k}`);
  assert.equal(s.runs.filter((r) => r.title === 'Ask me').length, 1, 'kept once');
  assert.equal(s.runs.find((r) => r.title === 'Ask me').id, 'run-a', 'the live one');
  assert.ok(!s.runs.some((r) => r.title === 'Gone') && !s.chats.some((c) => c.title === 'Archived'));
  assert.equal(s.keep, true);
  assert.deepEqual(s.actions.map((a) => a.id), ['i1']);
  assert.deepEqual(s.chatGroups, [{ id: 'g1', name: 'Release', total: 2 }]);
  const c = s.chats.find((x) => x.id === 'ask_1');
  assert.equal(c.state, 'needs-you'); assert.equal(c.pinned, true);
  assert.equal(s.chats.find((x) => x.id === 'ask_2').state, 'replying');
  assert.equal(s.costs.budget.spent, 12.5); assert.equal(s.costs.budget.limit, 100); assert.equal(s.costs.budget.period, 'this month');
  assert.deepEqual(s.costs.usage.map((u) => [u.p, u.win[0].pct]), [['claude', 100]], 'a limit pause, the only usage dev reports');
  assert.deepEqual(costsOf({ windowSpendUsd: 1 }, []).usage, [], 'nothing reported');
  assert.equal(s.schedules.find((x) => x.id === 'tk1').section, 'needs');
  assert.equal(s.schedules.find((x) => x.id === 'sr2').section, 'paused');
  assert.equal(s.schedules.find((x) => x.id === 'sr1').section, 'next');
  assert.ok(s.runs.find((r) => r.id === 'sched:tk1').missed, 'a missed ticket is a Needs-you row of the store');
});

test('caseOf keeps D7 for every status: section is needs exactly when dev\'s needsYouItems lists the item', () => {
  const w = stillhetHost({ after });
  const W = w.RailWorld;
  const statuses = [...new Set(['created', 'starting', 'running', 'pausing', 'paused', 'interrupted', 'stopped', 'aborted', 'error', 'failed', 'done', 'complete', 'mystery', ...Object.keys(RUN_STATES)])];
  let n = 0;
  for (const status of statuses) for (const ask of [false, true]) for (const unread of [false, true]) for (const prNeeds of [false, true]) {
    const live = { kind: 'live', status, ask, unread, pipelineId: 'p' };
    const hist = { kind: 'hist', id: 'h', status, pr: prNeeds ? { url: 'https://x/pr/1', state: 'open', checks: 'failing' } : null, mtime: 1 };
    const listed = needsYouItems({ live: [live], history: [] }).live.length === 1;
    assert.equal(W.section({ case: caseOf(live), over: overOf(live) }) === 'needs', listed, `live ${status} ask=${ask} unread=${unread}`);
    const histListed = needsYouItems({ live: [], history: [hist] }).history.length === 1;
    assert.equal(W.section({ case: caseOf({ ...hist, needs: histListed }), over: overOf({ ...hist, needs: histListed }) }) === 'needs', histListed, `hist ${status} pr=${prNeeds}`);
    assert.equal(W.section(taskOfSaved({ ...hist, status }, { now: NOW })) === 'needs', ['paused'].includes(status.toLowerCase()) || (status === 'done' && histListed), `saved ${status}`);
    n++;
  }
  assert.ok(n >= statuses.length * 8);
});

test('projectOf: needs for a missing folder and for an out-of-sync project, not for a synced one', () => {
  assert.equal(projectOf({ key: 'a', exists: false }).needs, true);
  assert.equal(projectOf({ key: 'a', exists: false }).origin, 'missing');
  assert.equal(projectOf({ key: 'a', exists: true, vcs: 'git' }, { state: 'diverged', ahead: 1, behind: 2, base: 'main' }).needs, true);
  assert.equal(projectOf({ key: 'a', exists: true, vcs: 'git' }, { state: 'behind', behind: 2, base: 'main' }).needs, true);
  assert.equal(projectOf({ key: 'a', exists: true, vcs: 'git' }, { state: 'up-to-date', base: 'main' }).needs, false);
  assert.equal(projectOf({ key: 'a', exists: true, vcs: 'git' }, { state: 'up-to-date', base: 'main' }).origin, 'ok');
  assert.equal(projectOf({ key: 'gone2-9428', name: 'gone2', exists: false }).name, 'gone2', 'its name, not its key, is what the pages show');
  assert.equal(projectOf({ key: 'gone2-9428', name: 'gone2', exists: false }).id, 'gone2-9428', 'the id stays dev\'s key (#projects/KEY)');
  assert.equal(projectOf({ key: 'k' }).name, 'k', 'no name: the key');
});

test('unreadOf mirrors dev\'s ask-done rule: a hidden page lights, the open chat does not, opening clears', () => {
  const done = (threadId) => ({ type: 'ask-done', threadId });
  assert.deepEqual(unreadOf([], done('a'), { openChat: 'b' }), ['a']);
  assert.deepEqual(unreadOf([], done('a'), { openChat: 'a' }), []);
  assert.deepEqual(unreadOf([], done('a'), { openChat: 'a', hidden: true }), ['a']);
  assert.deepEqual(unreadOf(['a'], null, { openChat: 'a' }), [], 'opening clears');
  assert.deepEqual(unreadOf(['a'], { type: 'ask-start', threadId: 'c' }, { openChat: '' }), ['a']);
  assert.equal(snapshotOf(SOURCES, { now: NOW, unread: ['ask_2'] }).chats.find((c) => c.id === 'ask_2').unread, true);
});

test('partOf replaces only the parts its source feeds', () => {
  const p = partOf('budget', { windowSpendUsd: 3, totalLimitUsd: 10, resetPeriod: 'daily' }, SOURCES, { now: NOW });
  assert.deepEqual(Object.keys(p), ['costs']);
  assert.equal(p.costs.budget.spent, 3);
  assert.deepEqual(Object.keys(partOf('history', { pipelines: [] }, SOURCES, { now: NOW })).sort(), ['chats', 'runs', 'updates'], 'a chat\'s tasks are rebuilt with the runs they read');
});

test('live-map.mjs and model-shape.mjs load in Node with no DOM; no file under live/ reads location.search', async () => {
  assert.equal(typeof globalThis.document, 'undefined');
  const m = await import('../ui/public/stillhet/live/live-map.mjs?plain');
  assert.equal(typeof m.snapshotOf, 'function');
  const dir = new URL('../ui/public/stillhet/live/', import.meta.url);
  for (const f of readdirSync(dir)) assert.doesNotMatch(readFileSync(new URL(f, dir), 'utf8'), /location\.search/, f);
});

test('the live task set is dev\'s Needs-you input: a settled hello run gives way to its saved row, no agent generation', () => {
  const failing = { url: 'https://x/pr/9', number: 9, state: 'OPEN', checks: { state: 'failing', total: 3, failed: 1, pending: 0 } };
  const src = { ...SOURCES,
    hello: { runs: [...SOURCES.hello.runs,
      { runId: 'run-d', pipelineId: 'pd', title: 'Shipped live', status: 'done', startedAt: SOURCES.hello.runs[0].startedAt },
      { runId: 'gen-1', kind: 'agentgen', title: 'An agent', status: 'running' },
      { runId: 'sb-1', kind: 'scriptbench', title: 'A script', status: 'running' }] },
    history: { pipelines: [...SOURCES.history.pipelines, { id: 'pd', title: 'Shipped live', status: 'done', pr: failing, projectName: 'web', mtime: NOW - 60000 }] } };
  const s = snapshotOf(src, { now: NOW });
  assert.ok(!s.runs.some((r) => ['run-d', 'gen-1', 'sb-1'].includes(r.id)), 'over, or not a pipeline run');
  assert.equal(s.runs.find((r) => r.id === 'pd').case, 'failing', 'its saved row carries the PR that needs you');
  // dev's count over dev's inputs (app.js runsNeedsInput: overviewRuns, the History rows)
  const devLive = src.hello.runs.filter((r) => ['run-a', 'run-b', 'run-c'].includes(r.runId)).map((r) => ({ runId: r.runId, pipelineId: r.pipelineId, status: r.status, ask: r.pendingQuestion != null, unread: false }));
  const dev = needsYouItems({ live: devLive, history: src.history.pipelines.filter((p) => !p.archived) });
  const NEEDS = new Set(['question', 'paused-restart', 'paused-limit', 'capped', 'failed', 'failing']);
  assert.equal(s.runs.filter((r) => !r.id.startsWith('sched:') && !r.over && NEEDS.has(r.case)).length, dev.live.length + dev.history.length);
});

test('dayOf is dev\'s dayBucket: 7 days ago is Previous 7 days, and a DST day is one day', () => {
  const now = new Date(2026, 10, 12, 10).getTime();
  for (let h = 0; h < 24 * 40; h += 5) { const t = now - h * 3600000; assert.equal(dayOf(t, now), dayBucket(t, now), `${h} h ago`); }
  assert.equal(dayOf(new Date(2026, 10, 5, 10).getTime(), now), 'week');
  const tz = process.env.TZ;
  try {
    process.env.TZ = 'Europe/Sofia';
    assert.equal(dayOf(new Date(2026, 2, 29, 10).getTime(), new Date(2026, 2, 30, 10).getTime()), 'yesterday', 'across the spring change');
  } finally { if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz; }
});

test('scheduleOf: nextAt is the server\'s next time; null when missed or unknown', () => {
  const t = new Date(2026, 10, 15, 14, 44).getTime();
  assert.equal(scheduleOf({ id: 't', kind: 'once', status: 'scheduled', runAt: new Date(t).toISOString() }, { now: NOW }).nextAt, t);
  assert.equal(scheduleOf({ id: 's', kind: 'recurring', status: 'active', nextRunAt: t }, { now: NOW }).nextAt, t);
  assert.equal(scheduleOf({ id: 'm', kind: 'once', status: 'missed', runAt: new Date(t).toISOString() }, { now: NOW }).nextAt, null);
  assert.equal(scheduleOf({ id: 'p', kind: 'recurring', status: 'paused', nextRunAt: null }, { now: NOW }).nextAt, null);
});

test('chatOf names the chat\'s project from dev\'s thread context (pinned projectKey); unpinned, none, or a non-object context is no project', () => {
  const projects = [{ key: 'web-1', name: 'web' }];
  assert.equal(chatOf({ id: 'a', context: { pinned: true, projectKey: 'web-1' } }, { projects }).project, 'web');
  assert.equal(chatOf({ id: 'a', context: { pinned: true, projectKey: 'gone-9' } }, { projects }).project, 'gone-9', 'a key Worca no longer lists reads as itself');
  assert.equal(chatOf({ id: 'a', context: { pinned: false, projectKey: 'web-1' } }, { projects }).project, '');
  assert.equal(chatOf({ id: 'a', context: 'SECRET' }, { projects }).project, '');
  assert.equal(chatOf({ id: 'a', context: null }, { projects }).project, '');
});

test('chatOf fills tasks from the run links: started ones as tasks, followed ones marked followed; chatOfRun finds the starting chat', async () => {
  const { chatOfRun } = await import('../ui/public/stillhet/live/live-map.mjs');
  const s = snapshotOf(SOURCES, { now: NOW });
  const c1 = s.chats.find((c) => c.id === 'ask_1'), c2 = s.chats.find((c) => c.id === 'ask_2');
  assert.deepEqual(c1.tasks.map((t) => [t.run, t.title, !!t.followed]), [['run-a', 'Ask me', false]]);
  assert.deepEqual(c2.tasks.map((t) => [t.run, t.title, !!t.followed]), [['run-b', 'Busy', true]]);
  assert.equal(c1.tasks[0].case, s.runs.find((r) => r.id === 'run-a').case, "a task's state is the store's task, one source");
  for (const c of s.chats) assert.deepEqual(shapeErrors('chat', c), []);
  const links = [
    { threadId: 'ask_follow', runId: 'run-r', pipelineId: 'p9', started: false },
    { threadId: 'ask_old', runId: 'run-r', pipelineId: 'p9', started: true },
    { threadId: 'ask_new', runId: 'run-r', pipelineId: 'p9', started: true },
  ];
  assert.equal(chatOfRun(links, 'run-r'), 'ask_old', 'the first started link, never the follower');
  assert.equal(chatOfRun(links, 'p9'), 'ask_old', 'by pipeline id too (a resumed run)');
  assert.equal(chatOfRun(links.slice(0, 1), 'run-r'), '', 'a run a chat only follows has no starting chat');
  assert.equal(chatOfRun([], 'x'), '');
  assert.deepEqual(Object.keys(partOf('runLinks', { links: [] }, SOURCES, { now: NOW })), ['chats']);
  assert.deepEqual(snapshotOf({ ...SOURCES, runLinks: { links: [] } }, { now: NOW }).chats.find((c) => c.id === 'ask_1').tasks, []);
});

test('a resumed run keeps its chat task: Resume gives it a new run id, the link still holds the old one, the pipeline id joins them', () => {
  const src = { ...SOURCES, hello: { type: 'hello', runs: [{ runId: 'run-new', pipelineId: 'pa', projectDir: '/src/web', title: 'Ask me', status: 'running', startedAt: SOURCES.hello.runs[0].startedAt }] },
    runLinks: { links: [{ threadId: 'ask_1', runId: 'run-old', pipelineId: 'pa', started: true }] } };
  const c = snapshotOf(src, { now: NOW }).chats.find((x) => x.id === 'ask_1');
  assert.deepEqual(c.tasks.map((t) => [t.id, t.run, t.pid, t.title]), [['run-new', 'run-new', 'pa', 'Ask me']]);
});

test('a calm failed run reads Failed and a finished run with its branch reads Ready (Create PR); both sort into Recent', () => {
  const w = stillhetHost({ after });
  const failed = taskOfSaved({ id: 'pf', status: 'error', mtime: NOW }, { now: NOW, needs: false });
  assert.equal(failed.case, 'failed', 'never Stopped: Pulse says Task failed');
  assert.equal(failed.over, true);
  assert.equal(w.RailWorld.section(failed), 'recent');
  const ready = taskOfSaved({ id: 'pr', status: 'done', branch: 'feat/x', survived: true, mtime: NOW }, { now: NOW, needs: false });
  assert.equal(ready.case, 'ready');
  assert.equal(w.RailWorld.section(ready), 'recent', 'D7: dev\'s Needs you does not list it');
  assert.equal(taskOfSaved({ id: 'pg', status: 'done', branch: 'feat/x', survived: false, mtime: NOW }, { now: NOW }).case, 'finished-nogit', 'its branch is gone');
  assert.equal(taskOfSaved({ id: 'pm', status: 'done', branch: 'feat/x', survived: true, inBase: { base: 'dev' }, mtime: NOW }, { now: NOW }).case, 'merged', 'already in its base');
  assert.deepEqual(shapeErrors('task', ready), []);
  const open = taskOfSaved({ id: 'po', status: 'done', branch: 'feat/x', survived: true, pr: { url: 'https://github.com/o/r/pull/7', state: 'open' }, mtime: NOW }, { now: NOW, needs: false });
  assert.equal(open.case, 'checks', 'its PR is open: In review, View PR, never Create PR');
  assert.equal(open.pr, 'https://github.com/o/r/pull/7');
  const closedRow = { id: 'pc', status: 'done', branch: 'feat/x', survived: true, pr: { url: 'https://github.com/o/r/pull/8', state: 'CLOSED' }, mtime: NOW };
  const closed = taskOfSaved(closedRow, { now: NOW, needs: false });
  assert.equal(closed.case, 'ready', 'its PR was closed unmerged: Ready, Create PR again');
  const c = chatOf({ id: 't1' }, { links: [{ threadId: 't1', runId: 'pc', started: true }], tasks: [closed] });
  assert.equal(c.tasks[0].git, undefined, 'a closed PR is not watched as open');
});

test('a chat\'s task keeps its link\'s pipeline id (Resume posts it), whatever id the store holds', () => {
  const c = chatOf({ id: 't1' }, { links: [{ threadId: 't1', runId: 'r1', pipelineId: 'p1', started: true }], tasks: [{ id: 'r1', title: 'A', case: 'paused-restart', detail: '' }] });
  assert.equal(c.tasks[0].run, 'r1');
  assert.equal(c.tasks[0].pid, 'p1');
});
