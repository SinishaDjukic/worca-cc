// test/ui-runs-list-model.test.mjs — the Runs list model (ui/public/runs-list.mjs, runs redesign §3.1): the state
// words ⌘K and the Activity menu still read, times, Needs you, the sections (Needs you · Running · Recent), Show and
// Group by, groups and their members, the one status line, cost, and the DOM the list is built from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import {
  rowTime, whenLabel, liveRowState, histRowState, schedRowState, countNeedsYou, needsYouItems,
  buildRunsModel, isRowSelected, isMemberOpen, renderRunsList, dateBucket, DATE_BUCKETS, listLine, groupRow, groupCostUsd, costTitle, memberCostUsd, memberLine,
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

test('P5: a workspace row reads like its glance — the Folder words for an all-Folder run, the git words for a mixed one', () => {
  const applied = { state: 'applied', counts: { added: 2, modified: 0, deleted: 0 } };
  assert.equal(histRowState({ status: 'done', target: 'workspace', workMode: 'folder', changes: applied }).word, 'Applied');
  // A mixed row (no workMode) carries its Folder members' rollup `changes`, yet its glance is the git one.
  assert.equal(histRowState({ status: 'done', target: 'workspace', changes: applied, pr: 'NONE', checks: 0, files: 3 }).word, 'Ready to ship');
  assert.equal(histRowState({ status: 'done', target: 'workspace', changes: applied }).word, 'Finished');
  assert.equal(histRowState({ status: 'done', workMode: 'folder', changes: applied }).word, 'Applied', 'a Folder project row is unchanged');
});

test('scheduled rows: a clock, what they wait for, and the Schedules tab that lists them', () => {
  assert.deepEqual(schedRowState({ status: 'scheduled' }), { icon: 'scheduled', word: 'Scheduled', detail: '' });
  assert.equal(schedRowState({ status: 'scheduled', after: { kind: 'run', id: 'p1' } }).word, 'Waiting');
  assert.equal(schedRowState({ status: 'scheduled', queued: true }).word, 'Queued');
  assert.equal(schedRowState({ status: 'scheduled', retryAt: '2026-09-30T16:00:00Z' }).word, 'Retrying');
  assert.equal(schedRowState({ status: 'missed' }).word, 'Missed');
  assert.equal(schedRowState({ status: 'firing' }).word, 'Starting');
  const once = buildRunsModel({ scheduled: [{ id: 't1', title: null, status: 'scheduled', runAt: at(30, 17, 0), groupKey: 'g', groupName: 'G' }], now: NOW });
  assert.equal(once.sections[0].id, 'waiting', 'D10: a one-off ticket waits');
  assert.equal(once.sections[0].rows[0].href, '#schedules/once');
  assert.equal(once.sections[0].rows[0].title, 'Scheduled run', 'a ticket title can be null');
  const series = buildRunsModel({ scheduled: [{ id: 't2', scheduleId: 's1', status: 'scheduled', runAt: at(30, 17, 0), groupKey: 'g', groupName: 'G' }], now: NOW });
  assert.equal(series.sections[0].id, 'recent', 'D10: a series occurrence stays in Recent');
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
    { name: 'waiting group names its current member\'s wait (D11)', run: () => {
      const g = groupRowOf('waiting', 2, '');
      g.model.current.line = 'Waiting · starts after run 1';
      assert.equal(listLine(g, {}), 'Waiting · Run 2 · starts after run 1');
    } },
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
  assert.deepEqual(m.counts, { all: 8, needs: 1, running: 3, waiting: 0, finished: 5, archived: null });
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

test('one ship flow (D8): a kept all-done chain without PRs adds 0 to Needs you', () => {
  const history = [histIt('k1', { pr: null, run: { status: 'done' } }), histIt('k2', { pr: null, run: { status: 'done' } })];
  const groups = [{ id: 'p:k1', groupKind: 'chain', title: 'Kept', members: [
    { position: 1, title: 'One', pipelineId: 'k1', kind: 'hist', run: { status: 'done' } },
    { position: 2, title: 'Two', pipelineId: 'k2', kind: 'hist', run: { status: 'done' } }] }];
  const m = buildRunsModel({ history, groups, now: NOW });
  assert.equal(m.counts.needs, 0);
  assert.equal(m.sections.some((sec) => sec.id === 'needs'), false);
  assert.equal(groupRow(groups[0], { now: NOW }).model.state, 'ready', 'it reads Ready to ship');
  assert.equal(countNeedsYou({ history: history.map((h) => ({ id: h.id, status: h.status, pr: null })) }), 0);
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

test('run 3 (D3): every group row links its own page — #group/… for a chain or a user group', () => {
  const g = groupRow({ id: 'p:p0', groupKind: 'chain', title: 'C', members: [
    { position: 1, pipelineId: 'p0', runId: 'r1', kind: 'live', href: '#running/r1', run: { status: 'running' } }] }, { now: NOW });
  assert.equal(g.href, '#group/p%3Ap0', 'not the current member\'s #running/r1');
  const u = groupRow({ id: 'g_1', groupKind: 'user', title: 'U', members: [{ position: 1, pipelineId: 'u1', kind: 'hist', run: { status: 'done' } }] }, { now: NOW });
  assert.equal(u.href, '#group/g_1');
});

test('selection is two levels: the group row on its own page, member-open while a member runs', () => {
  const row = { kind: 'chain', groupId: 'feat_1', memberKeys: new Set(['p:p1', 'r:r2']) };
  assert.equal(isRowSelected(row, { groupId: 'feat_1' }), true);
  assert.equal(isRowSelected(row, { runId: 'r2', pipelineId: 'p2' }), false);
  assert.equal(isMemberOpen(row, { runId: 'r2', pipelineId: 'p2' }), true);
  assert.equal(isMemberOpen(row, { groupId: 'feat_1' }), false);
  assert.equal(isMemberOpen({ kind: 'hist', pipelineId: 'p1' }, { pipelineId: 'p1' }), false);
  assert.equal(isRowSelected({ kind: 'hist', pipelineId: 'p1', projectKey: 'k' }, { pipelineId: 'p1', groupId: 'feat_1' }), false,
    'while a group page is open no run row is selected');
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

test('D29: an all-waiting chain in Waiting is open; the person\'s toggle wins; an all-merged chain starts closed', () => {
  const waiting = { id: 'p:x', groupKind: 'chain', title: 'Later', members: [1, 2, 3].map((i) => (
    { position: i, ticketId: `tx${i}`, kind: 'sched', run: { ticket: { status: 'scheduled', runAt: null } } })) };
  const scheduled = [1, 2, 3].map((i) => ({ id: `tx${i}`, status: 'scheduled', runAt: at(30, 21, 0), groupKey: 'g', groupName: 'G' }));
  const m = buildRunsModel({ scheduled, groups: [waiting], now: NOW });
  assert.equal(m.sections.find((s) => s.id === 'waiting').rows[0].open, true, 'D10: a group whose next member waits is in Waiting');
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
  assert.equal(g.querySelector(':scope > a.runs-row').dataset.groupId, 'feat_x', 'and its group id (D4)');
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
  const colours = { 'is-draft': '--ink-2', 'is-ready': '--green-ink', 'is-merged': '--slate-ink', 'is-closed': '--red-ink' };
  for (const [cls, token] of Object.entries(colours)) assert.ok(css.includes(`.runs-pr.${cls}{color:var(${token});}`), cls);
  assert.match(css, /\.runs-pr\.is-conflicts,\.runs-pr\.is-failing\{color:var\(--red-ink\);\}/);
  for (const gone of ['.runs-pr-open{', '.runs-pr-cut{', '.runs-pr-count{', '.runs-pr{flex:none']) assert.equal(css.includes(gone), false, gone);
});

test('D5: a member\'s cost is the highest known of live, History and the group\'s byPipeline; null when none is known', () => {
  assert.equal(memberCostUsd(0, 135.95, 135.95), 135.95, 'a finished run still in the live map at 0');
  assert.equal(memberCostUsd(2.5, 1.2, undefined), 2.5, 'a live run ahead of the stored numbers');
  assert.equal(memberCostUsd(undefined, null, 141.19), 141.19);
  assert.equal(memberCostUsd(undefined, null, undefined), null);
});

test('D4: a pending PR draws no chip and the member line keeps "In review"', () => {
  const run = { status: 'done', pr: { url: 'https://github.com/acme/web/pull/821', number: 821, state: 'OPEN', pending: true } };
  const m = buildRunsModel({ history: [histIt('p1', { pr: null, run })], now: NOW });
  const r = rowsOf(m)[0];
  const frag = renderRunsList(doc, m);
  assert.equal(frag[0].querySelector('.runs-pr'), null);
  assert.match(listLine(r, { time: 'Fri' }), /^In review/);
});

test('D9: a group in Needs you through member 1\'s PR leads with the reason; the count matches', () => {
  const failing = { url: 'https://github.com/acme/web/pull/821', number: 821, state: 'OPEN', checks: { state: 'failing', total: 12, failed: 3, pending: 0 } };
  const grp = { id: 'feat_roll', groupKind: 'feature', title: 'Complete Design Language Rollout', members: [
    { position: 1, pipelineId: 'p1', kind: 'hist', run: { status: 'done', pr: failing } },
    { position: 2, pipelineId: 'p2', runId: 'r2', kind: 'live', run: { status: 'running', steps: [{ nodeId: 'build', status: 'start' }] } }] };
  const m = buildRunsModel({ live: [liveIt('r2', { pipelineId: 'p2' })], groups: [grp], now: NOW });
  const needs = m.sections.find((s) => s.id === 'needs');
  assert.equal(needs.count, 1);
  assert.equal(listLine(needs.rows[0], { section: 'needs' }), 'Run 1 needs you · Checks failing');
});

test('D10/D12: sections read Needs you, Running, Waiting, Recent; Waiting holds one-off tickets, newest first', () => {
  const tickets = [
    { id: 't-after', title: 'Nightly docs refresh', status: 'scheduled', runAt: '9999-12-31T00:00:00.000Z', createdAt: at(30, 10, 0),
      after: { kind: 'pipeline', id: 'p-roll3', title: 'Forms', group: 'Complete Design Language Rollout', index: 3 } },
    { id: 't-once', title: 'Release notes', status: 'scheduled', runAt: at(30, 14, 0), createdAt: at(30, 11, 0), after: null },
    { id: 't-series', scheduleId: 'sch_daily', title: 'Daily triage', status: 'scheduled', runAt: at(30, 16, 0), createdAt: at(30, 9, 0), after: null },
  ];
  const m = buildRunsModel({
    live: [liveIt('ask', { ask: { kind: 'plan' } }), liveIt('work')], scheduled: tickets,
    history: [histIt('old', { startedAt: at(29, 9, 0), mtime: Date.parse(at(30, 14, 59)) }), histIt('new', { startedAt: at(30, 8, 0) })], now: NOW });
  assert.deepEqual(m.sections.map((s) => s.id), ['needs', 'running', 'waiting', 'recent']);
  const waiting = m.sections.find((s) => s.id === 'waiting');
  assert.deepEqual(waiting.rows.map((r) => r.key), ['sched:t-once', 'sched:t-after'], 'created 11:00 before created 10:00');
  assert.equal(waiting.rows[1].model.line, 'Waiting · starts after Complete Design Language Rollout · run 3');
  assert.equal(waiting.rows[0].model.line, 'Waiting · starts 14:00');
  const recent = m.sections.find((s) => s.id === 'recent');
  assert.deepEqual(recent.rows.map((r) => r.key).filter((k) => k.startsWith('hist:')), ['hist:worca-00000002/new', 'hist:worca-00000002/old'],
    'by start time: the older run\'s fresh activity does not lift it');
  assert.ok(recent.rows.some((r) => r.key === 'sched:t-series'), 'a series occurrence stays in Recent (clarify)');
  assert.equal(m.counts.waiting, 2);
});

test('D10: Show = Waiting lists only waiting rows; Show = Running no longer counts them; empty Waiting has its note', () => {
  const t = { id: 't-once', title: 'Release notes', status: 'scheduled', runAt: at(30, 14, 0), createdAt: at(30, 11, 0), after: null };
  const w = buildRunsModel({ live: [liveIt('work')], scheduled: [t], show: 'waiting', now: NOW });
  assert.deepEqual(w.sections.map((s) => [s.id, s.title, s.count]), [['waiting', 'Waiting', 1]]);
  assert.equal(buildRunsModel({ live: [liveIt('work')], scheduled: [t], show: 'running', now: NOW }).shown, 1);
  const empty = buildRunsModel({ live: [liveIt('work')], show: 'waiting', now: NOW });
  assert.equal(renderRunsList(doc, empty).at(-1).textContent, 'Nothing is waiting.');
});

test('D12: Running sorts by start, newest first; Needs you ties on urgency break by dispatch time', () => {
  const m = buildRunsModel({ live: [liveIt('a', { startedAt: at(30, 8, 0) }), liveIt('b', { startedAt: at(30, 9, 0) }),
    liveIt('q1', { ask: { kind: 'plan' }, startedAt: at(30, 7, 0) }), liveIt('q2', { ask: { kind: 'plan' }, startedAt: at(30, 10, 0) })], now: NOW });
  assert.deepEqual(m.sections.find((s) => s.id === 'running').rows.map((r) => r.key.split(':').pop()), ['b', 'a']);
  assert.deepEqual(m.sections.find((s) => s.id === 'needs').rows.map((r) => r.key.split(':').pop()), ['q2', 'q1']);
});

test('D14: a group of in-base members reads merged like its members; a PR-driven Needs you group has no "?" glyph', () => {
  const g = buildRunsModel({ groups: [{ id: 'g-ib', groupKind: 'feature', title: 'Bundle', members: [
    { position: 1, pipelineId: 'i1', kind: 'hist', run: { status: 'done', inBase: { base: 'dev' } } },
    { position: 2, pipelineId: 'i2', kind: 'hist', run: { status: 'done', inBase: { base: 'dev' } } }] }],
  history: [histIt('i1'), histIt('i2')], now: NOW });
  assert.equal(rowsOf(g)[0].model.state, 'merged');
  const failing = { url: 'https://github.com/acme/web/pull/821', number: 821, state: 'OPEN', checks: { state: 'failing', total: 12, failed: 3, pending: 0 } };
  const n = buildRunsModel({ groups: [{ id: 'g-pr', groupKind: 'feature', title: 'Rollout', members: [
    { position: 1, pipelineId: 'p1', kind: 'hist', run: { status: 'done', pr: failing } }] }],
  history: [histIt('p1', { run: { status: 'done', pr: failing } })], now: NOW });
  assert.equal(rowsOf(n)[0].needs, true);
  assert.equal(rowsOf(n)[0].model.symbol || '', '', 'no "?" for a PR-driven Needs you');
});

test('D12: groups in Recent sort by their first member\'s start, newest first', () => {
  const mk = (id, startedAt) => ({ id, groupKind: 'feature', title: id, members: [
    { position: 1, pipelineId: `${id}-1`, kind: 'hist', startedAt, run: { status: 'done' } },
    { position: 2, pipelineId: `${id}-2`, kind: 'hist', startedAt: at(30, 14, 0), run: { status: 'done' } }] });
  const m = buildRunsModel({ groups: [mk('g-old', at(28, 9, 0)), mk('g-new', at(29, 9, 0))],
    history: ['g-old-1', 'g-old-2', 'g-new-1', 'g-new-2'].map((id) => histIt(id)), now: NOW });
  assert.deepEqual(m.sections.find((s) => s.id === 'recent').rows.map((r) => r.key), ['chain:g-new', 'chain:g-old']);
});

test('whenLabel: rowTime style with the clock after a non-today day (F-9)', () => {
  const now = new Date(2026, 8, 14, 18, 0).getTime();       // Mon 14 Sep 2026
  assert.equal(whenLabel(new Date(2026, 8, 14, 17, 45).getTime(), now), '17:45');
  assert.equal(whenLabel(new Date(2026, 8, 16, 2, 0).getTime(), now), 'Wed, 02:00');
  assert.equal(whenLabel(new Date(2026, 7, 12, 14, 5).getTime(), now), 'Aug 12, 14:05');
  assert.equal(whenLabel(new Date(2025, 11, 3, 14, 5).getTime(), now), 'Dec 3, 2025, 14:05');
  assert.equal(whenLabel(0, now), '');
  assert.equal(whenLabel('garbage', now), '');
  const inst = Date.UTC(2026, 8, 14, 3, 30);                // 12:30 in Tokyo
  assert.equal(whenLabel(inst, inst, 'Asia/Tokyo'), '12:30');
});

test('#948 s2 renderRunsList: a bare section has no head, emptyByShow / loadingText / offlineText notes, retry on the offline note, moreLabel', () => {
  const chatRowItem = { key: 'chat:a', id: 'a', kind: 'chat', title: 'Chat a', href: '#chat/a', labels: [], cost: 0.4, activityMs: NOW - 60000,
    model: { state: 'idle', word: 'Idle', line: 'worka-cc · $0.40 · 11:00', dot: 'grey', pulse: false, symbol: null, icon: 'chat' } };
  const flat = { sections: [{ id: 'all', title: 'Chats', rows: [chatRowItem], count: 1, bare: true, more: true, moreLabel: 'Show more' }],
    view: { show: 'all' }, now: NOW, total: 1, shown: 1, spansProjects: false };
  const host = doc.createElement('div');
  host.append(...renderRunsList(doc, flat));
  assert.equal(host.querySelectorAll('.runs-sec-head').length, 0);
  assert.equal(host.querySelectorAll('.runs-item').length, 1);
  assert.equal(host.querySelector('.runs-row-sub').textContent, 'worka-cc · $0.40 · 11:00', 'a chat row reads its model line');
  assert.equal(host.querySelector('.runs-older').textContent, 'Show more');
  const empty = (show, total = 0) => ({ sections: [], view: { show }, now: NOW, total, shown: 0, spansProjects: false });
  assert.equal(renderRunsList(doc, empty('archived'), { emptyByShow: { archived: 'No archived chats.' } }).at(-1).textContent, 'No archived chats.');
  const loading = renderRunsList(doc, empty('all'), { loading: true, loadingText: 'Loading chats…' });
  assert.equal(loading[0].className, 'runs-note runs-loading');
  assert.equal(loading[0].textContent, 'Loading chats…');
  const off = renderRunsList(doc, empty('all'), { offline: true, retry: true, offlineText: 'The chats show here once Worca\'s server is reachable again.' });
  assert.equal(off.length, 1);
  assert.ok(off[0].classList.contains('runs-offline'));
  assert.equal(off[0].querySelectorAll('[data-runs-retry]').length, 1);
  assert.equal(off[0].firstChild.textContent, 'The chats show here once Worca\'s server is reachable again.');
  const runsOff = renderRunsList(doc, empty('all'), { offline: true });
  assert.equal(runsOff[0].querySelectorAll('[data-runs-retry]').length, 0, 'Runs (retry only with a note) keeps its plain offline note');
});

test('#955 memberLine: a member drops only the Working / Starting word its dot says', () => {
  assert.equal(memberLine({ state: 'working' }, 'Working'), '');
  assert.equal(memberLine({ state: 'working' }, 'Running · Round 2 · Build'), 'Round 2 · Build');
  assert.equal(memberLine({ state: 'working' }, 'Implementation · Write tests'), 'Implementation · Write tests');
  assert.equal(memberLine({ state: 'starting' }, 'Starting'), '');
  assert.equal(memberLine({ state: 'starting' }, 'Copying the folder'), 'Copying the folder');
  assert.equal(memberLine({ state: 'starting' }, 'Round 2 · Starting'), 'Round 2 · Starting', 'only a leading word goes');
  for (const [state, line] of [['failed', 'Failed at Build'], ['paused', 'Plan · paused'], ['stopped', 'Stopped at Plan'],
    ['needs-you', 'Plan · needs you · answer 2 questions'], ['waiting', 'Waiting · starts after run 1']]) {
    assert.equal(memberLine({ state }, line), line, `${state} keeps its word`);
  }
});

test('#955 a one-line member: PR chip kept with no repeated word, no labels, no Independent, a 3px live line', () => {
  const chain = { id: 'p:c955', groupKind: 'chain', title: 'Chain', members: [
    { position: 1, pipelineId: 'm1', kind: 'hist', adhoc: true, labels: ['hotfix'], run: { status: 'done', pr: GH(7, { state: 'MERGED' }) } },
    { position: 2, pipelineId: 'p2', runId: 'r2', kind: 'live', run: { status: 'running', steps: [{ nodeId: 'n' }], active: ['n'] } }] };
  const m = buildRunsModel({ live: [liveIt('r2', { pipelineId: 'p2' })], history: [histIt('m1', { run: { status: 'done', pr: GH(7, { state: 'MERGED' }) } })],
    groups: [chain], now: NOW });
  const host = doc.createElement('div');
  host.append(...renderRunsList(doc, m));
  const members = [...host.querySelectorAll('.runs-item[data-row-key="chain:p:c955"] .runs-members > .runs-item[data-level="member"]')];
  assert.equal(members.length, 2, 'an unfinished group is open (D29)');
  const [done, live] = members;
  assert.equal(done.querySelector('.runs-pr-word').textContent, 'Merged', 'the chip stays');
  assert.doesNotMatch(done.querySelector('.runs-row-sub').textContent, /Merged/, 'the line never repeats the chip');
  assert.equal(done.querySelector('.runs-row-labels'), null, 'no label chips on a member');
  assert.equal(done.querySelector('.runs-indep'), null, 'no Independent on a member');
  assert.ok(live.querySelector(':scope > a.runs-row > .runs-row-prog > i'), 'the live member draws the 3px line');
  assert.equal(live.querySelector('.runs-stage'), null, 'not the four-section block');
  assert.doesNotMatch(live.querySelector('.runs-row-sub').textContent, /^(Working|Running)\b/);
  const liveModel = m.sections.flatMap((s) => s.rows).find((r) => r.key === 'chain:p:c955').members[1].model;
  assert.equal(live.querySelector(':scope > a.runs-row').dataset.line, liveModel.line, 'data-line keeps the canonical line (D11)');
});

test('#955 a chat inside a one-project topic group does not repeat the project; a "2 projects" group keeps it', () => {
  const chat = (id, line) => ({ key: `chat:${id}`, id, kind: 'chat', title: id, href: `#chat/${id}`, labels: [],
    model: { state: 'idle', word: 'Idle', line, dot: 'grey', pulse: false, symbol: null, icon: 'chat' } });
  const group = (where, members) => ({ key: `cgroup:${where}`, id: where, groupId: where, kind: 'chat-group', title: 'Topic', href: '#chat',
    memberNoun: 'chats', members, count: String(members.length), memberCount: members.length, open: true, groupName: where, labels: [],
    model: { state: 'idle', word: 'Idle', line: `${where} · 11:00`, dot: 'grey', pulse: false, symbol: null, icon: 'chat' } });
  const flat = { sections: [{ id: 'all', title: 'Chats', rows: [
    group('worka-cc', [chat('a', 'worka-cc · $0.40 · 11:00'), chat('b', 'worka-cc')]),
    group('2 projects', [chat('c', 'worka-cc · 10:00')]),
  ], count: 2, bare: true }], view: { show: 'all' }, now: NOW, total: 2, shown: 2, spansProjects: false };
  const host = doc.createElement('div');
  host.append(...renderRunsList(doc, flat));
  const sub = (k) => host.querySelector(`.runs-item[data-row-key="chat:${k}"] .runs-row-sub`).textContent;
  assert.equal(sub('a'), '$0.40 · 11:00');
  assert.equal(sub('b'), '');
  assert.equal(sub('c'), 'worka-cc · 10:00');
});
