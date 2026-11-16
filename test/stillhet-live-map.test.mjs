// test/stillhet-live-map.test.mjs — the live adapter's pure half (ui/public/stillhet/live/live-map.mjs): dev's answers into the
// demo model's shapes, dev's Needs-you rule kept (D7), nothing outside the shapes kept (D12).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { shapeErrors, SHAPES } from '../ui/public/stillhet/live/model-shape.mjs';
import { caseOf, overOf, knownBase, taskOfLive, taskOfSaved, chatOf, unreadOf, scheduleOf, projectOf, costsOf, updateOf, updateOfOutcome, snapshotOf, partOf, dayOf, runGroupsOf, spacesOf, runsOf } from '../ui/public/stillhet/live/live-map.mjs';
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

test('a notification with a pipelineId carries it as `about` (Pulse reads its siblings by it); one without has no `about`', () => {
  const u = updateOf({ id: 9, kind: 'run_paused', pipelineId: 'h1', title: 'Old pause', createdAt: '2026-11-12T09:31:00Z' }, { now: NOW });
  assert.equal(u.about, 'h1');
  assert.equal(u.run, undefined, 'not `run`: that drives Resume and stillWaits');
  assert.deepEqual(shapeErrors('update', u), []);
  assert.equal('about' in updateOf({ id: 10, kind: 'failed', pipelineId: null }, { now: NOW }), false);
});

test('snapshotOf: no field outside SHAPES, no archived row, a live-and-saved pipeline once, settings only keepAwake and pulseFor', () => {
  const s = snapshotOf(SOURCES, { now: NOW });
  const flat = JSON.stringify(s);
  for (const secret of ['SECRET', '/secret/', 'S1', '"sessionId"', '"context"', '"worktrees"', '"dir"', 'uiLevel', 'flags']) assert.ok(!flat.includes(secret), secret);
  for (const r of s.runs) for (const k of Object.keys(r)) assert.ok(k in SHAPES.task, `task.${k}`);
  for (const c of s.chats) for (const k of Object.keys(c)) assert.ok(k in SHAPES.chat, `chat.${k}`);
  assert.equal(s.runs.filter((r) => r.title === 'Ask me').length, 1, 'kept once');
  assert.equal(s.runs.find((r) => r.title === 'Ask me').id, 'run-a', 'the live one');
  assert.ok(!s.runs.some((r) => r.title === 'Gone') && !s.chats.some((c) => c.title === 'Archived'));
  assert.equal(s.keep, true);
  assert.equal(s.pulseFor, 'until-read');
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

test('F-a4-07: snapshotOf maps src.archived as archived tasks, one per pipeline (live > active > archived), never in Needs you, updates, groups, rounds or chats; partOf(\'archived\') returns only runs', () => {
  const arch = (id, over = {}) => ({ id, title: `Arch ${id}`, status: 'paused', archived: true, projectName: 'web', startedAt: '2026-11-12T08:00:00Z', mtime: NOW - 3600000, ...over });
  const archived = { pipelines: [arch('x1'), arch('x2', { status: 'error' }), arch('pa', { title: 'Ask me' }), arch('h2', { title: 'Shipped' }),
    arch('x3', { roundOf: { pipelineId: 'x1', round: 2 } })] };
  const runGroups = { groups: [{ id: 'rg1', title: 'G', members: [{ pipelineId: 'x1', position: 0 }] }] };
  const runLinks = { links: [...SOURCES.runLinks.links, { threadId: 'ask_2', runId: 'run-x2', pipelineId: 'x2', started: true }] };
  const base = snapshotOf({ ...SOURCES, runGroups, runLinks }, { now: NOW });
  const s = snapshotOf({ ...SOURCES, runGroups, runLinks, archived }, { now: NOW });
  const a = s.runs.filter((r) => r.archived);
  assert.deepEqual(a.map((r) => r.id).sort(), ['x1', 'x2', 'x3'], 'one row per pipeline: the live pa and the active h2 win');
  assert.equal(s.runs.filter((r) => r.title === 'Ask me').length, 1);
  assert.equal(s.runs.filter((r) => r.title === 'Shipped').length, 1);
  assert.ok(!s.runs.find((r) => r.title === 'Shipped').archived, 'the active row wins over the archived one');
  for (const r of a) { assert.equal(r.group, '', `${r.id} in no group`); assert.equal(r.roundOf, undefined, `${r.id} folds into no round`); assert.equal(r.rounds, undefined); assert.deepEqual(shapeErrors('task', r), []); }
  assert.deepEqual(s.groups, base.groups, 'groups unchanged');
  assert.deepEqual(s.updates, base.updates, 'no outcome updates');
  assert.deepEqual(s.chats, base.chats, 'chats unchanged');
  assert.deepEqual(s.runs.filter((r) => !r.archived), base.runs, 'every other row unchanged');
  assert.deepEqual(Object.keys(partOf('archived', archived, SOURCES, { now: NOW })), ['runs']);
  assert.deepEqual(snapshotOf(SOURCES, { now: NOW }), snapshotOf({ ...SOURCES, archived: undefined }, { now: NOW }), 'no archived source: today\'s output');
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
  assert.equal(projectOf({ key: 'a', exists: true, vcs: 'git' }, { state: 'behind', behind: 2, base: 'main' }).autoSync, true, 'dev syncs before a run unless told not to');
  assert.equal(projectOf({ key: 'a', exists: true, vcs: 'git' }, { state: 'behind', behind: 2, base: 'main', settings: { beforeRun: true } }).autoSync, true);
  assert.equal(projectOf({ key: 'a', exists: true, vcs: 'git' }, { state: 'behind', behind: 2, base: 'main', settings: { beforeRun: false } }).autoSync, false, 'settings.beforeRun false: new tasks start from older code');
  assert.equal(projectOf({ key: 'a', exists: false }).autoSync, true, 'no sync block: dev\'s default');
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

test('snapshotOf: pulseFor follows settings, an unknown value is until-read', () => {
  assert.equal(snapshotOf({ ...SOURCES, settings: { ...SOURCES.settings, pulseFor: '1m' } }, { now: NOW }).pulseFor, '1m');
  assert.equal(snapshotOf({ ...SOURCES, settings: {} }, { now: NOW }).pulseFor, 'until-read');
  assert.equal(snapshotOf({ ...SOURCES, settings: undefined }, { now: NOW }).pulseFor, 'until-read');
  assert.equal(snapshotOf({ ...SOURCES, settings: { pulseFor: 'x' } }, { now: NOW }).pulseFor, 'until-read');
});

test("partOf('settings') replaces keep and pulseFor", () => {
  const p = partOf('settings', { pulseFor: 'never' }, SOURCES, { now: NOW });
  assert.deepEqual(Object.keys(p), ['keep', 'chatPrefs', 'pulseFor']);
  assert.equal(p.pulseFor, 'never');
  assert.equal(p.keep, true);
});

test('partOf replaces only the parts its source feeds', () => {
  const p = partOf('budget', { windowSpendUsd: 3, totalLimitUsd: 10, resetPeriod: 'daily' }, SOURCES, { now: NOW });
  assert.deepEqual(Object.keys(p), ['costs']);
  assert.equal(p.costs.budget.spent, 3);
  assert.deepEqual(Object.keys(partOf('history', { pipelines: [] }, SOURCES, { now: NOW })).sort(), ['chats', 'groups', 'runs', 'updates'], 'a chat\'s tasks are rebuilt with the runs they read');
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

test('scheduleOf: the D10 fields (skip, overlap, fails, ifMissed, tz, pauseWhy, preset, after, ended) and the repeat\'s word', () => {
  const t = new Date(2026, 10, 15, 2, 0).getTime(), skip = new Date(2026, 10, 14, 2, 0).toISOString();
  const s = scheduleOf({ id: 'sch_1', kind: 'recurring', status: 'active', nextRunAt: new Date(t).toISOString(), skippedRunAt: skip, rule: { freq: 'daily', interval: 1, time: '02:00', tz: 'Europe/Berlin' }, sentence: 'Every day at 02:00',
    overlap: 'queue', maxFailures: 2, ifMissed: 'skip', tz: 'Europe/Berlin', presetId: 'pr_1', presetName: 'Nightly preset' }, { now: NOW });
  assert.deepEqual(shapeErrors('schedule', s), []);
  assert.deepEqual({ every: s.every, at: s.at, skip: s.skip, next: s.next, overlap: s.overlap, fails: s.fails, ifMissed: s.ifMissed, tz: s.tz, preset: s.preset, ended: s.ended },
    { every: 'every day', at: '02:00', skip, next: 'Skips next time, then as usual', overlap: 'queue', fails: 2, ifMissed: 'skip', tz: 'Europe/Berlin', preset: 'Nightly preset', ended: false });
  assert.equal(scheduleOf({ id: 'x', kind: 'recurring', status: 'active', rule: { freq: 'daily', interval: 2, time: '02:00', tz: 'UTC' }, sentence: 'Every 2 days at 02:00' }, { now: NOW }).every, 'Every 2 days at 02:00', 'a rule with no word keeps dev\'s sentence');
  assert.equal(scheduleOf({ id: 'x', kind: 'recurring', status: 'active', presetId: 'pr_2', presetName: null }, { now: NOW }).preset, 'preset deleted');
  const p = scheduleOf({ id: 'p', kind: 'recurring', status: 'paused', pauseReason: 'failed 3 times in a row' }, { now: NOW });
  assert.deepEqual([p.pauseWhy, p.skip, p.section], ['failed 3 times in a row', '', 'paused']);
  assert.equal(scheduleOf({ id: 'q', kind: 'recurring', status: 'paused', pauseReason: 'failure_streak', failureStreak: 1, maxFailures: 1 }, { now: NOW }).pauseWhy, 'itself after 1 failure in a row', 'F-G-fid-05: after the word Paused, never "Paused paused itself"');
  assert.equal(scheduleOf({ id: 'u', kind: 'recurring', status: 'paused', pauseReason: 'user' }, { now: NOW }).next, 'Paused by you');
  const e = scheduleOf({ id: 'e', kind: 'recurring', status: 'ended', nextRunAt: null }, { now: NOW });
  assert.deepEqual([e.ended, e.section, e.next, e.nextAt], [true, 'ended', '', null]);
  const a = scheduleOf({ id: 'tk', kind: 'once', status: 'scheduled', runAt: '9999-12-31T00:00:00.000Z', after: { kind: 'pipeline', id: 'p-1', title: 'Build the API' } }, { now: NOW });
  assert.deepEqual([a.after, a.next], ['Build the API', 'after Build the API']);
  assert.ok(snapshotOf({ ...SOURCES, schedules: { schedules: [{ id: 'e', kind: 'recurring', status: 'ended' }], tickets: [] } }, { now: NOW }).schedules.some((x) => x.id === 'e' && x.ended), 'an ended series is listed (its own section)');
});

test('F-G-fid-03, F-G-fid-04: a series has one time, its rule\'s wall time, on its row as on its card and page; its card\'s line is its task, not its cadence again', () => {
  // 02:00 on Nov 13 in Kiritimati (UTC+14) is Nov 12 12:00 UTC: whatever the machine's zone, the instant's local clock is not 02:00
  const s = scheduleOf({ id: 'sch_k', kind: 'recurring', status: 'active', nextRunAt: '2026-11-12T12:00:00.000Z', rule: { freq: 'daily', interval: 1, time: '02:00', tz: 'Pacific/Kiritimati' }, tz: 'Pacific/Kiritimati',
    summary: { target: 'project', workflowId: 'wf_default', prompt: 'Write the changelog digest\nfrom the PRs merged this week', source: null } }, { now: NOW });
  assert.deepEqual(shapeErrors('schedule', s), []);
  assert.equal(s.at, '02:00');
  assert.match(s.time, /(^| )02:00$/, 'the bar row\'s time is the card\'s and the page\'s');
  assert.equal(s.what, 'Write the changelog digest', 'F-G-fid-04: the first line of what it runs');
  assert.equal(scheduleOf({ id: 'src', kind: 'recurring', status: 'active', summary: { prompt: '', source: { title: 'Issue #12 Pager breaks' } } }, { now: NOW }).what, 'Issue #12 Pager breaks', 'a ticket source\'s task when it has no prompt');
  assert.equal(scheduleOf({ id: 'none', kind: 'recurring', status: 'active' }, { now: NOW }).what, '');
});

test('scheduleOf keeps the saved rule (Save keeps its end), the grace window and the run-after ref', () => {
  const rule = { freq: 'daily', interval: 1, time: '02:00', tz: 'UTC', end: { type: 'count', count: 10 } };
  const s = scheduleOf({ id: 'sch_1', kind: 'recurring', status: 'active', rule, graceMin: 60 }, { now: NOW });
  assert.deepEqual(shapeErrors('schedule', s), []);
  assert.deepEqual([s.rule, s.grace], [rule, 60]);
  const a = scheduleOf({ id: 'tk', kind: 'once', status: 'scheduled', runAt: '9999-12-31T00:00:00.000Z', graceMin: 360, after: { kind: 'ticket', id: 'tk_0', title: 'First', policy: 'done' } }, { now: NOW });
  assert.deepEqual(shapeErrors('schedule', a), []);
  assert.deepEqual([a.rule, a.afterRef], [null, { kind: 'ticket', id: 'tk_0', policy: 'done' }]);
});

test('runsOf: a done, failed, missed, skipped and running fire, newest first; a started fire takes its task\'s case', () => {
  const at = (h) => new Date(NOW - h * 3600_000).toISOString();
  const history = [
    { id: 'tk5', status: 'firing', runAt: at(0), title: 'Nightly' },
    { id: 'tk4', status: 'fired', runAt: at(1), pipelineId: 'p-4', title: 'Nightly' },
    { id: 'tk3', status: 'failed', runAt: at(25), failReason: 'the project folder is gone', title: 'Nightly' },
    { id: 'tk2', status: 'missed', runAt: at(49), failReason: 'Worca was off', title: 'Nightly' },
    { id: 'tk1', status: 'skipped', runAt: at(73), failReason: 'skipped by user', title: 'Nightly' },
    { id: 'tk0', status: 'fired', runAt: at(97), pipelineId: 'p-0', title: 'Nightly' },
    { id: 'tk9', status: 'scheduled', runAt: at(-20), title: 'Nightly' },
  ];
  const tasks = [{ id: 'p-4', case: 'working', detail: 'Plan · writing the plan' }, { id: 'p-0', case: 'merged', detail: 'Merged #12' }];
  const runs = runsOf(history, tasks, { now: NOW });
  assert.deepEqual(runs.map((r) => r.case), ['ticket-firing', 'working', 'ticket-failed', 'ticket-missed', 'ticket-skipped', 'merged'], 'a pending ticket is no fire');
  assert.deepEqual(runs.map((r) => r.wid), ['tk5', 'p-4', 'tk3', 'tk2', 'tk1', 'p-0']);
  assert.equal(runs[2].meta, 'the project folder is gone');
  for (const r of runs) for (const k of ['day', 'date', 'time', 'title', 'case', 'git', 'meta', 'wid']) assert.equal(typeof r[k], 'string', k);
});

test('chatOf names the chat\'s project from dev\'s thread context (pinned projectKey); unpinned, none, or a non-object context is no project', () => {
  const projects = [{ key: 'web-1', name: 'web' }];
  assert.equal(chatOf({ id: 'a', context: { pinned: true, projectKey: 'web-1' } }, { projects }).project, 'web');
  assert.equal(chatOf({ id: 'a', context: { pinned: true, projectKey: 'gone-9' } }, { projects }).project, 'gone-9', 'a key Worca no longer lists reads as itself');
  assert.equal(chatOf({ id: 'a', context: { pinned: false, projectKey: 'web-1' } }, { projects }).project, '');
  assert.equal(chatOf({ id: 'a', context: 'SECRET' }, { projects }).project, '');
  // a schedule made from the chat (its askThreadId) is the chat's schedule task, as chats-model.js's are
  const schedules = [scheduleOf({ id: 'sch_1', kind: 'recurring', title: 'Nightly', status: 'active', askThreadId: 'a', nextRunAt: new Date(NOW + 3600e3).toISOString(), rule: { freq: 'daily', interval: 1, time: '02:00', tz: 'UTC' } }, { now: NOW }), scheduleOf({ id: 'sch_2', kind: 'recurring', title: 'Other', status: 'paused', askThreadId: 'b' }, { now: NOW })];
  const st = chatOf({ id: 'a' }, { schedules }).tasks;
  assert.deepEqual(st.map((t) => [t.id, t.kind, t.title]), [['sch_1', 'schedule', 'Nightly']]);
  assert.deepEqual(shapeErrors('chat', chatOf({ id: 'a' }, { schedules })), []);
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
  const ready = taskOfSaved({ id: 'pr', status: 'done', branch: 'feat/x', sourceBranch: 'dev', survived: true, mtime: NOW }, { now: NOW, needs: false });
  assert.equal(ready.case, 'ready');
  assert.equal(w.RailWorld.section(ready), 'recent', 'D7: dev\'s Needs you does not list it');
  assert.equal(taskOfSaved({ id: 'pg', status: 'done', branch: 'feat/x', survived: false, mtime: NOW }, { now: NOW }).case, 'finished-nogit', 'its branch is gone');
  assert.equal(taskOfSaved({ id: 'pm', status: 'done', branch: 'feat/x', survived: true, inBase: { base: 'dev' }, mtime: NOW }, { now: NOW }).case, 'merged', 'already in its base');
  assert.deepEqual(shapeErrors('task', ready), []);
  const open = taskOfSaved({ id: 'po', status: 'done', branch: 'feat/x', survived: true, pr: { url: 'https://github.com/o/r/pull/7', state: 'open' }, mtime: NOW }, { now: NOW, needs: false });
  assert.equal(open.case, 'checks', 'its PR is open: In review, View PR, never Create PR');
  assert.equal(open.pr, 'https://github.com/o/r/pull/7');
  const closedRow = { id: 'pc', status: 'done', branch: 'feat/x', sourceBranch: 'dev', survived: true, pr: { url: 'https://github.com/o/r/pull/8', state: 'CLOSED' }, mtime: NOW };
  const closed = taskOfSaved(closedRow, { now: NOW, needs: false });
  assert.equal(closed.case, 'ready', 'its PR was closed unmerged: Ready, Create PR again');
  const c = chatOf({ id: 't1' }, { links: [{ threadId: 't1', runId: 'pc', started: true }], tasks: [closed] });
  assert.equal(c.tasks[0].git, undefined, 'a closed PR is not watched as open');
});

// B1.7 (#1321): a finished task with its branch and no PR offers Create PR only when a remote exists and its base is known
const FIN = (extra = {}) => ({ id: 'pz', status: 'done', branch: 'feat/x', sourceBranch: 'docs/rail-agreed', survived: true, projectKey: 'web-1', mtime: NOW, ...extra });
const NO_REMOTE = { base: 'main', remote: null, state: 'unknown' }, REMOTE = { base: 'main', remote: 'origin', state: 'up-to-date' };
const srcWith = (rows, sync) => ({ ...SOURCES, history: { pipelines: rows }, hello: { runs: [] }, sync: { projects: sync } });

test('F-3-03: a finished task whose project\'s sync block has no remote reads no-remote, never ready', () => {
  assert.equal(taskOfSaved(FIN(), { now: NOW, needs: false, sync: NO_REMOTE }).case, 'no-remote');
  assert.equal(taskOfSaved(FIN(), { now: NOW, needs: false, sync: REMOTE }).case, 'ready');
  const s = snapshotOf(srcWith([FIN()], { 'web-1': NO_REMOTE }), { now: NOW });
  assert.equal(s.runs.find((r) => r.id === 'pz').case, 'no-remote');
  // no remote wins over an unknown base: linking a remote is the first fix
  assert.equal(taskOfSaved(FIN({ sourceBranch: '' }), { now: NOW, needs: false, sync: NO_REMOTE }).case, 'no-remote');
  // an open PR still reads its PR's case
  assert.equal(taskOfSaved(FIN({ pr: { url: 'https://github.com/o/r/pull/7', state: 'open' } }), { now: NOW, needs: false, sync: NO_REMOTE }).case, 'checks');
});

test('B1.7 unknown base: a finished task whose sourceBranch is empty or a SHA reads no-base', () => {
  for (const sourceBranch of ['', undefined, 'a1b2c3d', '0123456789abcdef0123456789abcdef01234567']) {
    assert.equal(taskOfSaved(FIN({ sourceBranch }), { now: NOW, needs: false, sync: REMOTE }).case, 'no-base', String(sourceBranch));
  }
  assert.equal(taskOfSaved(FIN({ sourceBranch: 'main' }), { now: NOW, needs: false, sync: REMOTE }).case, 'ready');
  assert.equal(knownBase('docs/rail-agreed'), 'docs/rail-agreed');
  assert.equal(knownBase('deadbeef'), '', 'a SHA (or a hex-looking name) is no base');
  assert.equal(knownBase('abc123'), 'abc123', 'shorter than a short SHA: a name');
  assert.equal(knownBase(''), '');
  assert.equal(knownBase(null), '');
  assert.equal(knownBase(42), '');
});

test('B1.7: no-remote and no-base sort as ready does (overOf), Needs you unchanged', () => {
  const w = stillhetHost({ after });
  for (const [row, sync, c] of [[FIN(), NO_REMOTE, 'no-remote'], [FIN({ sourceBranch: '' }), REMOTE, 'no-base']]) {
    const t = taskOfSaved(row, { now: NOW, needs: false, sync });
    assert.equal(t.case, c);
    assert.equal(t.over, true, c);
    assert.equal(w.RailWorld.section(t), 'recent', c);
    assert.equal(overOf({ ...row, needs: true }, c), false, `${c}: listed by dev's Needs you, it is not over`);
  }
  const rows = [FIN(), FIN({ id: 'py', sourceBranch: '' })];
  const plain = needsYouItems({ live: [], history: rows.map((r) => ({ kind: 'hist', id: r.id, status: r.status })) });
  const s = snapshotOf(srcWith(rows, { 'web-1': NO_REMOTE }), { now: NOW });
  assert.deepEqual(s.runs.filter((r) => r.over).map((r) => r.id).sort(), ['py', 'pz']);
  assert.equal(plain.history.length, 0, 'dev\'s Needs you lists neither');
});

test('F-3-03: a sync refetch re-decides the task\'s case (partOf sync replaces runs)', () => {
  const src = srcWith([FIN()], { 'web-1': REMOTE });
  assert.equal(snapshotOf(src, { now: NOW }).runs.find((r) => r.id === 'pz').case, 'ready');
  const p = partOf('sync', { projects: { 'web-1': NO_REMOTE } }, src, { now: NOW });
  assert.ok(p.runs, 'sync feeds the runs');
  assert.equal(p.runs.find((r) => r.id === 'pz').case, 'no-remote');
  assert.deepEqual(Object.keys(p).sort(), ['chats', 'groups', 'projects', 'runs']);
});

test('F-3-03: no sync block loaded keeps ready (classic\'s rule); a workspace task keeps ready', () => {
  assert.equal(taskOfSaved(FIN(), { now: NOW, needs: false }).case, 'ready');
  assert.equal(snapshotOf(srcWith([FIN()], {}), { now: NOW }).runs.find((r) => r.id === 'pz').case, 'ready');
  const ws = { id: 'w1', status: 'done', branch: 'worca/ws0', survived: true, projectKey: 'workspaces/w1', mtime: NOW, members: [{ memberKey: 'api', survived: true }] };
  assert.equal(taskOfSaved(ws, { now: NOW, needs: false, sync: NO_REMOTE }).case, 'ready', 'D14: per-member remotes are B3.2');
});

test('a chat\'s task keeps its link\'s pipeline id (Resume posts it), whatever id the store holds', () => {
  const c = chatOf({ id: 't1' }, { links: [{ threadId: 't1', runId: 'r1', pipelineId: 'p1', started: true }], tasks: [{ id: 'r1', title: 'A', case: 'paused-restart', detail: '' }] });
  assert.equal(c.tasks[0].run, 'r1');
  assert.equal(c.tasks[0].pid, 'p1');
});

test('caseOf (D5): plan, recovery, capped; an open PR from its checks entry (approved, failing, conflicts, checks), else prNeeds', async () => {
  const { caseOf, prCaseOf } = await import('../ui/public/stillhet/live/live-map.mjs');
  assert.equal(caseOf({ kind: 'live', status: 'running', ask: true, askKind: 'plan' }), 'plan');
  assert.equal(caseOf({ kind: 'live', status: 'running', ask: true, askKind: 'recovery' }), 'recovery');
  assert.equal(caseOf({ kind: 'hist', status: 'paused', pauseReason: 'cost_pipeline' }), 'capped');
  assert.equal(caseOf({ kind: 'live', status: 'paused', pauseReason: 'error' }), 'failed', 'a step dev\'s failure policy paused is c17\'s failed case: Retry (D10)');
  assert.equal(caseOf({ kind: 'live', status: 'paused', pauseReason: 'user' }), 'paused-restart');
  const pr = { url: 'https://github.com/o/r/pull/9', state: 'OPEN' };
  const done = { kind: 'hist', status: 'done', pr };
  const entry = (state, mergeable = 'MERGEABLE') => ({ checks: { state }, mergeable });
  assert.equal(caseOf(done, { checks: entry('passing') }), 'approved');
  assert.equal(caseOf(done, { checks: entry('failing') }), 'failing');
  assert.equal(caseOf(done, { checks: entry('passing', 'CONFLICTING') }), 'conflicts');
  assert.equal(caseOf(done, { checks: entry('pending') }), 'checks');
  assert.equal(prCaseOf(null), null);
  // No entry yet: dev's prNeeds is the fallback, else checks.
  assert.equal(caseOf(done), 'checks');
  assert.equal(caseOf({ ...done, needs: true }), 'failing');
  assert.equal(caseOf({ ...done, needs: true, pr: { ...pr, mergeable: 'CONFLICTING' } }), 'conflicts');
  assert.equal(caseOf({ ...done, merged: true }, { checks: entry('failing') }), 'merged', 'a merged PR is merged whatever its checks');
});

test('a finished workspace task whose project branches survive is ready: dev reports survived per project (members[])', () => {
  const ws = { id: 'w1', status: 'done', branch: 'worca/ws0', survived: false, mtime: NOW, members: [{ memberKey: 'api', survived: true }, { memberKey: 'web', survived: false }] };
  assert.equal(taskOfSaved(ws, { now: NOW, needs: false }).case, 'ready');
  assert.notEqual(taskOfSaved({ ...ws, members: [{ memberKey: 'api', survived: false }] }, { now: NOW, needs: false }).case, 'ready', 'no project kept its branch');
});

test('runGroupsOf: dev\'s run groups fold their tasks (by pipeline id, or its live run) under one group row', () => {
  const runs = [{ id: 'run-a', case: 'working', project: 'web', time: '14:10', day: 'today' }, { id: 'h2', case: 'merged', project: 'web', time: 'Tue', day: 'earlier' }];
  const { groups, inGroup } = runGroupsOf({ groups: [{ id: 'G', kind: 'user', title: 'Pager', cost: { usd: 2 }, members: [{ pipelineId: 'pa', position: 1, adhoc: true }, { pipelineId: 'h2', position: 2, adhoc: true }] }, { id: 'E', title: 'Empty', members: [{ pipelineId: 'nope' }] }] },
    runs, { now: NOW, rowIdOf: new Map([['pa', 'run-a']]) });
  assert.deepEqual(groups, [{ id: 'G', kind: 'user', case: 'feature', title: 'Pager', project: 'web', time: '14:10', day: 'today', cost: 2 }]);
  assert.deepEqual([...inGroup], [['run-a', 'G'], ['h2', 'G']]);
  assert.deepEqual(runs.map((r) => [r.adhoc, r.pos]), [[true, 1], [true, 2]], 'a user group\'s members were added by hand: the list offers Remove from group');
  // a feature's slice is the feature's own; a task added to it by hand is adhoc (dev's member `adhoc`), at its own position
  const fr = [{ id: 's1', case: 'working', project: 'web' }, { id: 'x9', case: 'working', project: 'web' }];
  const f = runGroupsOf({ groups: [{ id: 'F', kind: 'feature', title: 'Feat', members: [{ pipelineId: 's1', position: 1, adhoc: false }, { pipelineId: 'gone', position: 2, adhoc: false }, { pipelineId: 'x9', position: 3, adhoc: true }] }] }, fr, { now: NOW });
  assert.deepEqual(fr.map((r) => [r.adhoc, r.pos]), [[false, 1], [true, 3]], 'adhoc per member, from dev, not by the group\'s kind');
  // F-3-06: only a member that has run and whose row the store lacks (archived) is left out; one not started yet is a task
  assert.deepEqual([[...f.inGroup.keys()], f.members], [['s1', 'x9'], []], 'the archived member `gone` is left out, no task made for it');
  assert.deepEqual(shapeErrors('group', groups[0]), []);
  assert.deepEqual(partOf('runGroups', { groups: [] }, SOURCES, { now: NOW }).groups, [], 'a refetch of the groups rebuilds the groups and the rows');
});

test('runGroupsOf: a group reads as its members: Working while one works, else its first unmerged member\'s case (web-UI review cycle 2)', () => {
  const caseOfGroup = (cases) => runGroupsOf({ groups: [{ id: 'G', kind: 'user', title: 'QA', members: cases.map((_, i) => ({ pipelineId: `p${i}`, position: i + 1 })) }] },
    cases.map((c, i) => ({ id: `p${i}`, case: c, project: 'web' })), { now: NOW }).groups[0].case;
  assert.equal(caseOfGroup(['approved']), 'approved', 'a done, approved task alone in a group: Ready to merge, never Working');
  assert.equal(caseOfGroup(['merged', 'failing', 'approved']), 'failing', 'the next one in stack order');
  assert.equal(caseOfGroup(['approved', 'working']), 'feature', 'one still works: the group works');
  assert.equal(caseOfGroup(['merged', 'merged']), 'merged');
  const src = JSON.parse(JSON.stringify(SOURCES));
  src.runGroups = { groups: [{ id: 'G', kind: 'user', title: 'QA', members: [{ pipelineId: 'h2', position: 1 }] }] };
  assert.ok(partOf('history', src.history, src, { now: NOW }).groups, 'a history refetch rebuilds the groups its rows feed');
});

test('a Restart Build or PR-fix round folds under its origin: the origin carries its rounds, the round stays openable (web-UI review cycle 1)', () => {
  const src = JSON.parse(JSON.stringify(SOURCES));
  const origin = src.history.pipelines.find((p) => p.id === 'h3');
  src.history.pipelines.push({ id: 'h3r2', title: 'Restart Build: Broke', status: 'done', projectName: 'web', startedAt: origin.startedAt, mtime: origin.mtime,
    roundOf: { pipelineId: 'h3', round: 2, request: '', by: 'restart' } });
  const s = snapshotOf(src, { now: NOW });
  const round = s.runs.find((r) => r.id === 'h3r2'), top = s.runs.find((r) => r.id === 'h3');
  assert.equal(round.roundOf, 'h3', 'the round names its origin, and stays in the store for its own page');
  assert.deepEqual(top.rounds.list.map((x) => [x.n, x.words, x.case]), [[2, 'restart Build · done', 'h3r2']]);
  assert.equal(top.rounds.line, 'Round 2 · restart Build · done');
  for (const r of s.runs) assert.deepEqual(shapeErrors('task', r), [], r.id);
  // a round whose origin is not in the store stays a row of its own
  src.history.pipelines = src.history.pipelines.filter((p) => p.id !== 'h3');
  assert.equal(snapshotOf(src, { now: NOW }).runs.find((r) => r.id === 'h3r2').roundOf, undefined);
});

test('an origin whose round is live or needs you takes that round\'s case, so the row stays lit (code review r9)', () => {
  const src = JSON.parse(JSON.stringify(SOURCES));
  const origin = src.history.pipelines.find((p) => p.id === 'h3');
  const calm = snapshotOf(src, { now: NOW }).runs.find((r) => r.id === 'h3').case;
  // a paused round that needs you: the origin reads the round's Paused, not its own case
  src.history.pipelines.push({ id: 'h3r2', title: 'Restart Build: Broke', status: 'paused', projectName: 'web', startedAt: origin.startedAt, mtime: origin.mtime,
    roundOf: { pipelineId: 'h3', round: 2, request: '', by: 'restart' } });
  let s = snapshotOf(src, { now: NOW });
  const round = s.runs.find((r) => r.id === 'h3r2');
  let top = s.runs.find((r) => r.id === 'h3');
  assert.notEqual(round.case, calm);
  assert.equal(top.case, round.case, 'the origin reads its needy round\'s case');
  assert.equal(top.opens, 'h3r2', 'and its row opens that round');
  assert.equal(!!top.over, !!round.over);
  // a live round (running now): the origin reads Working
  src.history.pipelines = src.history.pipelines.filter((p) => p.id !== 'h3r2');
  src.hello = { runs: [...(src.hello?.runs || []), { runId: 'live-r3', pipelineId: 'h3r3', status: 'running', title: 'Fix: Broke', projectName: 'web', startedAt: origin.startedAt,
    branch: { roundOf: { pipelineId: 'h3', round: 3, request: 'fix the checks', by: 'pr-fix' } } }] };
  s = snapshotOf(src, { now: NOW });
  top = s.runs.find((r) => r.id === 'h3');
  assert.equal(top.case, 'working');
  assert.equal(top.opens, 'live-r3', 'the live round');
  assert.equal(top.over, undefined);
  // a finished, calm round leaves the origin's own case
  src.hello.runs = [];
  src.history.pipelines.push({ id: 'h3r4', title: 'Fix', status: 'stopped', projectName: 'web', startedAt: origin.startedAt, mtime: origin.mtime, roundOf: { pipelineId: 'h3', round: 4, request: '', by: 'restart' } });
  assert.equal(snapshotOf(src, { now: NOW }).runs.find((r) => r.id === 'h3').case, calm);
});

test('costsOf: the usage rings are the harnesses\' own readings (D8); a limit pause still draws its session at 100', () => {
  const at = NOW + 2 * 3600e3;   // two hours on: today's clock
  const limits = { harnesses: [{ engine: 'claude', observedAt: NOW - 60e3, windows: [{ kind: 'session', pct: 28, resetsAt: at }, { kind: 'week', pct: 48, resetsAt: NOW + 3 * 86400e3 }] }] };
  const u = costsOf(null, [], { now: NOW, limits }).usage;
  assert.deepEqual(u.map((x) => [x.p, x.win.map((w) => [w.k, w.pct])]), [['claude', [['session', 28], ['week', 48]]]]);
  assert.equal(u[0].win[0].resets, '17:00', 'the reset word names the reset time');
  assert.equal(u[0].asOf, '14:59');
  assert.deepEqual(shapeErrors('costs', costsOf(null, [], { now: NOW, limits })), []);
  const paused = [{ status: 'paused', limitEngine: 'claude', limitResetAt: at }];
  assert.deepEqual(costsOf(null, paused, { now: NOW, limits }).usage.map((x) => x.win.map((w) => [w.k, w.pct])), [[['session', 100], ['week', 48]]], 'the pause wins the session ring');
  assert.deepEqual(costsOf(null, [], { now: NOW, limits: { harnesses: [{ engine: 'claude', windows: [{ kind: 'session', pct: null, resetsAt: at }] }] } }).usage, [], 'no utilisation, no ring');
  assert.deepEqual(costsOf(null, [], { now: NOW, limits: { harnesses: [{ engine: 'claude', windows: [{ kind: 'session', pct: 9, resetsAt: NOW - 1 }] }] } }).usage, [], 'an expired reading draws nothing');
  assert.deepEqual(costsOf(null, [], { now: NOW, limits: { harnesses: [] } }).usage, [], 'empty readings, 0 rings');
  assert.deepEqual(costsOf(null, [{ status: 'done', engine: 'codex' }], { now: NOW, limits }).usage.map((x) => x.p), ['claude'], 'a Codex run with no reading draws no Codex ring');
  assert.deepEqual(snapshotOf({ ...SOURCES, usageLimits: limits }, { now: NOW }).costs.usage.map((x) => x.p), ['claude'], 'the snapshot reads the usageLimits source');
  assert.deepEqual(partOf('usageLimits', limits, SOURCES, { now: NOW }).costs.usage.map((x) => x.p), ['claude'], 'a usage-limits-changed refetch redraws the rings');
});

test('spacesOf: only the scan\'s answerable edges and dev\'s live ones become links; stale and missing never order or ask (code review r1)', () => {
  const edge = (id, state, confidence = 'heuristic') => ({ id, from: 'a', to: 'b', kind: 'http', confidence, state });
  const [w] = spacesOf({ workspaces: [{ id: 'w1', name: 'W', projectKeys: ['a', 'b'] }],
    maps: { w1: { edges: [edge('e1', 'auto'), edge('e2', 'confirmed'), edge('e3', 'rejected'), edge('e4', 'manual', undefined), edge('e5', 'stale'), edge('e6', 'missing')] } } });
  assert.deepEqual(w.links.map((l) => [l.id, l.state]), [['e1', 'auto'], ['e2', 'confirmed'], ['e3', 'rejected'], ['e4', 'manual']]);
  assert.deepEqual(shapeErrors('space', w), []);
});

test('slice 9 D5: projectOf carries devPath, ownedFolder and vcs; spacesOf carries paths in member order and a link at from its evidence', () => {
  const p = projectOf({ key: 'k', name: 'n', path: '/real/n', displayPath: '~/n', vcs: 'none', ownedFolder: true, exists: true });
  assert.deepEqual([p.devPath, p.path, p.ownedFolder, p.vcs], ['/real/n', '~/n', true, 'none']);
  assert.equal(projectOf({ key: 'k', path: '/x', vcs: 'git' }).ownedFolder, false);
  assert.equal(projectOf({ key: 'k', path: '/x', vcs: 'git' }).vcs, 'git');
  const edge = (id, evidence) => ({ id, from: 'a', to: 'b', kind: 'http', confidence: 'heuristic', state: 'auto', ...(evidence ? { evidence } : {}) });
  const [w] = spacesOf({ workspaces: [{ id: 'w1', name: 'W', projectKeys: ['a', 'b'], projectPaths: ['/p/a', '/p/b'] }],
    maps: { w1: { edges: [edge('e1', { from: [{ file: 'src/client.js', line: 3 }, { file: 'src/other.js', line: 9 }], to: [] }), edge('e2'), edge('e3', { from: [] })] } } });
  assert.deepEqual(w.paths, ['/p/a', '/p/b']);
  assert.equal(w.links[0].at, 'src/client.js:3');
  assert.ok(!('at' in w.links[1]) && !('at' in w.links[2]), 'no evidence, no at');
  assert.deepEqual(shapeErrors('space', w), []);
  assert.deepEqual(shapeErrors('project', p), []);
});

// ---- B3.2 (#1355): five wrong-data findings of the real-data walk ----
test('F-a4-05: a series\' own ticket is neither a Schedules row nor a waiting task; a one-off ticket still is', () => {
  const next = new Date(NOW + 3600000).toISOString();
  const src = { ...SOURCES, schedules: { schedules: [{ id: 'S', kind: 'recurring', status: 'active', title: 'Nightly', nextRunAt: next, rule: null }],
    tickets: [{ id: 'T1', kind: 'once', scheduleId: 'S', status: 'scheduled', title: 'Nightly', runAt: next }, { id: 'T2', kind: 'once', scheduleId: null, status: 'scheduled', title: 'Once', runAt: next },
      { id: 'T3', kind: 'once', scheduleId: 'S', status: 'missed', title: 'Nightly', runAt: new Date(NOW - 3600000).toISOString() }] } };
  const snap = snapshotOf(src, { now: NOW });
  assert.deepEqual(snap.schedules.map((x) => x.id).sort(), ['S', 'T2'], 'one row per series, the one-off ticket kept');
  const ids = snap.runs.map((r) => r.id);
  for (const id of ['sched:S', 'sched:T2', 'sched:T3']) assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes('sched:T1'), 'the series\' pending ticket is its series row, never a second one');
  assert.equal(updateOf({ id: 1, kind: 'missed', ticketId: 'T3' }, { now: NOW }).run, 'sched:T3', 'Pulse\'s Run now still names a row the store holds');
});

const FEATURE = (members) => ({ groups: [{ id: 'F', kind: 'feature', title: 'Run tags', cost: { usd: 3 }, members }] });
const SLICES = [{ position: 1, pipelineId: 'p1', title: 'Store tags', adhoc: false }, { position: 2, pipelineId: 'p2', title: 'Filter by tag', adhoc: false },
  { position: 3, pipelineId: null, ticketId: 't3', title: 'Tag chips', ticket: { id: 't3', status: 'scheduled' }, after: 2, adhoc: false }];
test('F-3-06: runGroupsOf keeps a member without a run: it adopts its ticket\'s sched: row, else a member task, and a native slice reads its slice title', () => {
  const task = (id, title, c) => ({ id, case: c, title, project: 'web', detail: '', time: '10:00', day: 'today', labels: [], cost: null, archived: false, unread: false, pr: '', group: '', kind: 'Git', by: '', workflow: '' });
  const runs = [task('p1', 'Run tags · 1/3: Store tags', 'merged'), task('p2', 'Run tags · 2/3: Filter by tag', 'working')];
  const r = runGroupsOf(FEATURE([...SLICES, { position: 4, pipelineId: null, ticketId: 't4', title: 'Docs', ticket: { id: 't4', status: 'missed' }, after: null, adhoc: false }]), runs, { now: NOW });
  assert.deepEqual([...r.inGroup.keys()], ['p1', 'p2', 'member:F:3', 'member:F:4'], 'every member, in position order');
  assert.deepEqual(r.members.map((m) => [m.id, m.case, m.title, m.detail, m.day, m.when, m.pos]), [
    ['member:F:3', 'scheduled', 'Tag chips', 'Starts when “Filter by tag” finishes', 'upcoming', 'after', 3],
    ['member:F:4', 'ticket-missed', 'Docs', 'Not started yet', 'upcoming', 'after', 4]]);
  for (const m of r.members) assert.deepEqual(shapeErrors('task', m), [], m.id);
  assert.deepEqual(runs.map((x) => x.title), ['Store tags', 'Filter by tag'], 'a native slice reads its slice title, not its run title');
  assert.equal(r.groups[0].case, 'feature', 'one still works');
  // the ticket's own waiting row is the member: adopted, never a second row
  const sched = { ...task('sched:t3', 'Tag chips', 'scheduled'), day: 'upcoming', when: 'today' };
  const withRow = [...runs, sched], a = runGroupsOf(FEATURE(SLICES), withRow, { now: NOW });
  assert.deepEqual(a.members, []);
  assert.equal(a.inGroup.get('sched:t3'), 'F');
  assert.deepEqual([sched.detail, sched.when, sched.pos], ['Starts when “Filter by tag” finishes', 'after', 3]);
  // an ad-hoc member keeps its run's title
  const adhoc = [task('p1', 'My own run', 'working')];
  runGroupsOf(FEATURE([{ position: 1, pipelineId: 'p1', title: 'My own run', adhoc: true }]), adhoc, { now: NOW });
  assert.equal(adhoc[0].title, 'My own run');
});

test('F-3-06: through snapshotOf, the group\'s members are 3 tasks with group F, sorted by pos, two started and one scheduled', () => {
  const src = JSON.parse(JSON.stringify(SOURCES));
  src.history.pipelines.push({ id: 'p1', title: 'Run tags · 1/3: Store tags', status: 'done', projectName: 'web', startedAt: NOW - 7200000, mtime: NOW - 3600000 },
    { id: 'p2', title: 'Run tags · 2/3: Filter by tag', status: 'running', projectName: 'web', startedAt: NOW - 1800000, mtime: NOW - 600000 });
  src.schedules = { schedules: [], tickets: [{ id: 't3', kind: 'once', scheduleId: null, status: 'scheduled', title: 'Run tags · 3/3: Tag chips', after: { kind: 'run', id: 'p2', policy: 'done' } }] };
  src.runGroups = FEATURE(SLICES);
  const snap = snapshotOf(src, { now: NOW });
  const ms = snap.runs.filter((r) => r.group === 'F').sort((a, b) => a.pos - b.pos);
  assert.deepEqual(ms.map((m) => [m.id, m.title]), [['p1', 'Store tags'], ['p2', 'Filter by tag'], ['sched:t3', 'Tag chips']]);
  assert.equal(ms.filter((m) => m.case !== 'scheduled').length, 2);
  const ids = snap.runs.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, 'one id per store row');
  for (const r of snap.runs) assert.deepEqual(shapeErrors('task', r), [], r.id);
  assert.deepEqual(Object.keys(partOf('schedules', src.schedules, src, { now: NOW })).sort(), ['chats', 'groups', 'runs', 'schedules'], 'a schedules refetch rebuilds the groups its rows join, and the chats that list them');
});

test('F-a2-03: a chat that started a feature member lists the feature\'s other members (started and unstarted) as its tasks, in position order, with group and pos', () => {
  const src = JSON.parse(JSON.stringify(SOURCES));
  src.history.pipelines.push({ id: 'p1', title: 'Store tags', status: 'done', projectName: 'web', startedAt: NOW - 7200000, mtime: NOW - 3600000 },
    { id: 'p2', title: 'Filter by tag', status: 'running', projectName: 'web', startedAt: NOW - 1800000, mtime: NOW - 600000 });
  src.schedules = { schedules: [], tickets: [] };
  src.runGroups = FEATURE(SLICES);
  src.runLinks = { links: [{ threadId: 'ask_1', runId: 'p1', pipelineId: 'p1', started: true }] };
  const c = snapshotOf(src, { now: NOW }).chats.find((x) => x.id === 'ask_1');
  assert.deepEqual(c.tasks.map((t) => [t.id, t.group, t.pos, !!t.followed]), [['p1', 'F', 1, false], ['p2', 'F', 2, false], ['member:F:3', 'F', 3, false]]);
  assert.deepEqual(shapeErrors('chat', c), []);
  // a chat of no feature member lists none
  assert.deepEqual(snapshotOf(src, { now: NOW }).chats.find((x) => x.id === 'ask_2').tasks.map((t) => t.id), []);  // a runGroups refetch (a member added to the feature) rebuilds the chat's task list too, not only at the next history read
  const more = FEATURE([...SLICES, { position: 4, pipelineId: null, ticketId: 't4', title: 'Docs', ticket: { id: 't4', status: 'scheduled' }, after: 3, adhoc: false }]);
  const part = partOf('runGroups', more, { ...src, runGroups: more }, { now: NOW });
  assert.deepEqual(part.chats.find((x) => x.id === 'ask_1').tasks.map((t) => t.id), ['p1', 'p2', 'member:F:3', 'member:F:4']);
});

test('F-a2-03: an unlinked live member of the chat\'s feature carries its pipeline id as pid (the id dev\'s per-task acts take), its run id as run', () => {
  const src = JSON.parse(JSON.stringify(SOURCES));
  src.history.pipelines.push({ id: 'p1', title: 'Store tags', status: 'done', projectName: 'web', startedAt: NOW - 7200000, mtime: NOW - 3600000 });
  src.schedules = { schedules: [], tickets: [] };
  src.runGroups = FEATURE([{ position: 1, pipelineId: 'p1', title: 'Store tags', adhoc: false }, { position: 2, pipelineId: 'pb', title: 'Busy', adhoc: false }]);
  src.runLinks = { links: [{ threadId: 'ask_1', runId: 'p1', pipelineId: 'p1', started: true }] };
  const c = snapshotOf(src, { now: NOW }).chats.find((x) => x.id === 'ask_1');
  assert.deepEqual(c.tasks.map((t) => [t.id, t.run, t.pid]), [['p1', 'p1', 'p1'], ['run-b', 'run-b', 'pb']]);
});

test('F-6-03: a git project whose sync block has remote:null reads origin local (Only on this computer, Link a remote), without an origin/ base, and does not need you', () => {
  const p = { key: 'a', exists: true, vcs: 'git' };
  const local = projectOf(p, { state: 'unknown', remote: null, base: 'main' });
  assert.deepEqual([local.origin, local.base, local.branch, local.needs], ['local', undefined, 'main', false]);
  assert.ok(!('base' in local));
  assert.equal(projectOf(p, null).origin, 'ok', 'a block not loaded yet stays ok (B1.7 D3)');
  assert.equal(projectOf(p, { state: 'unknown', remote: 'origin', base: 'main' }).origin, 'ok');
  assert.equal(projectOf(p, { state: 'unknown', remote: 'origin', base: 'main' }).base, 'origin/main');
  assert.equal(projectOf({ key: 'a', exists: true, vcs: 'none' }, { state: 'unknown', remote: null }).origin, 'folder');
  assert.equal(projectOf(p, { state: 'unknown', remote: null, fetchError: 'boom' }).origin, 'offline', 'a failed fetch is offline, not local');
});

test('F-3-09: taskOfSaved takes workflow from the row\'s workflowName; none → \'\'', () => {
  const lean = taskOfSaved({ id: 'h-lean', status: 'done', workflowId: 'wf_lean', workflowName: 'Lean' }, { now: NOW });
  assert.equal(lean.workflow, 'Lean');
  assert.deepEqual(shapeErrors('task', lean), []);
  for (const row of [{ id: 'h0', status: 'done' }, { id: 'h1', status: 'done', workflowId: 'wf_gone' }, { id: 'h2', status: 'done', workflowName: 7 }]) {
    const t = taskOfSaved(row, { now: NOW });
    assert.equal(t.workflow, '', row.id);
    assert.deepEqual(shapeErrors('task', t), [], row.id);
  }
});

test('F-3-09: taskOfLive takes workflow from stepper.template.name; no stepper → \'\'', () => {
  const lean = taskOfLive({ runId: 'r-lean', status: 'running', stepper: { version: 2, template: { id: 'wf_lean', name: 'Lean' } } }, { now: NOW });
  assert.equal(lean.workflow, 'Lean');
  assert.deepEqual(shapeErrors('task', lean), []);
  for (const run of [{ runId: 'r0', status: 'running' }, { runId: 'r1', status: 'running', stepper: { version: 1, steps: [] } }, { runId: 'r2', status: 'running', stepper: null }]) {
    const t = taskOfLive(run, { now: NOW });
    assert.equal(t.workflow, '', run.runId);
    assert.deepEqual(shapeErrors('task', t), [], run.runId);
  }
});
