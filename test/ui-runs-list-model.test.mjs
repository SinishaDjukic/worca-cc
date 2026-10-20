// test/ui-runs-list-model.test.mjs — the Runs list model (ui/public/runs-list.mjs, runs redesign §3.1): the state
// words ⌘K and the Activity menu still read, times, Needs you, the sections (Needs you · Running · Recent), Show and
// Group by, groups and their members, the one status line, cost, and the DOM the list is built from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import {
  rowTime, liveRowState, histRowState, schedRowState, countNeedsYou, needsYouItems,
  buildRunsModel, isRowSelected, renderRunsList, dateBucket, DATE_BUCKETS, listLine, groupRow, groupCostUsd, costTitle,
} from '../ui/public/runs-list.mjs';
import { RUN_STATES } from '../src/shared/run-model.mjs';
import { checkRows } from './helpers/rows.mjs';

const NOW = new Date(2026, 8, 30, 15, 0).getTime();           // Wed Sep 30 2026, 15:00 local
const at = (d, h, m) => new Date(2026, 8, d, h, m).toISOString();
const liveIt = (runId, extra = {}) => ({
  runId, pipelineId: '', title: runId, status: 'running', ask: null, pauseReason: '', unread: false,
  step: '', failedStep: '', startedAt: at(30, 12, 34), groupKey: 'emp-00000001', groupName: 'Employee project',
  by: '', pr: null, checks: null, files: null, ...extra,
});
const histIt = (id, extra = {}) => ({
  id, projectKey: 'worca-00000002', title: id, status: 'done', pauseReason: null,
  startedAt: at(30, 11, 17), mtime: 0, groupName: 'worca-cc', by: '', pr: 'MERGED', checks: null, files: null, ...extra,
});
const rowsOf = (m) => m.sections.flatMap((s) => s.rows);
const keysOf = (m) => rowsOf(m).map((r) => r.key);
const doc = new JSDOM('<!doctype html><body></body>').window.document;

// Model-shaped rows for listLine: `row` a single run, `groupRowOf` a group whose current member is run `index`.
const row = (state, prog = null, extra = {}) => ({ kind: 'live', model: { state, word: RUN_STATES[state].word, line: '', progress: prog, pr: null, ...extra } });
function groupRowOf(state, index, stage) {
  const members = Array.from({ length: Math.max(index, 3) }, () => ({ state: 'waiting', progress: null }));
  const current = { state, progress: stage ? { mode: 'stages', label: stage } : null };
  members[index - 1] = current;
  return { kind: 'chain', model: { state, word: RUN_STATES[state].word, current, members, planning: null, pr: null, line: '' } };
}

test('rowTime: the clock today, the weekday this week, the date beyond', () => {
  assert.equal(rowTime(at(30, 11, 17), NOW), '11:17');
  assert.equal(rowTime('09:18:05', NOW), '09:18', 'a live run’s bare start time is today');
  assert.equal(rowTime(at(29, 10, 0), NOW), 'Tue');
  assert.equal(rowTime(at(12, 10, 0), NOW), 'Sep 12');
  assert.equal(rowTime(new Date(2025, 11, 3).toISOString(), NOW), 'Dec 3, 2025');
  assert.equal(rowTime('', NOW), '');
  assert.equal(rowTime('not a date', NOW), '');
  assert.equal(rowTime(0, NOW), '', 'mtime 0 (no updated_at) is unknown, not Jan 1, 1970');
});

test('live row states: questions name their step, pause reasons, a named failure, the step while running', () => {
  assert.deepEqual(liveRowState({ status: 'running', ask: { kind: 'workflow', step: '' } }),
    { icon: 'ask', word: 'Workflow review', detail: '' });
  assert.equal(liveRowState({ status: 'running', ask: { kind: 'workflow', step: 'Plan' } }).word, 'Plan review',
    'the mockup’s "Plan review"');
  assert.equal(liveRowState({ status: 'running', ask: { kind: 'gate', step: '' } }).word, 'Approval needed');
  assert.equal(liveRowState({ status: 'running', ask: { kind: 'questions', step: 'Plan' } }).word, 'Plan question');
  assert.equal(liveRowState({ status: 'running', ask: { kind: '', step: '' } }).word, 'Question');
  // D33: Shaper's plan ask names the decision, not "Plan question".
  assert.equal(liveRowState({ status: 'running', ask: { kind: 'plan', step: 'Plan' } }).word, 'Approve the plan');
  assert.equal(liveRowState({ status: 'running', ask: { kind: 'plan', step: 'Plan', outline: true } }).word, 'Approve the slices');
  assert.equal(liveRowState({ status: 'paused', pauseReason: 'cost_pipeline' }).word, 'Cost limit');
  assert.equal(liveRowState({ status: 'paused', pauseReason: 'usage_limit', limitEngine: 'codex' }).word, 'Codex usage limit', 'a usage limit names its engine');
  assert.equal(histRowState({ status: 'paused', pauseReason: 'usage_limit', limitEngine: 'claude' }).word, 'Claude usage limit');
  assert.equal(liveRowState({ status: 'paused', pauseReason: 'usage_limit' }).word, 'Usage limit', 'a limit that was not the engine\'s (OpenRouter) names none');
  assert.equal(liveRowState({ status: 'paused', pauseReason: null }).word, 'Paused');
  assert.equal(liveRowState({ status: 'paused', pauseReason: 'usage_limit', limitEngine: 'claude', limitNote: 'resets 18:00' }).detail, 'resets 18:00', 'a usage-limit pause carries its reset note');
  assert.equal(histRowState({ status: 'paused', pauseReason: 'usage_limit', limitNote: 'resets 18:00' }).detail, 'resets 18:00');
  assert.equal(liveRowState({ status: 'paused', pauseReason: 'usage_limit', limitEngine: 'claude' }).detail, '', 'no note: no detail');
  assert.equal(histRowState({ status: 'paused', pauseReason: 'usage_limit' }).detail, '');
  assert.equal(liveRowState({ status: 'paused', ask: { kind: 'form' } }).icon, 'paused',
    'a pause outranks the question, as statusPill does');
  assert.deepEqual(liveRowState({ status: 'error', failedStep: 'Tester' }), { icon: 'fail', word: 'Tester failed', detail: '' });
  assert.deepEqual(liveRowState({ status: 'running', step: 'Implement' }), { icon: 'run', word: 'Running', detail: 'Implement' });
  assert.equal(liveRowState({ status: 'running', step: '' }).detail, '', 'no step yet: the word stands alone');
  assert.equal(liveRowState({ status: 'starting' }).icon, 'start');
  assert.equal(liveRowState({ status: 'interrupted' }).word, 'Interrupted');
});

test('a finished headline is the glance’s: the PR first, then the review', () => {
  assert.equal(histRowState({ status: 'done', pr: 'MERGED' }).word, 'Merged');
  assert.equal(histRowState({ status: 'done', pr: 'OPEN' }).word, 'In review');
  assert.equal(histRowState({ status: 'done', pr: 'NONE', checks: 0, files: 3 }).word, 'Ready to ship');
  assert.equal(histRowState({ status: 'done', pr: 'NONE', checks: 2, files: 3 }).word, 'Ready to review');
  assert.equal(histRowState({ status: 'done', pr: 'NONE', checks: 0, files: 0 }).word, 'Finished');
  assert.equal(histRowState({ status: 'done', pr: 'PENDING', checks: 0, files: 3 }).word, 'Finished');
  assert.equal(histRowState({ status: 'done', pr: 'UNAVAILABLE', checks: 0, files: 3 }).word, 'Finished');
  assert.equal(histRowState({ status: 'completed', pr: 'NONE', checks: 0, files: 1 }).word, 'Ready to ship');
  assert.equal(histRowState({ status: 'failed' }).icon, 'fail', 'status synonyms map like histStatusMeta');
  assert.equal(histRowState({ status: 'stopped' }).icon, 'stop');
  assert.equal(histRowState({ status: 'interrupted' }).word, 'Interrupted');
});

test('scheduled rows: a clock, what they wait for, and the Schedules tab that lists them', () => {
  assert.deepEqual(schedRowState({ status: 'scheduled' }), { icon: 'scheduled', word: 'Scheduled', detail: '' });
  assert.equal(schedRowState({ status: 'scheduled', after: { kind: 'run', id: 'p1' } }).word, 'Waiting');
  assert.equal(schedRowState({ status: 'scheduled', queued: true }).word, 'Queued');
  assert.equal(schedRowState({ status: 'scheduled', retryAt: '2026-09-30T16:00:00Z' }).word, 'Retrying');
  assert.equal(schedRowState({ status: 'missed' }).word, 'Missed');
  assert.equal(schedRowState({ status: 'firing' }).word, 'Starting');
  const once = buildRunsModel({ scheduled: [{ id: 't1', title: null, status: 'scheduled', runAt: at(30, 17, 0), groupKey: 'g', groupName: 'G' }], now: NOW });
  assert.equal(once.sections[0].rows[0].href, '#schedules/once');
  assert.equal(once.sections[0].rows[0].title, 'Scheduled run', 'a ticket title can be null');
  const series = buildRunsModel({ scheduled: [{ id: 't2', scheduleId: 's1', status: 'scheduled', runAt: at(30, 17, 0), groupKey: 'g', groupName: 'G' }], now: NOW });
  assert.equal(series.sections[0].rows[0].href, '#schedules/repeating');
  // A firing ticket's id IS its run's id (app.js:23648): once the run is live, it shows once.
  const firing = buildRunsModel({
    live: [liveIt('t3')],
    scheduled: [{ id: 't3', status: 'firing', runAt: at(30, 14, 59), groupKey: 'emp-00000001', groupName: 'Employee project' }],
    now: NOW,
  });
  assert.deepEqual(keysOf(firing), ['live:t3'], 'a firing ticket whose run is listed live is not repeated');
});

test('countNeedsYou agrees with the Needs you group, dedupe included', () => {
  const live = [
    { pipelineId: 'p1', status: 'paused', ask: false, unread: false },
    { pipelineId: '', status: 'running', ask: true, unread: false },
    { pipelineId: 'p3', status: 'error', ask: false, unread: false },
  ];
  const history = [{ id: 'p1', status: 'paused' }, { id: 'p9', status: 'paused' }, { id: 'p8', status: 'error' }];
  assert.equal(countNeedsYou({ live, history }), 3, 'p1 once, the question, and p9 (paused after a restart)');
});

test('isRowSelected: by run id, by project key and id, or by pipeline id', () => {
  const live = { kind: 'live', runId: 'r1', pipelineId: 'p1', projectKey: '' };
  const hist = { kind: 'hist', runId: '', pipelineId: 'p1', projectKey: 'k-00000001' };
  assert.equal(isRowSelected(live, { runId: 'r1', pipelineId: '', histKey: '' }), true);
  assert.equal(isRowSelected(hist, { runId: '', pipelineId: '', histKey: 'k-00000001/p1' }), true);
  assert.equal(isRowSelected(hist, { runId: 'r1', pipelineId: 'p1', histKey: '' }), true,
    'the live run acknowledged into its history row stays highlighted');
  assert.equal(isRowSelected({ kind: 'sched', runId: '', pipelineId: '', projectKey: '' }, { runId: '', pipelineId: '', histKey: '' }), false);
});

test('dateBucket: local midnights, the finish time for History, now for live, Upcoming for scheduled', () => {
  const t = (d, h) => new Date(2026, 8, d, h, 0).getTime();
  const b = (ms) => dateBucket({ kind: 'hist', activityMs: ms }, NOW);
  assert.equal(b(t(30, 0)), 'today');
  assert.equal(b(t(29, 23)), 'yesterday');
  assert.equal(b(t(29, 0)), 'yesterday');
  assert.equal(b(t(28, 23)), 'week');
  assert.equal(b(t(23, 0)), 'week', 'Previous 7 days: yesterday plus the six before it');
  assert.equal(b(t(22, 23)), 'older');
  assert.equal(b(NaN), 'older', 'an unknown time files under Older, not Today');
  assert.equal(dateBucket({ kind: 'live' }, NOW), 'today');
  assert.equal(dateBucket({ kind: 'sched' }, NOW), 'upcoming');
  assert.deepEqual(DATE_BUCKETS.map(([id]) => id), ['upcoming', 'today', 'yesterday', 'week', 'older']);
});

test('dateBucket: a DST day is still one day', () => {
  const prev = process.env.TZ;
  process.env.TZ = 'Europe/Berlin';
  try {
    const now = new Date(2026, 9, 26, 10, 0).getTime();                // the Monday after clocks go back
    const b = (d, h) => dateBucket({ kind: 'hist', activityMs: new Date(2026, 9, d, h, 0).getTime() }, now);
    assert.equal(b(25, 0), 'yesterday', 'the 25-hour Sunday is all Yesterday');
    assert.equal(b(24, 23), 'week');
  } finally { if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev; }
});


test('§3.1 sections: Needs you, Running, Recent; each run once; Recent pages at 20', () => {
  const live = [liveIt('ask', { run: { status: 'running', pendingQuestion: { kind: 'plan' }, steps: [] }, ask: { kind: 'plan' } }),
    liveIt('work', { run: { status: 'running', steps: [{ nodeId: 'n1', status: 'running' }], active: ['n1'] } })];
  const history = Array.from({ length: 25 }, (_, i) => histIt(`h${i}`, { mtime: NOW - i * 60000, run: { status: 'done' } }));
  const m = buildRunsModel({ live, history, now: NOW });
  assert.deepEqual(m.sections.map((s) => [s.id, s.rows.length]), [['needs', 1], ['running', 1], ['recent', 20]]);
  assert.equal(m.sections[2].more, 5);
  const keys = m.sections.flatMap((s) => s.rows.map((r) => r.key));
  assert.equal(new Set(keys).size, keys.length, 'each run appears once');
});

test('listLine: say each thing once (§3.1)', async () => {
  await checkRows([
    { name: 'needs section, single', run: () => assert.equal(listLine(row('needs-you', { mode: 'stages', label: 'Plan' }), { section: 'needs' }), 'Plan') },
    { name: 'running section, group', run: () => assert.equal(listLine(groupRowOf('working', 2, 'Build'), { section: 'running' }), 'Run 2 · Build') },
    { name: 'recent, failed', run: () => assert.equal(listLine(row('failed', { mode: 'stages', label: 'Review' }), { time: 'Fri' }), 'Failed at Review · Fri') },
    { name: 'recent, merged with PR', run: () => assert.equal(listLine(row('merged', null, { pr: { id: 'merged', word: 'Merged' } }), { time: 'Fri' }), 'Fri') },
    { name: 'recent, waiting group', run: () => assert.equal(listLine(groupRowOf('waiting', 2, ''), {}), 'Waiting · Run 2') },
    { name: 'mixed, group needs you', run: () => assert.equal(listLine(groupRowOf('needs-you', 3, 'Plan'), {}), 'Needs you · Run 3 · Plan') },
    { name: 'needs section, paused group keeps its word', run: () => assert.equal(listLine(groupRowOf('paused', 2, 'Build'), { section: 'needs' }), 'Paused · Run 2 · Build') },
    { name: 'a usage-limit pause keeps its reset note', run: () => assert.equal(listLine({ ...row('paused'), detail: 'resets 18:00', model: { ...row('paused').model, line: 'Paused · usage limit' } }, { section: 'needs' }), 'Paused · usage limit · resets 18:00') },
    { name: 'a PR that needs you (D31) reads In review', run: () => {
      assert.equal(listLine(row('needs-you', null, { prNeeds: true }), { section: 'needs' }), 'In review');
      assert.equal(listLine(row('needs-you', null, { prNeeds: true }), { time: 'Fri' }), 'In review · Fri');
    } },
  ]);
});

const LIVE3 = [liveIt('ask', { run: { status: 'running', pendingQuestion: { kind: 'plan' }, steps: [] }, ask: { kind: 'plan' } }),
  liveIt('w1', { run: { status: 'running', steps: [{ nodeId: 'n1' }], active: ['n1'] } }),
  liveIt('w2', { run: { status: 'running', steps: [{ nodeId: 'n1' }], active: ['n1'] } })];
const HIST5 = Array.from({ length: 5 }, (_, i) => histIt(`d${i}`, { run: { status: 'done' } }));

test('Show / Group by: counts, Running excludes ended runs, project grouping keeps Needs you on top', () => {
  const m = buildRunsModel({ live: LIVE3, history: HIST5, show: 'running', now: NOW });   // LIVE3: ask + 2 working; HIST5: 5 done
  assert.deepEqual(m.counts, { all: 8, needs: 1, running: 3, finished: 5, archived: null });
  assert.deepEqual(m.sections.map((s) => s.id), ['running']);
  const p = buildRunsModel({ live: LIVE3, history: HIST5, groupBy: 'project', now: NOW });
  assert.equal(p.sections[0].id, 'needs');
  assert.ok(p.sections.slice(1).every((s) => s.id.startsWith('project:')));
  assert.equal(p.sections.flatMap((s) => s.rows).filter((r) => r.key === 'live:ask').length, 1, 'Needs you is not repeated in its project (D5)');
  const folded = buildRunsModel({ history: HIST5, groupBy: 'project', collapsed: new Set(['project:worca-00000002']), now: NOW });
  assert.equal(folded.sections[0].collapsed, true);
  assert.equal(folded.sections[0].count, 5);
  const d = buildRunsModel({ live: LIVE3, history: HIST5, groupBy: 'date', now: NOW });
  assert.deepEqual(d.sections.map((s) => s.id), ['needs', 'date:today']);
  const empty = renderRunsList(doc, buildRunsModel({ live: LIVE3, show: 'finished', now: NOW }));
  assert.equal(empty.at(-1).textContent, 'No finished runs yet.');
});

test('a history row whose run is listed live is not shown twice; the started-by filter keeps that person\'s rows', () => {
  const m = buildRunsModel({ live: [liveIt('r1', { pipelineId: 'p1' })], history: [histIt('p1', { status: 'running' }), histIt('p2')], now: NOW });
  assert.deepEqual(keysOf(m).sort(), ['hist:worca-00000002/p2', 'live:r1']);
  const mine = buildRunsModel({ live: [liveIt('mine', { by: 'ana' }), liveIt('theirs', { by: 'bo' })],
    history: [histIt('h1', { by: 'ana' }), histIt('h2', { by: 'bo' })], person: 'ana', now: NOW });
  assert.deepEqual(keysOf(mine).sort(), ['hist:worca-00000002/h1', 'live:mine']);
});

test('the label filter keeps runs with ANY chosen label; a group stays when one member matches; a row shows 2 chips then +N', () => {
  const m = buildRunsModel({ live: [liveIt('r1', { labels: ['needs demo'] }), liveIt('r2')],
    history: [histIt('h1', { labels: ['hotfix', 'spike'] }), histIt('h2', { labels: ['spike'] })], labels: ['hotfix', 'needs demo'], now: NOW });
  assert.deepEqual(keysOf(m).sort(), ['hist:worca-00000002/h1', 'live:r1']);
  const g = { id: 'grp_l', groupKind: 'user', title: 'Labelled', members: [
    { position: 1, title: 'A', pipelineId: 'g1', kind: 'hist', run: { status: 'done' } },
    { position: 2, title: 'B', pipelineId: 'g2', kind: 'hist', run: { status: 'done' } }] };
  const gm = buildRunsModel({ history: [histIt('g1', { labels: ['hotfix'] }), histIt('g2'), histIt('x')], groups: [g], labels: ['hotfix'], now: NOW });
  assert.deepEqual(keysOf(gm), ['chain:grp_l']);
  const host = doc.createElement('div');
  host.append(...renderRunsList(doc, buildRunsModel({ history: [histIt('h4', { labels: ['hotfix', 'needs demo', 'spike', 'release'] }), histIt('h0')], now: NOW })));
  const row4 = host.querySelector('.runs-item[data-row-key="hist:worca-00000002/h4"] .runs-row-labels');
  assert.equal(row4.querySelectorAll('.label-chip').length, 2);
  assert.equal(row4.querySelector('.label-more').textContent, '+2');
  assert.equal(row4.querySelector('.label-more').title, 'spike, release');
  assert.equal(host.querySelector('.runs-item[data-row-key="hist:worca-00000002/h0"] .runs-row-labels'), null);
});

test('an archived run reads "Archived" with its time under Show = Archived', () => {
  assert.equal(histRowState({ status: 'done', pr: 'MERGED', archived: true }).word, 'Archived');
  const m = buildRunsModel({ history: [histIt('h-arch', { archived: true, run: { status: 'done' } }), histIt('h-live')], show: 'archived', now: NOW });
  assert.deepEqual(keysOf(m), ['hist:worca-00000002/h-arch']);
  const host = doc.createElement('div');
  host.append(...renderRunsList(doc, m));
  assert.equal(host.querySelector('.runs-row-sub').textContent, 'Archived · 11:17');
  assert.equal(renderRunsList(doc, buildRunsModel({ live: [liveIt('r')], show: 'archived', now: NOW })).at(-1).textContent, 'No archived runs.');
});

test('a chain member that needs you raises its group row into Needs you (needs before the fold)', () => {
  const live = [liveIt('m2', { pipelineId: 'p2', run: { status: 'running', pendingQuestion: { kind: 'gate' }, steps: [] }, ask: { kind: 'gate' } })];
  const groups = [{ id: 'p:p1', groupKind: 'chain', title: 'Chain', members: [
    { position: 1, title: 'One', pipelineId: 'p1', kind: 'hist', run: { status: 'done' } },
    { position: 2, title: 'Two', pipelineId: 'p2', runId: 'm2', kind: 'live', run: { status: 'running', pendingQuestion: { kind: 'gate' }, steps: [] } }] }];
  for (const show of ['all', 'needs']) {
    const m = buildRunsModel({ live, groups, show, now: NOW });
    assert.deepEqual(m.sections[0].rows.map((r) => r.key), ['chain:p:p1'], show);
  }
  assert.equal(countNeedsYou({ live: [{ pipelineId: 'p2', status: 'running', ask: true }] }), 1);
});

test('a finished run whose PR fails checks needs you (D31): Needs you, the badge count, Finished under Show', () => {
  const pr = { url: 'https://github.com/o/r/pull/781', number: 781, state: 'OPEN', checks: { state: 'failing', total: 12, failed: 3, pending: 0 } };
  const m = buildRunsModel({ history: [histIt('h1', { run: { status: 'done', pr } })], now: NOW });
  assert.deepEqual(m.sections.map((s) => s.id), ['needs']);
  assert.equal(m.counts.finished, 1);
  assert.equal(m.counts.running, 0);
  assert.equal(countNeedsYou({ history: [{ id: 'h1', status: 'done', pr }] }), 1);
  assert.equal(needsYouItems({ history: [{ id: 'h1', status: 'done', pr: { ...pr, fixing: true } }] }).history.length, 0, 'a live fix run: not counted');
});

test('isRowSelected: a group row is selected by any member pipeline or run', () => {
  const g = groupRow({ id: 'p:p1', groupKind: 'chain', title: 'C', members: [
    { position: 1, pipelineId: 'p1', runId: 'r1', kind: 'live', run: { status: 'running' } },
    { position: 2, ticketId: 't2', kind: 'sched', run: { ticket: { status: 'scheduled', runAt: null } } }] }, { now: NOW });
  assert.equal(isRowSelected(g, { pipelineId: 'p1' }), true);
  assert.equal(isRowSelected(g, { runId: 'r1' }), true);
  assert.equal(isRowSelected(g, { runId: 'zz' }), false);
});

test('dateBucket: an ended group files under its latest member\'s time, a working group under Today', () => {
  const tenDays = new Date(2026, 8, 20, 10, 0).getTime();
  const merged = { url: 'https://github.com/o/r/pull/1', number: 1, state: 'MERGED' };
  const feature = { id: 'feat_m', groupKind: 'feature', title: 'Old feature', members: [1, 2].map((i) => (
    { position: i, title: `S${i}`, pipelineId: `m${i}`, kind: 'hist', run: { status: 'done', pr: merged } })) };
  const working = { id: 'p:w1', groupKind: 'chain', title: 'Busy', members: [
    { position: 1, pipelineId: 'w1', runId: 'rw', kind: 'live', run: { status: 'running', steps: [{ nodeId: 'n' }], active: ['n'] } },
    { position: 2, ticketId: 'tw', kind: 'sched', run: { ticket: { status: 'scheduled', runAt: null } } }] };
  const ready = { id: 'grp_r', groupKind: 'user', title: 'Shipped', members: [{ position: 1, title: 'R', pipelineId: 'r1', kind: 'hist', run: { status: 'done' } }] };
  const m = buildRunsModel({ live: [liveIt('rw', { pipelineId: 'w1' })],
    history: [histIt('m1', { mtime: tenDays }), histIt('m2', { mtime: tenDays - 3600000 }), histIt('r1', { mtime: NOW - 60000 })],
    groups: [feature, working, ready], groupBy: 'date', now: NOW });
  const where = (key) => m.sections.find((s) => s.rows.some((r) => r.key === key)).id;
  assert.equal(where('chain:feat_m'), 'date:older');
  assert.equal(where('chain:p:w1'), 'date:today');
  const host = doc.createElement('div');
  host.append(...renderRunsList(doc, buildRunsModel({ history: [histIt('r1', { mtime: NOW - 60000 })], groups: [ready], now: NOW })));
  assert.equal(host.querySelector('.runs-item[data-row-key="chain:grp_r"] > a.runs-row > .runs-row-sub').textContent, `Ready to ship · ${rowTime(NOW - 60000, NOW)}`);
});

test('D29: an all-waiting chain in Recent is open; the person\'s toggle wins; an all-merged chain starts closed', () => {
  const waiting = { id: 'p:x', groupKind: 'chain', title: 'Later', members: [1, 2, 3].map((i) => (
    { position: i, ticketId: `tx${i}`, kind: 'sched', run: { ticket: { status: 'scheduled', runAt: null } } })) };
  const scheduled = [1, 2, 3].map((i) => ({ id: `tx${i}`, status: 'scheduled', runAt: at(30, 21, 0), groupKey: 'g', groupName: 'G' }));
  const m = buildRunsModel({ scheduled, groups: [waiting], now: NOW });
  assert.equal(m.sections.find((s) => s.id === 'recent').rows[0].open, true);
  assert.equal(buildRunsModel({ scheduled, groups: [waiting], toggled: new Map([['chain:p:x', false]]), now: NOW }).sections[0].rows[0].open, false);
  const merged = { url: 'https://github.com/o/r/pull/1', number: 1, state: 'MERGED' };
  const done = { id: 'p:y', groupKind: 'chain', title: 'Done', members: [1, 2].map((i) => (
    { position: i, pipelineId: `y${i}`, kind: 'hist', run: { status: 'done', pr: merged } })) };
  assert.equal(rowsOf(buildRunsModel({ history: [histIt('y1'), histIt('y2')], groups: [done], now: NOW }))[0].open, false);
});

const FEATURE_WITH_FAILED_MEMBER = { id: 'feat_x', groupKind: 'feature', title: 'Feature', members: [
  { position: 1, title: 'One', pipelineId: 'good', kind: 'hist', run: { status: 'done' } },
  { position: 2, title: 'Two', pipelineId: 'bad', kind: 'hist', run: { status: 'error' } },
  { position: 3, title: 'Three', ticketId: 't3', kind: 'sched', run: { ticket: { status: 'scheduled', runAt: null } } }] };

test('rows, members and symbols: Needs you / Failed draw the 12px symbol, never a plain dot; every row has the right column and tail', () => {
  const m = buildRunsModel({ live: [liveIt('ask', { run: { status: 'running', pendingQuestion: { kind: 'plan' }, steps: [] } })],
    history: [histIt('bad', { run: { status: 'error' } })], groups: [FEATURE_WITH_FAILED_MEMBER],
    toggled: new Map([[`chain:${FEATURE_WITH_FAILED_MEMBER.id}`, true]]), now: NOW });
  const host = doc.createElement('div');
  host.append(...renderRunsList(doc, m));
  const symbolStates = [...host.querySelectorAll('.runs-pick .status-dot')].filter((x) => ['needs-you', 'failed'].includes(x.dataset.state));
  assert.ok(symbolStates.length >= 3);
  for (const d of symbolStates) {
    const s = d.querySelector('svg.status-sym');
    assert.ok(s, `${d.dataset.state} has its symbol`);
    assert.equal(s.getAttribute('width'), '12');
    assert.equal(d.getAttribute('aria-label'), d.dataset.state === 'failed' ? 'Failed' : 'Needs you');
  }
  assert.ok(host.querySelector('.runs-members .runs-item[data-level="member"] .status-dot[data-state="failed"] svg.status-sym'));
  for (const item of host.querySelectorAll('.runs-item')) {
    assert.ok(item.querySelector(':scope > a.runs-row > .runs-row-right'), 'every row has the right column');
    assert.ok(item.querySelector(':scope > .runs-row-tail > .runs-more'), 'every row has the ⋯ tail');
  }
  const g = host.querySelector('.runs-item[data-row-key="chain:feat_x"]');
  assert.equal(g.querySelector(':scope > a.runs-row').getAttribute('href'), '#feature/feat_x');
  assert.equal(g.querySelector(':scope > a.runs-row .runs-count').textContent, '1/3');
  assert.deepEqual([...g.querySelectorAll('.runs-members .runs-row-title')].map((t) => t.textContent), ['1 · One', '2 · Two', '3 · Three']);
  assert.equal(g.querySelector(':scope > .runs-row-tail .runs-expand').getAttribute('aria-expanded'), 'true');
  assert.equal(g.querySelector(':scope > a.runs-row').dataset.memberKeys.split(' ').sort().join(' '), 'p:bad p:good t:t3',
    'the row carries its member keys so the selection repaint can rebuild them from the DOM');
});

test('a group row reads its count once and its bar glides from lineFrom; a single live row draws the four-section stage block', () => {
  const chain = { id: 'p:c1', groupKind: 'chain', title: 'Chain', members: [
    { position: 1, pipelineId: 'p1', runId: 'r1', kind: 'live', run: { status: 'running', steps: [{ nodeId: 'n' }], active: ['n'] } },
    { position: 2, ticketId: 't2', kind: 'sched', run: { ticket: { status: 'scheduled', runAt: null } } }] };
  const m = buildRunsModel({ live: [liveIt('r1', { pipelineId: 'p1' }), liveIt('r9', { run: { status: 'running', steps: [{ nodeId: 'n' }], active: ['n'] } })],
    scheduled: [{ id: 't2', status: 'scheduled', after: 'p1', groupKey: 'emp-00000001', groupName: 'Employee project' }],
    groups: [chain], now: NOW });
  assert.deepEqual(keysOf(m), ['chain:p:c1', 'live:r9']);
  const host = doc.createElement('div');
  host.append(...renderRunsList(doc, m, { lineFrom: new Map([['chain:p:c1', '10%']]) }));
  const g = host.querySelector('.runs-item[data-row-key="chain:p:c1"]');
  assert.equal(g.querySelector(':scope > a.runs-row').textContent.split('0/2').length - 1, 1, 'the count once');
  assert.equal(Number.parseFloat(g.querySelector(':scope > a.runs-row > .runs-row-prog > i').style.width), 10);
  assert.ok(host.querySelector('.runs-item[data-row-key="live:r9"] > a.runs-row > .runs-stage .run-prog-track'));
});

test('§2.4 cost: a row says its own cost, a group its total; live cost counts; the total never goes down', () => {
  assert.equal(costTitle({ kind: 'hist', cost: 1.234 }), 'Cost $1.23');
  assert.equal(costTitle({ kind: 'hist', cost: null }), 'Cost unknown');
  const memo = {};
  const g = { cost: { usd: 2, byPipeline: { p1: 1.5, p2: 0.5 } } };
  assert.equal(groupCostUsd(g, { p2: 0.9 }, memo), 2.4, 'a live member counts at its live cost');
  assert.equal(groupCostUsd(g, { p2: 0 }, memo), 2.4, 'a resumed run reading $0 does not pull it down');
  assert.equal(groupCostUsd(g, { p3: 0.3 }), 2.3, 'a live member not yet in byPipeline counts');
  assert.equal(groupCostUsd({ members: [{ cost: 1 }, { cost: 0.5 }] }), 1.5, 'a plain chain sums its members');
  assert.equal(costTitle({ kind: 'chain', costUsd: 2.4 }), 'Group total $2.40');
  const host = doc.createElement('div');
  host.append(...renderRunsList(doc, buildRunsModel({ history: [histIt('h1', { cost: 1.23 })], now: NOW })));
  assert.equal(host.querySelector('a.runs-row').title, 'Cost $1.23');
});

test('groupRow counts a feature\'s planning run in the bar, never in the count; rows carry data-line', () => {
  const NOW = Date.parse('2026-10-18T12:00:00Z');
  const done = { status: 'done', endReached: true };
  const g = { id: 'feat_1', groupKind: 'feature', title: 'Run tags',
    planning: { pipelineId: 'p0', title: 'Planning', run: done, memo: {} },
    members: [
      { position: 1, title: 'Store tags', pipelineId: 'p1', kind: 'hist', run: done, memo: {} },
      { position: 2, title: 'Run tags', pipelineId: 'p2', kind: 'hist', run: { ticket: { status: 'scheduled', runAt: null, after: { index: 1 } } }, memo: {} },
    ] };
  const row = groupRow(g, { now: NOW });
  assert.equal(row.count, '1/2');
  assert.equal(row.model.progress.total, 3, 'planning + 2 members in the bar');
  assert.equal(row.planning.model.state, 'ready');
  assert.ok(row.memberKeys.has('p:p0'), 'the planning run folds into the group row');
  const doc = new JSDOM('<!doctype html><body></body>').window.document;
  const host = doc.createElement('div');
  // A group row is placed only through one of its listed members (buildRunsModel's groupOf), so list p1.
  const history = [{ id: 'p1', projectKey: 'acme', title: 'Store tags', status: 'done', run: done, mtime: NOW - 60000 }];
  host.append(...renderRunsList(doc, buildRunsModel({ live: [], history, scheduled: [], groups: [g], now: NOW })));
  const a = host.querySelector('.runs-row[data-row-key="chain:feat_1"]');
  assert.ok(a, 'the group row is listed');
  assert.equal(a.dataset.line, row.model.line);
});

test('D23: a History row whose Watch PR stopped for a person lists under Needs you; a live fix round does not', () => {
  const pr = { url: 'https://github.com/o/r/pull/781', number: 781, state: 'OPEN' };
  const FAIL = { state: 'failing', total: 12, failed: 3, pending: 0 };
  assert.equal(needsYouItems({ history: [{ id: 'h1', status: 'done', pr, watch: { status: 'needs-person', reason: 'cap', fixRuns: 3 } }] }).history.length, 1);
  assert.equal(needsYouItems({ history: [{ id: 'h1', status: 'done', pr: { ...pr, checks: FAIL }, watch: { status: 'fixing' } }] }).history.length, 0);
});
test('renderRunsList: loading, offline-empty and the retry note (§5a.2)', () => {
  const empty = buildRunsModel({ now: NOW });
  const text = (out) => out.map((e) => `${e.className}|${e.textContent}`);
  assert.deepEqual(text(renderRunsList(doc, empty, { loading: true })), ['runs-note runs-loading|Loading runs…']);
  assert.deepEqual(text(renderRunsList(doc, empty, { offline: true })), ["runs-note runs-offline|The runs show here once Worca's server is reachable again."]);
  assert.deepEqual(text(renderRunsList(doc, empty, {})), ['runs-note|No runs yet.']);
  const [, err] = renderRunsList(doc, empty, { note: 'Could not load finished runs: boom.', retry: true });
  assert.equal(err.querySelector('button[data-runs-retry]').textContent, 'Try again');
  const full = buildRunsModel({ history: [{ id: 'p1', projectKey: 'k', title: 'A', status: 'done', run: { status: 'done' } }], now: NOW });
  assert.equal(renderRunsList(doc, full, { loading: true, offline: true }).filter((e) => /runs-(loading|offline)/.test(e.className)).length, 0,
    'rows on screen: no loading or offline note (the banner says it)');
  const needs = buildRunsModel({ history: [{ id: 'p1', projectKey: 'k', title: 'A', status: 'done', run: { status: 'done' } }], show: 'needs', now: NOW });
  assert.deepEqual(text(renderRunsList(doc, needs, { loading: true, offline: true })), ['runs-note|Nothing needs you.'],
    'a Show-filtered empty view with rows elsewhere keeps its own note');
});

const GH = (n, more = {}) => ({ state: 'OPEN', url: `https://github.com/o/r/pull/${n}`, number: n, isDraft: false, mergeable: 'UNKNOWN', ...more });
const AZ = { state: 'CLOSED', url: 'https://dev.azure.com/acme/P/_git/api/pullrequest/5', number: 5, isDraft: false, mergeable: 'UNKNOWN' };

test('renderRunsList: #784’s PR states are the chip’s words — one PR indicator per row', () => {
  const cases = {
    draft: [GH(1, { isDraft: true }), 'is-draft', 'Draft'],
    open: [GH(2), 'is-ready', 'Ready'],
    conflict: [GH(3, { mergeable: 'CONFLICTING' }), 'is-conflicts', 'Conflicts'],
    draftConflict: [GH(4, { isDraft: true, mergeable: 'CONFLICTING' }), 'is-conflicts', 'Conflicts'],
    merged: [GH(5, { state: 'MERGED' }), 'is-merged', 'Merged'],
    closed: [GH(6, { state: 'CLOSED' }), 'is-closed', 'Closed'],
    abandoned: [AZ, 'is-closed', 'Abandoned'],
  };
  const history = [...Object.entries(cases).map(([id, [pr]]) => histIt(`h-${id}`, { run: { status: 'done', pr } })),
    histIt('h-none', { pr: 'NONE', run: { status: 'done', pr: null } })];
  const host = doc.createElement('div');
  host.append(...renderRunsList(doc, buildRunsModel({ history, now: NOW })));
  for (const [id, [, cls, word]] of Object.entries(cases)) {
    const row = host.querySelector(`a.runs-row[data-pipeline-id="h-${id}"]`);
    const chips = row.querySelectorAll('.runs-pr');
    assert.equal(chips.length, 1, `${id}: exactly one PR indicator`);
    assert.ok(chips[0].classList.contains(cls), `${id}: ${cls}`);
    assert.equal(chips[0].querySelector('.runs-pr-word').textContent, word);
  }
  assert.equal(host.querySelector('a.runs-row[data-pipeline-id="h-none"] .runs-pr'), null, 'no PR: no chip');
});

test('renderRunsList: a workspace run’s chip names its most urgent member PR and their count', () => {
  const ws = (memberPrs) => ({ status: 'done', pr: GH(1), memberPrs });
  const history = [histIt('ws3', { run: ws([GH(1), GH(2, { state: 'MERGED' }), GH(3, { mergeable: 'CONFLICTING' })]) }),
    histIt('ws1', { run: ws([GH(1)]) })];
  const host = doc.createElement('div');
  host.append(...renderRunsList(doc, buildRunsModel({ history, now: NOW })));
  const chip = (id) => host.querySelector(`a.runs-row[data-pipeline-id="${id}"] .runs-pr`);
  assert.equal(chip('ws3').querySelector('.runs-pr-word').textContent, 'Conflicts · 3 PRs');
  assert.ok(chip('ws3').classList.contains('is-conflicts'), 'the most urgent state colours the chip');
  assert.match(chip('ws3').title, /^3 pull requests · Conflicts with the base branch/);
  assert.equal(chip('ws1').querySelector('.runs-pr-word').textContent, 'Ready', 'one member PR: no count');
});

test('Needs you: a workspace run with a conflicting member PR is listed and counted once (D11)', () => {
  const conflicting = [GH(1), GH(2, { mergeable: 'CONFLICTING' })];
  const m = buildRunsModel({ history: [histIt('wsc', { run: { status: 'done', pr: GH(1), memberPrs: conflicting } })], now: NOW });
  const row = rowsOf(m).find((r) => r.pipelineId === 'wsc');
  assert.deepEqual([row.model.state, row.needs], ['needs-you', true], 'the row state and the section agree');
  // The badge reads raw History rows (state.historyAll): members[].pr, not memberPrs.
  const raw = { id: 'wsc', status: 'done', pr: GH(1), members: conflicting.map((pr, i) => ({ memberKey: `m${i}`, pr })) };
  assert.equal(countNeedsYou({ live: [], history: [raw] }), 1);
  assert.equal(countNeedsYou({ live: [], history: [{ ...raw, members: [{ memberKey: 'm0', pr: GH(1) }] }] }), 0, 'nothing wrong: not counted');
});

test('style.css: the chip colours #784’s states from tokens; the glyph rules are gone', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  const colours = { 'is-draft': '--ink-2', 'is-ready': '--green-ink', 'is-merged': '--violet-ink', 'is-closed': '--red-ink' };
  for (const [cls, token] of Object.entries(colours)) assert.ok(css.includes(`.runs-pr.${cls}{color:var(${token});}`), cls);
  assert.match(css, /\.runs-pr\.is-conflicts,\.runs-pr\.is-failing\{color:var\(--red-ink\);\}/);
  for (const gone of ['.runs-pr-open{', '.runs-pr-cut{', '.runs-pr-count{', '.runs-pr{flex:none']) assert.equal(css.includes(gone), false, gone);
});
