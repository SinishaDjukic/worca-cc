// test/stillhet-live-map.test.mjs — the live adapter's pure half (ui/public/stillhet/live/live-map.mjs): dev's answers into the
// demo model's shapes, dev's Needs-you rule kept (D7), nothing outside the shapes kept (D12).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { shapeErrors, SHAPES } from '../ui/public/stillhet/live/model-shape.mjs';
import { caseOf, taskOfLive, taskOfSaved, chatOf, unreadOf, scheduleOf, projectOf, costsOf, updateOf, updateOfOutcome, snapshotOf, partOf } from '../ui/public/stillhet/live/live-map.mjs';
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
    assert.equal(W.section({ case: caseOf(live) }) === 'needs', listed, `live ${status} ask=${ask} unread=${unread}`);
    const histListed = needsYouItems({ live: [], history: [hist] }).history.length === 1;
    assert.equal(W.section({ case: caseOf({ ...hist, needs: histListed }) }) === 'needs', histListed, `hist ${status} pr=${prNeeds}`);
    assert.equal(W.section({ case: taskOfSaved({ ...hist, status }, { now: NOW }).case }) === 'needs', ['paused'].includes(status.toLowerCase()) || (status === 'done' && histListed), `saved ${status}`);
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
  assert.deepEqual(Object.keys(partOf('history', { pipelines: [] }, SOURCES, { now: NOW })).sort(), ['runs', 'updates']);
});

test('live-map.mjs and model-shape.mjs load in Node with no DOM; no file under live/ reads location.search', async () => {
  assert.equal(typeof globalThis.document, 'undefined');
  const m = await import('../ui/public/stillhet/live/live-map.mjs?plain');
  assert.equal(typeof m.snapshotOf, 'function');
  const dir = new URL('../ui/public/stillhet/live/', import.meta.url);
  for (const f of readdirSync(dir)) assert.doesNotMatch(readFileSync(new URL(f, dir), 'utf8'), /location\.search/, f);
});
