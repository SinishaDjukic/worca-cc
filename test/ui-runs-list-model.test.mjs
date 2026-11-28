// test/ui-runs-list-model.test.mjs — the Runs list model (ui/public/runs-list.mjs, runs redesign §3.1): the state
// words ⌘K and the Activity menu still read, times, Needs you, the sections (Needs you · Running · Recent), Show and
// Group by, groups and their members, the one status line, cost, and the DOM the list is built from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import {
  rowTime, whenLabel, liveRowState, histRowState, schedRowState, countNeedsYou, needsYouItems,
  buildRunsModel, isRowSelected, isMemberOpen, renderRunsList, paintStageBlocks, dateBucket, DATE_BUCKETS, DAY_BUCKETS, dayBucket, isFolded, setFolded, listLine, groupRow, rowShow, groupCostUsd, costTitle, memberCostUsd, memberLine,
} from '../ui/public/runs-list.mjs';
import { RUN_STATES, groupModel } from '../src/shared/run-model.mjs';
import { icon } from '../ui/public/icons.mjs';
import * as RL from '../ui/public/runs-list.mjs';
import { checkRows } from './helpers/rows.mjs';
import { readStyleCss } from '../src/core/read-style-css.mjs';
import { fmtUsd } from '../ui/public/graph/run-decor.mjs';

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
  assert.equal(liveRowState({ status: 'paused', pauseReason: 'usage_limit', limitEngine: 'codex' }).word, 'OpenAI Codex usage limit', 'a usage limit names its engine');
  assert.equal(histRowState({ status: 'paused', pauseReason: 'usage_limit', limitEngine: 'claude' }).word, 'Claude Code usage limit');
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
  assert.equal(b(t(22, 23)), 'month');
  assert.equal(b(new Date(2026, 7, 31, 0, 0).getTime()), 'month', 'Previous 30 days: 8 to 30 days ago');
  assert.equal(b(new Date(2026, 7, 30, 23, 0).getTime()), 'older');
  assert.equal(b(NaN), 'older', 'an unknown time files under Older, not Today');
  assert.equal(dateBucket({ kind: 'live' }, NOW), 'today');
  assert.equal(dateBucket({ kind: 'sched' }, NOW), 'upcoming');
  assert.deepEqual(DATE_BUCKETS.map(([id]) => id), ['upcoming', 'today', 'yesterday', 'week', 'month', 'older']);
  assert.deepEqual(DATE_BUCKETS.slice(1), [...DAY_BUCKETS], 'Runs adds Upcoming to the day sections Chats uses');
  assert.equal(dayBucket(t(28, 23), NOW), 'week');
});

test('Group by Date: Older starts folded; the person\'s fold record flips it either way', () => {
  const history = [histIt('a', { mtime: NOW - 60000 }), histIt('b', { mtime: new Date(2026, 6, 1).getTime() })];
  const sec = (collapsed) => buildRunsModel({ history, groupBy: 'date', collapsed, now: NOW }).sections;
  assert.deepEqual(sec(new Set()).map((s) => [s.id, s.collapsed]), [['date:today', false], ['date:older', true]]);
  const c = new Set();
  setFolded(c, 'date:older', false);
  assert.ok(c.has('date:older') && !isFolded(c, 'date:older'), 'opening Older records the difference from its default');
  assert.equal(sec(c).find((s) => s.id === 'date:older').collapsed, false);
  setFolded(c, 'date:older', true);
  setFolded(c, 'date:today', true);
  assert.deepEqual([...c], ['date:today'], 'folding back to the default drops the record; Today folds like before');
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

// Slice 16 (D16): the literals were captured by running this seed through groupRow + listLine in a
// `git archive 217b540b4 ui/public src` copy; this tree gave the same ones before the slice's changes.
test('s16 (R-qa-4): an unmarked feature\'s group line equals the checkpoint 217b540b4 output in every section', () => {
  const working = { status: 'running', steps: [{ nodeId: 'n1', status: 'running' }], active: ['n1'] };
  const paused = { status: 'paused' };
  for (const [name, one, two, modelLine, line] of [
    ['the paused run is current', { status: 'done' }, paused, 'Run 2 of 2 · paused', 'Paused · Run 2'],
    ['the paused run is not current', working, paused, 'Run 1 of 2 · working', 'Run 2 paused'],
    ['not current, on a cost limit', working, { status: 'paused', pauseReason: 'cost_pipeline' }, 'Run 1 of 2 · working', 'Run 2 paused · Cost limit'],
  ]) {
    const row = groupRow({ id: 'feat_plain', groupKind: 'feature', title: 'Two runs', members: [
      { position: 1, title: 'Slice 1', pipelineId: 'u1', kind: 'hist', run: one },
      { position: 2, title: 'Slice 2', pipelineId: 'u2', kind: 'hist', run: two }] }, { now: NOW });
    assert.equal(row.model.line, modelLine, name);
    for (const section of ['needs', 'running', '']) assert.equal(listLine(row, { section }), line, `${name}, section "${section}"`);
  }
});

const LIVE3 = [liveIt('ask', { run: { status: 'running', pendingQuestion: { kind: 'plan' }, steps: [] }, ask: { kind: 'plan' } }),
  liveIt('w1', { run: { status: 'running', steps: [{ nodeId: 'n1' }], active: ['n1'] } }),
  liveIt('w2', { run: { status: 'running', steps: [{ nodeId: 'n1' }], active: ['n1'] } })];
const HIST5 = Array.from({ length: 5 }, (_, i) => histIt(`d${i}`, { run: { status: 'done' } }));

test('Show / Group by: counts, Running excludes ended runs, project grouping keeps Needs you on top', () => {
  const m = buildRunsModel({ live: LIVE3, history: HIST5, show: 'running', now: NOW });   // LIVE3: ask + 2 working; HIST5: 5 done
  assert.deepEqual(m.counts, { all: 8, needs: 1, running: 3, waiting: 0, finished: 5, ready: 5, archived: null });
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

test('Show = Ready to ship: finished git runs with no open PR, not Folder, no-project, in-review, merged or archived', () => {
  const pr = (state) => ({ url: 'https://github.com/o/r/pull/7', number: 7, state });
  const history = [
    histIt('h-ready', { run: { status: 'done' } }),
    histIt('h-closed', { run: { status: 'done', pr: pr('CLOSED') } }),
    histIt('h-open', { run: { status: 'done', pr: pr('OPEN') } }),
    histIt('h-merged', { run: { status: 'done', pr: pr('MERGED') } }),
    histIt('h-folder', { run: { status: 'done', workMode: 'folder', changes: null } }),
    histIt('h-none', { run: { status: 'done', workMode: 'none' } }),
    histIt('h-arch', { archived: true, run: { status: 'done' } }),
  ];
  const m = buildRunsModel({ live: [liveIt('r')], history, show: 'ready', now: NOW });
  assert.deepEqual(keysOf(m).sort(), ['hist:worca-00000002/h-closed', 'hist:worca-00000002/h-ready']);
  assert.equal(m.counts.ready, 2);
  assert.deepEqual(m.sections.map((s) => s.title), ['Ready to ship']);
  assert.equal(buildRunsModel({ live: [liveIt('r')], history, now: NOW }).counts.ready, 2, 'counted under Show = All too');
  assert.equal(renderRunsList(doc, buildRunsModel({ live: [liveIt('r')], show: 'ready', now: NOW })).at(-1).textContent, 'Nothing is ready to ship.');
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
  assert.equal(where('chain:feat_m'), 'date:month');
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
  const css = readStyleCss();
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

test('#1012 a staged live member draws the four-section block; a working one names no step, a needing one keeps why', () => {
  const run = { status: 'running', steps: [{ nodeId: 'n' }], active: ['n'], stepper: { auto: { status: 'deciding' } } };   // Plan · choosing the workflow
  const chain = { id: 'p:c1012', groupKind: 'chain', title: 'Chain', members: [
    { position: 1, pipelineId: 'p1', runId: 'r1', kind: 'live', run }] };
  const m = buildRunsModel({ live: [liveIt('r1', { pipelineId: 'p1', run })], groups: [chain], now: NOW });
  const host = doc.createElement('div');
  host.append(...renderRunsList(doc, m));
  const row = host.querySelector('.runs-members .runs-item[data-level="member"] > a.runs-row');
  assert.ok(row.querySelector(':scope > .runs-stage .run-prog-track'), 'the four-section bar');
  assert.equal(row.querySelector(':scope > .runs-stage .run-prog-mark[data-state="current"]').textContent, 'Plan');
  assert.equal(row.querySelector(':scope > .runs-row-prog'), null, 'no 3px line beside it');
  assert.equal(row.querySelector('.runs-row-sub').textContent, '', 'the marks say Plan, the dot says Working: no step');
  assert.equal(row.dataset.line, 'Plan · choosing the workflow', 'data-line keeps the canonical line (D11)');
  const asking = { ...run, pendingQuestion: { questions: [{ id: 'q1', question: 'Which?' }] } };
  const m2 = buildRunsModel({ live: [liveIt('r1', { pipelineId: 'p1', run: asking })],
    groups: [{ ...chain, members: [{ ...chain.members[0], run: asking }] }], now: NOW });
  const host2 = doc.createElement('div');
  host2.append(...renderRunsList(doc, m2));
  const sub2 = host2.querySelector('.runs-members .runs-item[data-level="member"] .runs-row-sub').textContent;
  assert.match(sub2, /^needs you/, 'a state the dot does not say stays, without the stage word');
});

test('#1012 a member dispatched but not started yet draws no progress at all', () => {
  const run = { status: 'running', stepper: { auto: { status: 'deciding' } } };   // no step yet: Starting, with stages
  const chain = { id: 'p:c1012s', groupKind: 'chain', title: 'Chain', members: [
    { position: 1, pipelineId: 'p1', runId: 'r1', kind: 'live', run }] };
  const m = buildRunsModel({ live: [liveIt('r1', { pipelineId: 'p1', run })], groups: [chain], now: NOW });
  assert.equal(m.sections.flatMap((s) => s.rows)[0].members[0].model.state, 'starting');
  const host = doc.createElement('div');
  host.append(...renderRunsList(doc, m));
  const row = host.querySelector('.runs-members .runs-item[data-level="member"] > a.runs-row');
  assert.equal(row.querySelector(':scope > .runs-stage'), null, 'no four-section block');
  assert.equal(row.querySelector(':scope > .runs-row-prog'), null, 'no 3px line');
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

test('#1067 a staged row\'s fill moves in place: the state replay after a first paint from hello alone reaches the bar', () => {
  // The Runs list rebuilds a row only when its signature (app.js runsRowSig: stage and label, not the fill) changes, so a
  // row first painted from hello (stepper, no steps: Plan not begun) kept 0% after the replayed state began Plan.
  const graph = { nodes: [{ id: 'n_clarify', kind: 'agent', progressStage: 'plan' }, { id: 'n_impl', kind: 'agent', progressStage: 'build' }] };
  const stepper = { version: 2, graph };
  const pq = { kind: 'clarify', questions: [{ id: 'q1', question: 'Which?' }] };
  const model = (run) => buildRunsModel({ live: [liveIt('r1', { pipelineId: 'p1', ask: { kind: 'clarify', step: '' }, run })], now: NOW });
  const before = model({ status: 'running', stepper, steps: [], pendingQuestion: pq });
  const after = model({ status: 'running', stepper, pendingQuestion: pq,
    steps: [{ executionId: 'x:n_clarify:1', nodeId: 'n_clarify', status: 'start' }] });
  const host = doc.createElement('div');
  host.append(...renderRunsList(doc, before));
  const fill = () => host.querySelector('.runs-item[data-row-key="live:r1"] .run-prog-sec[data-stage="plan"] .run-prog-fill').style.width;
  assert.equal(fill(), '0%', 'not begun from hello alone');
  paintStageBlocks(host, after);
  assert.equal(fill(), '10%', 'START_SHARE once the clarify row exists');
});

// ── PR fix rounds stack under their run (plans/pr-fix-rounds-stacking-plan.md, Tasks 1, 3, 4) ──
const PR947 = { url: 'https://github.com/worca-org/worca/pull/947', number: 947, state: 'OPEN', mergeable: 'CONFLICTING' };
const REVIEW = (n) => ({ url: `https://github.com/worca-org/worca/pull/${n}`, number: n, state: 'OPEN', mergeable: 'MERGEABLE' });
const marker = (n, extra = {}) => ({ pipelineId: 'ba22d7fd', round: n, request: 'merge dev in', by: 'watch', kinds: ['conflicts'],
  outcome: { kind: 'pushed', sha: `${n}e4f5a6` }, ...extra });
// Round n: done, its own PR chip on #947 (attachPr), finished on Sep (20 + n).
const roundIt = (n, extra = {}) => histIt(`rnd${n}`, { title: 'Merge dev into PR 947 and resolve conflicts', mtime: Date.parse(at(20 + n, 10, 0)),
  roundOf: marker(n), run: { status: 'done', pr: PR947, round: marker(n) }, ...extra });
const ROUNDS = [2, 3, 4, 5, 6, 7, 8].map((n) => roundIt(n));
const ORIGIN = histIt('ba22d7fd', { title: 'Route swallowed step failures', mtime: Date.parse(at(20, 9, 0)), run: { status: 'done', pr: PR947 } });
const FEATURE = { id: 'feat_flag', groupKind: 'feature', title: 'Flag runs that finish without being successful', members: [
  { position: 1, title: 'Catch a run that finished without success', pipelineId: 'm1', kind: 'hist', run: { status: 'done', pr: REVIEW(940) } },
  { position: 2, title: 'Show done, unsuccessful in the list', pipelineId: 'm2', kind: 'hist', run: { status: 'done', pr: REVIEW(941) } },
  { position: 3, title: 'Route swallowed step failures', pipelineId: 'ba22d7fd', kind: 'hist', run: { status: 'done', pr: PR947 } }] };
const HIST947 = [histIt('m1', { run: { status: 'done', pr: REVIEW(940) } }), histIt('m2', { run: { status: 'done', pr: REVIEW(941) } }), ORIGIN, ...ROUNDS];
// The badge reads raw History rows: { id, status, pr, roundOf, mtime }.
const rawOf = (h) => ({ id: h.id, status: h.status, pr: h.run.pr, mtime: h.mtime, ...(h.roundOf ? { roundOf: h.roundOf } : {}) });
const roundPids = new Set(ROUNDS.map((r) => r.id));
const everyRow = (m) => rowsOf(m).flatMap((r) => [r, ...(r.members || [])]);

test('rounds (Task 1): histRow / liveRow copy the marker; a malformed one is dropped', () => {
  assert.deepEqual(buildRunsModel({ history: [roundIt(8)], now: NOW }).sections[0].rows[0].roundOf, marker(8));
  const lv = liveIt('run9', { pipelineId: 'rnd9', roundOf: marker(9, { outcome: undefined }) });
  const { liveRow, histRow } = RL;
  assert.equal(liveRow(lv, NOW).roundOf.round, 9);
  assert.equal(histRow(roundIt(8), NOW).roundOf.pipelineId, 'ba22d7fd');
  assert.equal(histRow(histIt('x', { roundOf: { pipelineId: 'o', round: 1 } }), NOW).roundOf, null, 'round 1 is the run itself');
  assert.equal(histRow(histIt('x'), NOW).roundOf, null);
});

test('rounds (Task 3, D8): one open PR raises one Needs-you item — #947 counts 1, not 8', () => {
  assert.equal(countNeedsYou({ history: HIST947.map(rawOf) }), 1, 'the origin only; its 7 rounds never count through the PR');
  const a = { id: 'u1', status: 'done', pr: PR947, mtime: 1000 };
  const b = { id: 'u2', status: 'done', pr: { ...PR947, url: `${PR947.url}/` }, mtime: 2000 };
  assert.deepEqual(needsYouItems({ history: [a, b] }).history.map((p) => p.id), ['u2'], 'two unmarked runs on one open PR: the newest');
  assert.equal(countNeedsYou({ history: [a, { ...b, pr: { ...PR947, url: `${PR947.url}0`, number: 9470 } }] }), 2, 'two PRs: two');
  const paused = { id: 'rp', status: 'paused', roundOf: marker(9, { outcome: undefined }), pr: PR947 };
  assert.equal(countNeedsYou({ history: [...HIST947.map(rawOf), paused] }), 2, 'a paused round still needs you for its pause');
  const fixing = { runId: 'run9', pipelineId: 'rnd9', status: 'running', roundOf: marker(9, { outcome: undefined }) };
  assert.equal(countNeedsYou({ live: [fixing], history: HIST947.map(rawOf) }), 0, 'a live fix round: the origin is Working (D5)');
});

test('rounds (Task 4): #947 folds into the group — one Needs-you row, member 3 carries its 7 rounds', () => {
  const m = buildRunsModel({ history: HIST947, groups: [FEATURE], now: NOW });
  const needs = m.sections.find((s) => s.id === 'needs');
  assert.deepEqual(needs.rows.map((r) => r.key), ['chain:feat_flag']);
  assert.equal(m.counts.needs, needs.count);
  assert.equal(needs.count, countNeedsYou({ history: HIST947.map(rawOf) }), 'the section and the badge agree');
  const mb = needs.rows[0].members.find((x) => x.pipelineId === 'ba22d7fd');
  assert.equal(mb.rounds.length, 7);
  assert.deepEqual(mb.rounds.map((rd) => rd.n), [8, 7, 6, 5, 4, 3, 2], 'newest first');
  assert.match(mb.roundsLine, /^Round 8 · merge dev in · pushed 8e4f5a6/);
  assert.equal(needs.rows[0].count, '3/3', 'rounds are not members');
  assert.equal(everyRow(m).some((r) => roundPids.has(r.pipelineId)), false, 'no round lists anywhere else');
  assert.equal(listLine(needs.rows[0], { section: 'needs' }), 'Run 3 needs you · Conflicts · 7 rounds');
  // Selecting a round marks its member's group (isMemberOpen).
  assert.equal(isMemberOpen(needs.rows[0], { pipelineId: 'rnd5' }), true);
});

test('rounds (Task 4): a top-level origin and its rounds are one row; a round page selects it', () => {
  const m = buildRunsModel({ history: [ORIGIN, roundIt(2), roundIt(3)], now: NOW });
  const rows = rowsOf(m);
  assert.deepEqual(rows.map((r) => r.pipelineId), ['ba22d7fd']);
  assert.deepEqual(rows[0].rounds.map((rd) => rd.n), [3, 2]);
  assert.equal(rows[0].activityMs, Date.parse(at(23, 10, 0)), 'the stack moves up with its newest round');
  assert.equal(isRowSelected(rows[0], { pipelineId: 'rnd2' }), true);
  assert.equal(isRowSelected(rows[0], { pipelineId: 'other' }), false);
});

test('rounds (Task 4, D5): a live round runs the stack — Working, its line, Fixing, in Running not Needs you', () => {
  const run9 = { status: 'running', steps: [{ nodeId: 'n_impl', status: 'start' }], active: [{ nodeId: 'n_impl' }],
    branch: { roundOf: marker(9, { outcome: undefined }) } };
  const live = [liveIt('run9', { pipelineId: 'rnd9', roundOf: marker(9, { outcome: undefined }), run: run9 })];
  const top = buildRunsModel({ live, history: [ORIGIN, roundIt(8)], now: NOW });
  const head = rowsOf(top).find((r) => r.pipelineId === 'ba22d7fd');
  assert.equal(rowsOf(top).length, 1);
  assert.equal(head.model.state, 'working');
  assert.equal(head.roundsLine, 'Running · Round 9 · merge dev in');
  assert.equal(head.model.pr.word, 'Fixing');
  assert.equal(head.href, ORIGIN && `#history/worca-00000002/ba22d7fd`, 'the origin\'s href');
  assert.equal(head.title, 'Route swallowed step failures');
  assert.deepEqual(top.sections.map((s) => s.id), ['running']);
  const grp = buildRunsModel({ live, history: HIST947, groups: [FEATURE], now: NOW });
  assert.deepEqual(grp.sections.map((s) => [s.id, s.rows.map((r) => r.key)]), [['running', ['chain:feat_flag']]]);
  const g = grp.sections[0].rows[0];
  const mb = g.members.find((x) => x.pipelineId === 'ba22d7fd');
  assert.deepEqual([mb.model.state, mb.model.pr.word, mb.roundsLine], ['working', 'Fixing', 'Running · Round 9 · merge dev in']);
  assert.equal(g.count, '3/3', 'rounds are not members: the count holds while round 9 runs');
  assert.equal(listLine(g, { section: 'running' }), 'Run 3 · Round 9 · merge dev in');
  assert.equal(isMemberOpen(g, { runId: 'run9' }), true);
});

test('rounds (Task 4): a paused round raises its stack to Needs you', () => {
  const paused = roundIt(9, { status: 'paused', mtime: Date.parse(at(29, 10, 0)), roundOf: marker(9, { outcome: undefined }),
    run: { status: 'paused', pr: PR947, round: marker(9, { outcome: undefined }) } });
  const m = buildRunsModel({ history: [ORIGIN, roundIt(8), paused], now: NOW });
  const head = rowsOf(m)[0];
  assert.deepEqual([rowsOf(m).length, head.needs, head.model.state], [1, true, 'paused']);
  assert.equal(m.sections[0].id, 'needs');
});

test('rounds (Task 4, D3): an orphan stack — the newest round heads, titled with its round; nothing disappears', () => {
  const m = buildRunsModel({ history: [roundIt(7), roundIt(8)], now: NOW });
  const rows = rowsOf(m);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].pipelineId, 'rnd8');
  assert.equal(rows[0].title, 'Merge dev into PR 947 and resolve conflicts · Round 8');
  assert.equal(rows[0].href, '#history/worca-00000002/rnd8', 'its own page');
  assert.deepEqual(rows[0].rounds.map((rd) => rd.n), [7]);
  // The origin is a member of a group that is not listed: its title names the stack.
  const named = buildRunsModel({ history: [roundIt(8)], groups: [FEATURE], now: NOW });
  assert.equal(rowsOf(named)[0].title, 'Route swallowed step failures · Round 8');
});

test('rounds (Task 4, D4): an archived origin hides its rounds from the active list; Show = Archived folds them', () => {
  const active = buildRunsModel({ history: [roundIt(7), roundIt(8)], archivedIds: new Set(['ba22d7fd']), now: NOW });
  assert.equal(rowsOf(active).length, 0);
  const archived = buildRunsModel({ show: 'archived', archivedIds: new Set(['ba22d7fd']), now: NOW,
    history: [{ ...ORIGIN, archived: true }, roundIt(7, { archived: true }), roundIt(8, { archived: true })] });
  assert.deepEqual(rowsOf(archived).map((r) => [r.pipelineId, r.rounds.length]), [['ba22d7fd', 2]]);
});

test('rounds (D4 with D3 / D5): an archived run\'s round that is live or needs you still lists, as the badge counts it', () => {
  const ids = new Set(['ba22d7fd']);
  const pausedMk = marker(9, { outcome: undefined });
  const paused = roundIt(9, { status: 'paused', mtime: Date.parse(at(29, 10, 0)), roundOf: pausedMk, run: { status: 'paused', pr: PR947, round: pausedMk } });
  const m1 = buildRunsModel({ history: [roundIt(7), roundIt(8), paused], archivedIds: ids, now: NOW });
  assert.deepEqual(m1.sections.map((s) => [s.id, s.rows.map((r) => r.pipelineId)]), [['needs', ['rnd9']]], 'the paused round heads an orphan stack');
  assert.equal(rowsOf(m1)[0].title, 'Merge dev into PR 947 and resolve conflicts · Round 9');
  assert.equal(rowsOf(m1)[0].rounds, undefined, 'its archived run\'s finished rounds stay out');
  assert.equal(m1.counts.needs, countNeedsYou({ history: [rawOf(roundIt(7)), rawOf(roundIt(8)), { ...rawOf(paused), status: 'paused' }] }));
  const asking = liveIt('run9', { pipelineId: 'rnd9', roundOf: pausedMk, ask: { q: 'which?' },
    run: { status: 'running', pendingQuestion: 'which?', branch: { roundOf: pausedMk } } });
  const m2 = buildRunsModel({ live: [asking], history: [roundIt(8)], archivedIds: ids, now: NOW });
  assert.deepEqual(m2.sections.map((s) => [s.id, s.rows.map((r) => r.key)]), [['needs', ['live:run9']]]);
  assert.equal(m2.counts.needs, countNeedsYou({ live: [asking], history: [rawOf(roundIt(8))] }));
  const running = liveIt('run9', { pipelineId: 'rnd9', roundOf: pausedMk,
    run: { status: 'running', steps: [{ nodeId: 'n', status: 'start' }], active: [{ nodeId: 'n' }], branch: { roundOf: pausedMk } } });
  const m3 = buildRunsModel({ live: [running], history: [roundIt(8)], archivedIds: ids, now: NOW });
  assert.deepEqual(m3.sections.map((s) => [s.id, s.rows.map((r) => r.key)]), [['running', ['live:run9']]], 'a running round never vanishes');
  // An archived origin row that IS in the feed (its own row archived): the live round still lists, not under the hidden row.
  const m4 = buildRunsModel({ live: [running], history: [{ ...ORIGIN, archived: true }], now: NOW });
  assert.deepEqual(m4.sections.map((s) => [s.id, s.rows.map((r) => r.key)]), [['running', ['live:run9']]]);
});

test('rounds (Task 4): the person and label filters apply to the head only', () => {
  const hist = [{ ...ORIGIN, by: 'ann', labels: ['ux'] }, roundIt(7, { by: 'bob' }), roundIt(8, { by: 'bob' })];
  const ann = buildRunsModel({ history: hist, person: 'ann', now: NOW });
  assert.deepEqual(rowsOf(ann).map((r) => [r.pipelineId, r.rounds.length]), [['ba22d7fd', 2]], 'her run keeps its rounds');
  const lab = buildRunsModel({ history: hist, labels: ['ux'], now: NOW });
  assert.deepEqual(rowsOf(lab).map((r) => r.pipelineId), ['ba22d7fd']);
  const bob = buildRunsModel({ history: hist, person: 'bob', now: NOW });
  assert.deepEqual(rowsOf(bob).map((r) => [r.pipelineId, r.rounds.length]), [['rnd8', 1]], 'the origin filtered out: an orphan stack');
});

test('rounds (Task 3, D8): two unmarked runs on one open PR — the newest in Needs you, the other under Recent', () => {
  const a = histIt('u1', { mtime: Date.parse(at(28, 9, 0)), run: { status: 'done', pr: PR947 } });
  const b = histIt('u2', { mtime: Date.parse(at(29, 9, 0)), run: { status: 'done', pr: PR947 } });
  const m = buildRunsModel({ history: [a, b], now: NOW });
  assert.deepEqual(m.sections.map((s) => [s.id, s.rows.map((r) => r.pipelineId)]), [['needs', ['u2']], ['recent', ['u1']]]);
  assert.equal(m.counts.needs, 1);
  const older = m.sections[1].rows[0];
  assert.deepEqual([older.needs, older.model.state, older.model.prNeeds], [false, 'in-review', false], 'the deduped run reads In review');
  assert.doesNotMatch(listLine(older, { section: 'recent', time: 'Mon' }), /Needs you|Conflicts/);
  assert.equal(older.model.pr.word, 'Conflicts', 'its PR chip still says what is wrong');
  // A group variant: G's member B (older) loses to the newer top-level run A on the same PR.
  const G = { id: 'g', groupKind: 'feature', title: 'G', members: [
    { position: 1, title: 'one', pipelineId: 'g1', kind: 'hist', run: { status: 'done', pr: REVIEW(940) } },
    { position: 2, title: 'B', pipelineId: 'gB', kind: 'hist', startedAt: at(27, 9, 0), run: { status: 'done', pr: PR947 } }] };
  const A = histIt('uA', { startedAt: at(29, 9, 0), mtime: Date.parse(at(29, 9, 0)), run: { status: 'done', pr: PR947 } });
  const gm = buildRunsModel({ history: [A, histIt('g1', { run: G.members[0].run }), histIt('gB', { startedAt: at(27, 9, 0), run: G.members[1].run })],
    groups: [G], now: NOW });
  assert.deepEqual(gm.sections.map((s) => [s.id, s.rows.map((r) => r.key)]), [['needs', ['hist:worca-00000002/uA']], ['recent', ['chain:g']]]);
  const g = gm.sections[1].rows[0];
  assert.equal(g.needs, false);
  assert.doesNotMatch(listLine(g, { section: 'recent', time: 'Mon' }), /[Nn]eeds you/);
  assert.equal(g.members[1].model.state, 'in-review');
  const two = buildRunsModel({ history: [a, histIt('u3', { run: { status: 'done', pr: { ...PR947, url: `${PR947.url}0` } } })], now: NOW });
  assert.equal(two.counts.needs, 2);
});

// #1200: the row ⋯ menu opens each member PR of a workspace run.
const wsHist = (id, memberPrs) => histIt(id, { run: { status: 'done', memberPrs } });
const WSPR = (repo, n) => ({ number: n, url: `https://github.com/acme/${repo}/pull/${n}`, state: 'OPEN' });

test('rowMenuPrs: two member PRs → one entry each, with its repo and url', () => {
  const m = RL.buildRunsModel({ history: [wsHist('w2', [WSPR('repo-a', 12), WSPR('repo-b', 34)])], now: NOW });
  const r = rowsOf(m).find((x) => x.pipelineId === 'w2');
  assert.deepEqual(RL.rowMenuPrs(r), [
    { number: 12, url: 'https://github.com/acme/repo-a/pull/12', repo: 'repo-a' },
    { number: 34, url: 'https://github.com/acme/repo-b/pull/34', repo: 'repo-b' },
  ]);
});

test('rowMenuPrs: one PR or none → [] (the single View PR stays)', () => {
  const m = RL.buildRunsModel({ history: [wsHist('w1', [WSPR('repo-a', 12)]), wsHist('w0', [])], now: NOW });
  for (const id of ['w1', 'w0']) assert.deepEqual(RL.rowMenuPrs(rowsOf(m).find((x) => x.pipelineId === id)), []);
});

test('prRepoOf: the repo segment for GitHub, GitLab and Azure DevOps urls', () => {
  assert.equal(RL.prRepoOf('https://github.com/acme/repo-a/pull/1'), 'repo-a');
  assert.equal(RL.prRepoOf('https://gitlab.com/g/sub/repo-c/-/merge_requests/2'), 'repo-c');
  assert.equal(RL.prRepoOf('https://dev.azure.com/o/p/_git/repo-d/pullrequest/3'), 'repo-d');
  assert.equal(RL.prRepoOf('https://bitbucket.org/ws/repo-e/pull-requests/4'), 'repo-e');
  assert.equal(RL.prRepoOf('not a url'), '');
});

test('prRepoOf owner: "owner/repo", skipping Azure DevOps\' _git and Bitbucket Server\'s repos', () => {
  assert.equal(RL.prRepoOf('https://github.com/acme/repo-a/pull/1', { owner: true }), 'acme/repo-a');
  assert.equal(RL.prRepoOf('https://dev.azure.com/o/p/_git/repo-d/pullrequest/3', { owner: true }), 'p/repo-d');
  assert.equal(RL.prRepoOf('https://bb.example.com/projects/P/repos/repo-f/pull-requests/5', { owner: true }), 'P/repo-f');
});

test('rowMenuPrs: two repos with one name are told apart by their owner', () => {
  const pr = (owner, n) => ({ number: n, url: `https://github.com/${owner}/api/pull/${n}`, state: 'OPEN' });
  const m = RL.buildRunsModel({ history: [wsHist('w3', [pr('acme', 1), pr('beta', 2), WSPR('repo-b', 3)])], now: NOW });
  assert.deepEqual(RL.rowMenuPrs(rowsOf(m).find((x) => x.pipelineId === 'w3')).map((p) => p.repo), ['acme/api', 'beta/api', 'repo-b']);
});

test('rowMenuPrs: a group member row reads its raw run\'s member PRs', () => {
  const g = RL.groupRow({ id: 'g1', members: [{ run: { status: 'done', memberPrs: [WSPR('repo-a', 12), WSPR('repo-b', 34)] } }] });
  assert.deepEqual(RL.rowMenuPrs(g.members[0]).map((p) => p.repo), ['repo-a', 'repo-b']);
});

// ── D2 · a Shaper small-runs feature (smallRuns: true): the cost said once, one-line `.srows` members ──
const TEN = Array.from({ length: 10 }, (_, i) => `sr${i + 1}`);
const smallFeature = (extra = {}) => ({ id: 'feat_small', groupKind: 'feature', title: 'Ten runs', smallRuns: true,
  cost: { usd: 4.12, byPipeline: Object.fromEntries(TEN.map((id, i) => [id, i < 3 ? 1.37 : 0.01])) },
  members: TEN.map((id, i) => ({ position: i + 1, title: `Slice ${i + 1}`, pipelineId: id, kind: 'hist', run: { status: i < 3 ? 'done' : 'error' } })),
  ...extra });
const smallHost = (g, open = false) => {
  const host = doc.createElement('div');
  host.append(...renderRunsList(doc, buildRunsModel({ history: TEN.map((id) => histIt(id, { run: { status: 'done' } })), groups: [g],
    toggled: new Map([[`chain:${g.id}`, open]]), now: NOW })));
  return host;
};

test('D2 (D2): a marked group row says its cost once, as visible text after the count, and its anchor has no cost title', () => {
  const g = smallFeature();
  const host = smallHost(g);
  const rows = host.querySelectorAll('.runs-item[data-row-key="chain:feat_small"]');
  assert.equal(rows.length, 1);
  const a = rows[0].querySelector(':scope > a.runs-row-chain');
  assert.ok(a);
  assert.equal(host.querySelectorAll('.runs-row-chain').length, 1);
  const cost = a.querySelectorAll('.runs-row-right > .runs-cost');
  assert.equal(cost.length, 1);
  assert.equal(cost[0].className, 'runs-cost mono');
  assert.equal(groupCostUsd(g), 4.18);
  assert.equal(cost[0].textContent, fmtUsd(4.18));
  assert.equal(groupRow(g, { now: NOW }).smallRuns, true);
  assert.equal(cost[0].previousElementSibling.className, 'runs-count');
  assert.equal(a.hasAttribute('title'), false, 'the cost is said once: no hover title');
});

test('D2 (D2): an unmarked group row keeps the cost title and has no .runs-cost', () => {
  const { smallRuns, ...plain } = smallFeature();
  assert.equal(smallRuns, true);
  const host = smallHost(plain);
  const a = host.querySelector('.runs-item[data-row-key="chain:feat_small"] > a.runs-row-chain');
  assert.match(a.getAttribute('title'), /^Group total \$/);
  assert.equal(host.querySelector('.runs-cost'), null);
  assert.equal(groupRow(plain, { now: NOW }).smallRuns, undefined);
  assert.equal('smallRuns' in groupRow(plain, { now: NOW }), false);
});

test('D2 (D4): expanded, a marked group lists 10 member rows in .runs-members.srows, numbered 1 to 10', () => {
  const host = smallHost(smallFeature(), true);
  const list = host.querySelector('.runs-item[data-row-key="chain:feat_small"] > .runs-members');
  assert.equal(list.className, 'runs-members srows');
  const titles = [...list.querySelectorAll(':scope > .runs-item[data-level="member"] .runs-row-title')].map((t) => t.textContent);
  assert.equal(titles.length, 10);
  assert.equal(titles[0], '1 · Slice 1');
  assert.equal(titles[9], '10 · Slice 10');
  for (const it of list.querySelectorAll(':scope > .runs-item')) assert.equal(it.querySelectorAll(':scope > .runs-pick > .status-dot').length, 1);
  const { smallRuns, ...plain } = smallFeature();
  assert.equal(smallRuns, true);
  assert.equal(smallHost(plain, true).querySelector('.runs-members').className, 'runs-members', 'unmarked: dev\'s class');
});

test('D2 (owner direction): a marked group\'s member rows say the card\'s short word; an unmarked group keeps dev\'s line', () => {
  const g = smallFeature({ members: TEN.map((id, i) => (i < 9
    ? { position: i + 1, title: `Slice ${i + 1}`, pipelineId: id, kind: 'hist', run: { status: 'done' } }
    : { position: 10, title: 'Slice 10', ticketId: 't10', kind: 'sched', run: { ticket: { status: 'scheduled', after: { index: 9 } } } })) });
  const subs = (host) => [...host.querySelectorAll('.runs-members > .runs-item[data-level="member"] > a.runs-row > .runs-row-sub')].map((s) => s.textContent);
  const marked = subs(smallHost(g, true));
  assert.equal(marked.length, 10);
  assert.deepEqual(marked.slice(0, 9), Array(9).fill('done'));
  assert.equal(marked[9], 'waits for run 9');
  const { smallRuns, ...plain } = g;
  assert.equal(smallRuns, true);
  const dev = subs(smallHost(plain, true));
  assert.match(dev[0], /^Ready to ship/, 'unmarked: dev\'s long line');
  // A live marked member with a Care plan reads the run's word (the snapshot runsGroupItem attaches).
  const live = smallFeature({ members: [{ position: 1, title: 'Slice 1', pipelineId: 'sr1', kind: 'hist', run: { status: 'running' },
    snap: { status: 'running', stepper: { careRun: { planReviewers: [] } }, active: [{ nodeId: 'n_impl' }] } }] });
  assert.equal(subs(smallHost(live, true))[0], 'building');
});

test('D2 (correctness-2-1): a live marked member waiting for an answer reads "waiting for you", never its working word', async () => {
  const subs = (host) => [...host.querySelectorAll('.runs-members > .runs-item[data-level="member"] > a.runs-row > .runs-row-sub')].map((s) => s.textContent);
  const member = (pendingQuestion) => smallFeature({ members: [{ position: 1, title: 'Slice 1', pipelineId: 'sr1', kind: 'hist',
    run: { status: 'running', pendingQuestion },
    snap: { status: 'running', pendingQuestion, stepper: { careRun: { planReviewers: [] } }, active: [{ nodeId: 'n_impl' }] } }] });
  assert.equal(subs(smallHost(member({ stop: { reason: 'objection' } }), true))[0], 'waiting for you');
  // A plain question (no stop): the card has no word for it, so the row keeps dev's line, not 'building'.
  assert.notEqual(subs(smallHost(member({ kind: 'clarify' }), true))[0], 'building');
  // runsGroupItem (app.js) attaches the run's pendingQuestion to the snapshot, as the run page's Agents panel does.
  const { readFileSync } = await import('node:fs');
  const app = readFileSync(new URL('../ui/public/app.js', import.meta.url), 'utf8');
  assert.match(app, /\{ snap: \{ \.\.\.snapshotFromState\(r\), pendingQuestion: r\.pendingQuestion \|\| null \} \}/);
});

test('D2 (D4): a marked member with fix rounds still renders its .runs-rounds-line', () => {
  const m = buildRunsModel({ history: HIST947, groups: [{ ...FEATURE, smallRuns: true }], toggled: new Map([['chain:feat_flag', true]]), now: NOW });
  const host = doc.createElement('div');
  host.append(...renderRunsList(doc, m));
  const list = host.querySelector('.runs-members.srows');
  assert.ok(list);
  assert.ok(list.querySelector('.runs-item[data-level="member"] .runs-rounds-line'));
});

test('D2 (D4): truncation order in a marked group: the title ellipsizes first, the short line word and the PR chip stay', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../ui/public/shape/shape-it.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const body = (sel) => css.match(new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
  // (0,3,0) beats dev's (0,2,0) `.runs-members .runs-row-sub{flex:0 1000 auto}` and the title's min-width:50%.
  assert.match(body('.srows.runs-members .runs-row-title'), /min-width:0/);
  assert.match(body('.srows.runs-members .runs-row-sub'), /flex:none/);
  // The right column (the PR chip) keeps its width: the title's min-width:0 takes the overflow, so the chip's word never
  // collapses before the title has finished ellipsizing (webui cycle 2: "In review" shrank to 3px of 53px).
  assert.match(body('.srows.runs-members .runs-row-right'), /flex:none/);
});

// ── fail closed: a small-runs feature with an owner-less requirement (hold) is done but not ready to ship ──
test('a held small-runs feature row says the reason, never "Ready to ship", and is not in the Ready filter', () => {
  const hold = 'R-ops-1 is owned by no run and confirmed by no person';
  const done = smallFeature({ members: TEN.slice(0, 2).map((id, i) => ({ position: i + 1, title: `Slice ${i + 1}`, pipelineId: id, kind: 'hist', run: { status: 'done' } })) });
  const shows = (g, show) => rowShow(groupRow(g, { now: NOW }), show);
  const row = (g) => smallHost(g).querySelector('.runs-item[data-row-key="chain:feat_small"] > a.runs-row');
  assert.match(row(done).textContent, /Ready to ship/);
  assert.equal(shows(done, 'ready'), true);
  const a = row({ ...done, hold });
  assert.ok(a.textContent.includes(hold), a.textContent);
  assert.doesNotMatch(a.textContent, /Ready to ship/);
  assert.equal(shows({ ...done, hold }, 'ready'), false);
  assert.equal(shows({ ...done, hold }, 'finished'), true, 'still listed as finished');
});

test('item 7: a small-runs member reads the card\'s word from its slice: waiting for you, after run 9, waits for run 8; no slice: dev\'s line', () => {
  const subs = (host) => [...host.querySelectorAll('.runs-members > .runs-item[data-level="member"] > a.runs-row > .runs-row-sub')].map((s) => s.textContent);
  const ask = { kind: 'plan', plan: {}, stop: { reason: 'check' } };
  const mb = (over) => ({ position: 2, title: 'Slice 2', pipelineId: 'sr2', kind: 'hist', run: { status: 'running', pendingQuestion: ask }, ...over });
  const first = { position: 1, title: 'Slice 1', pipelineId: 'sr1', kind: 'hist', run: { status: 'done' } };
  const word = (over) => subs(smallHost(smallFeature({ members: [first, mb(over)] }), true)).at(-1);
  assert.equal(word({ snap: { status: 'running', pendingQuestion: ask } }), 'waiting for you', 'a stop on a run without a Care plan');
  assert.equal(word({ slice: { stop: { reason: 'check', held: false } } }), 'waiting for you');
  assert.equal(word({ slice: { stop: { reason: 'check', held: true, after: 9 } } }), 'after run 9');
  const waits = { pipelineId: null, ticketId: 't1', kind: 'sched', run: { ticket: { status: 'scheduled', after: { index: 4 } } } };
  assert.equal(word({ ...waits, slice: { waitsFor: 8 } }), 'waits for run 8');
  assert.equal(word({ ...waits }), 'waits for run 4', 'no slice: the chain predecessor');
  assert.match(word({}), /^Needs you/, 'no slice and no snapshot: dev\'s line');
});

// ── Shaper small runs s5 (R-arch-1, R-ux-6): a small-runs member row takes word and mark from the shared run status ──
const S5_STOP = { reason: 'check', held: false };
/** A feature member at position `n` with its slice payload; a started run is a saved row, else a scheduled ticket. */
function s5Member(n, slice, over = {}) {
  const started = !['planned', 'held'].includes(slice.state);
  const base = started
    ? { pipelineId: `sr${n}`, ticketId: null, kind: 'hist', run: { status: slice.state === 'done' ? 'done' : slice.state === 'error' ? 'error' : 'running' } }
    : { pipelineId: null, ticketId: `t${n}`, kind: 'sched', run: { ticket: { status: 'scheduled' } } };
  return { position: n, title: `Slice ${n}`, ...base, slice: { kind: null, waitsFor: [], buildsOn: [], ...slice }, ...over };
}
const s5Ask = (stop) => ({ status: 'running', pendingQuestion: { id: 'q', kind: 'gate', stop } });
const S5_CARE_SNAP = { status: 'running', stepper: { careRun: { planReviewers: [] } }, active: [{ nodeId: 'n_impl' }] };
const S5_STAGED = { status: 'running', steps: [{ nodeId: 'n' }], active: ['n'], stepper: { auto: { status: 'deciding' } } };   // #1012: stages, at Plan
/** Position → member row (.runs-item) of the open feature group. */
const s5Items = (host) => new Map([...host.querySelectorAll('.runs-members > .runs-item[data-level="member"]')]
  .map((it) => [Number.parseInt(it.querySelector(':scope > a.runs-row > .runs-row-title').textContent, 10), it]));
const s5Sub = (it) => it.querySelector(':scope > a.runs-row > .runs-row-sub').textContent;
const s5Dot = (it) => it.querySelector(':scope > .runs-pick > .status-dot');
const s5Draw = (members, over = {}) => s5Items(smallHost(smallFeature({ members, ...over }), true));

const s5Words = () => [
  s5Member(1, { state: 'done' }),
  s5Member(2, { state: 'approval', stop: S5_STOP, buildsOn: [1] }, { run: s5Ask(S5_STOP) }),
  s5Member(3, { state: 'running', buildsOn: [1] }, { snap: S5_CARE_SNAP }),
  s5Member(4, { state: 'held', stop: { reason: 'check', held: true, after: 3 }, buildsOn: [1, 3] },
    { pipelineId: 'sr4', ticketId: null, kind: 'hist', run: s5Ask({ reason: 'check' }) }),
  s5Member(5, { state: 'error', buildsOn: [3, 4] }),
  s5Member(7, { state: 'planned', waitsFor: [2, 3, 4, 5], buildsOn: [1, 2, 3, 4, 5] }),
  s5Member(9, { state: 'planned', nextTurn: true }),
  s5Member(10, { state: 'planned', waitsFor: [3], buildsOn: [3] }),
  s5Member(12, { state: 'planned', waitsFor: [7, 10], buildsOn: [1, 7, 10] }),
  s5Member(13, { state: 'planned' }),
];

test('s5 sidebar: members with slices read runStatus\'s word and mark', () => {
  const items = s5Draw(s5Words());
  const rows = [
    [1, 'done', 'done', 'is-green', null],
    [2, 'waiting for you', 'ask', 'is-amber', 'question'],
    [3, 'building', 'live', 'is-pulse', null],
    [4, 'after run 3', 'after', 'is-dashed-ring', null],
    [5, 'failed', 'failed', 'is-red', 'alert'],
    [7, 'waits for run 2 (needs you), 5 (failed)', 'faint', 'is-grey-ring', null],
    [9, 'next', 'ring', 'is-ink-ring', null],
    [10, 'waits for run 3', 'faint', 'is-grey-ring', null],
    [12, 'waits for run 7, 10', 'faint', 'is-grey-ring', null],
    [13, '', 'ring', 'is-grey-ring', null],
  ];
  for (const [n, word, mark, cls, symbol] of rows) {
    const it = items.get(n);
    assert.equal(s5Sub(it), word, `run ${n} word`);
    assert.equal(it.dataset.mark, mark, `run ${n} data-mark`);
    assert.ok(s5Dot(it).classList.contains(cls), `run ${n} dot ${s5Dot(it).className}`);
    assert.equal(s5Dot(it).dataset.symbol ?? null, symbol, `run ${n} symbol`);
  }
});

test('s5 sidebar: data-state-word and data-line stay dev\'s model values (D4); a member without a slice keeps dev\'s row', () => {
  const members = [...s5Words(), { position: 14, title: 'Slice 14', pipelineId: null, ticketId: 't14', kind: 'sched', run: { ticket: { status: 'scheduled', after: { index: 13 } } } }];
  const items = s5Draw(members);
  const dev = s5Draw(members.map(({ slice, ...m }) => m));
  assert.equal(items.get(5).dataset.mark, 'failed', 'the shared status is on');
  for (const [n, it] of items) {
    assert.equal(it.dataset.stateWord, dev.get(n).dataset.stateWord, `run ${n} state word`);
    assert.equal(it.querySelector(':scope > a.runs-row').dataset.line, dev.get(n).querySelector(':scope > a.runs-row').dataset.line, `run ${n} line`);
  }
  assert.equal(items.get(14).dataset.mark, undefined);
  assert.equal(items.get(14).outerHTML, dev.get(14).outerHTML);
});

test('s5 sidebar (R-ux-6): the strips are as before, with run 12 reading "waits for run 7, 10"', () => {
  const members = (state, pendingQuestion = null) => [
    s5Member(1, { state: 'done' }),
    s5Member(3, { state, buildsOn: [1] }, { kind: 'live', run: { ...S5_STAGED, ...(pendingQuestion ? { pendingQuestion } : {}) },
      snap: { ...S5_CARE_SNAP, pendingQuestion } }),
    s5Member(7, { state: 'planned', waitsFor: [3], buildsOn: [3] }),
    s5Member(10, { state: 'planned', waitsFor: [3], buildsOn: [3] }),
    s5Member(12, { state: 'planned', waitsFor: [7, 10], buildsOn: [1, 7, 10] }),
  ];
  const cases = [
    ['a building run', members('running'), 'building', 'live', 'is-pulse'],
    ['a run waiting for an answer', members('questions', { id: 'q', questions: [{ id: 'q1', question: 'Which?' }] }), 'waiting for you', 'ask', 'is-amber'],
  ];
  for (const [name, list, word, mark, cls] of cases) {
    const items = s5Draw(list);
    const before = s5Draw(list.map(({ slice, ...m }) => m));
    const stage = (m) => m.get(3).querySelector(':scope > a.runs-row > .runs-stage');
    assert.ok(stage(before), `${name}: dev draws the strips`);
    assert.equal(stage(items).outerHTML, stage(before).outerHTML, `${name}: the same strips`);
    assert.deepEqual([...stage(items).querySelectorAll('.run-prog-mark')].map((x) => x.textContent), ['Plan', 'Build', 'Review', 'Ready'], name);
    assert.equal(stage(items).dataset.mode, 'stages', name);
    assert.equal(items.get(3).querySelectorAll('.runs-stage').length, 1, name);
    assert.equal(s5Sub(items.get(3)), word, name);
    assert.equal(items.get(3).dataset.mark, mark, name);
    assert.ok(s5Dot(items.get(3)).classList.contains(cls), `${name}: ${s5Dot(items.get(3)).className}`);
    assert.equal(s5Sub(items.get(12)), 'waits for run 7, 10', name);
  }
});

test('s5 sidebar flag off: a marked group whose members carry no slice keeps today\'s lines and no data-mark; an unmarked group ignores slices', () => {
  const members = [
    { position: 1, title: 'Slice 1', pipelineId: 'sr1', kind: 'hist', run: { status: 'done' } },
    { position: 2, title: 'Slice 2', pipelineId: null, ticketId: 't2', kind: 'sched', run: { ticket: { status: 'scheduled', after: { index: 1 } } } },
  ];
  // Flag off the server marks no group and sends no slice (listRunGroups).
  const { smallRuns, ...off } = smallFeature({ members });
  assert.equal(smallRuns, true);
  const host = smallHost(off, true);
  const rows = s5Items(host);
  assert.match(s5Sub(rows.get(1)), /^Ready to ship/);
  assert.equal(s5Sub(rows.get(2)), 'Waiting · starts after run 1');
  assert.equal(host.querySelector('.runs-item[data-mark]'), null);
  // A marked group whose members carry no slice: the short words of today, no data-mark.
  const marked = smallHost(smallFeature({ members }), true);
  assert.deepEqual([...s5Items(marked).values()].map(s5Sub), ['done', 'waits for run 1']);
  assert.equal(marked.querySelector('.runs-item[data-mark]'), null);
  // D3: an unmarked group stays dev's even if a member carries a slice.
  const sliced = smallHost({ ...off, members: members.map((m) => ({ ...m, slice: { state: m.position === 1 ? 'done' : 'planned', nextTurn: m.position === 2 } })) }, true);
  assert.deepEqual([...s5Items(sliced).values()].map(s5Sub), [...rows.values()].map(s5Sub));
  assert.equal(sliced.querySelector('.runs-item[data-mark]'), null);
});

test('s5 sidebar: a null word falls back to memberShortWord, then dev\'s line; the dot still carries the mark', () => {
  const list = [
    s5Member(1, { state: 'running' }, { kind: 'live', run: S5_STAGED }),
    s5Member(2, { state: 'planned', cannotStart: { run: 3, reason: 'was canceled' }, waitsFor: [8] }),
  ];
  const items = s5Draw(list);
  const dev = s5Draw(list.map(({ slice, ...m }) => m));
  assert.equal(s5Sub(items.get(1)), s5Sub(dev.get(1)), 'a live run with no snapshot keeps today\'s staged line');
  assert.equal(items.get(1).querySelector('.runs-stage').outerHTML, dev.get(1).querySelector('.runs-stage').outerHTML);
  assert.equal(items.get(1).dataset.mark, 'live');
  // Slice 16 (H5): a run that cannot start now has its own word, the reduced list plus the run that can never finish.
  assert.equal(s5Sub(items.get(2)), 'cannot start · waits for run 3 (was canceled), 8', 'a run that cannot start names its cause');
  assert.equal(items.get(2).dataset.mark, 'faint');
  assert.ok(s5Dot(items.get(2)).classList.contains('is-grey-ring'));
});

test('s5 sidebar words (D7): the ask word reads --amber-ink-strong and the failed word --red-ink-strong (slice 16, H4); no other word is coloured', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../ui/public/shape/shape-it.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (mark) => css.split('}').find((r) => r.includes('.srows.runs-members') && r.includes(`[data-mark="${mark}"]`) && r.includes('.runs-row-sub')) || '';
  assert.match(rule('ask'), /color:\s*var\(--amber-ink-strong\)/);
  assert.match(rule('failed'), /color:\s*var\(--red-ink-strong\)/);
  assert.doesNotMatch(css, /\.runs-members[^{}]*\[data-mark="(?:after|ring|faint|done|live)"\][^{}]*\.runs-row-sub[^{}]*\{[^}]*color/);
});

// ── Feature page slice 6 (R-arch-2): one source for the group total and the Cost tab ─────────────────────────────
test('groupCostParts: max(stored, live) per pipeline, live-only ids included; its sum is groupCostUsd', () => {
  const g = { cost: { usd: 2, byPipeline: { p1: 1.5, p2: 0.5 }, checks: { p2: { round: 1, at: at(30, 11, 0), status: 'done' } } } };
  for (const [live, parts] of [
    [{ p2: 0.9 }, { p1: 1.5, p2: 0.9 }],
    [{ p2: 0 }, { p1: 1.5, p2: 0.5 }],
    [{ p3: 0.3 }, { p1: 1.5, p2: 0.5, p3: 0.3 }],
  ]) {
    assert.deepEqual(RL.groupCostParts(g, live), parts, JSON.stringify(live));
    assert.equal(Math.round(Object.values(parts).reduce((a, b) => a + b, 0) * 100) / 100, groupCostUsd(g, live));
  }
  assert.deepEqual(RL.groupCostParts(g), { p1: 1.5, p2: 0.5 }, 'no live costs');
  assert.equal(groupCostUsd({ members: [{ cost: 1 }, { cost: 0.5 }] }), 1.5, 'a plain chain still sums its members');
});

// ── Slice 7 (D3): a confirmation that is still open reads needs-you and sits in Needs you ───────────────────────
test('s7: a confirmation hold sits in Needs you with the amber dot; an unowned hold stays a grey ring outside it', () => {
  const hold = 'Needs your confirmation: R-ux-2';
  const unowned = 'R-ops-1 is owned by no run and confirmed by no person';
  const members = TEN.slice(0, 2).map((id, i) => ({ position: i + 1, title: `Slice ${i + 1}`, pipelineId: id, kind: 'hist', run: { status: 'done' } }));
  const history = TEN.slice(0, 2).map((id) => histIt(id, { run: { status: 'done' }, pr: null }));
  const of = (h) => {
    const g = smallFeature({ members, hold: h });
    const model = buildRunsModel({ history, groups: [g], now: NOW });
    const needs = model.sections.find((s) => s.id === 'needs');
    const host = doc.createElement('div');
    host.append(...renderRunsList(doc, model));
    return { row: groupRow(g, { now: NOW }), needs, line: host.querySelector('.runs-item[data-row-key="chain:feat_small"] > a.runs-row')?.textContent };
  };
  const held = of(hold);
  assert.deepEqual([held.row.model.state, held.row.model.dot, held.row.model.symbol, held.row.model.word], ['ready', 'amber', null, 'Needs you']);
  assert.deepEqual(held.row.model.actions, [], 'no Answer action: no run asks');
  assert.equal(held.row.needs, true);
  assert.equal(held.row.needsIcon, '');
  assert.ok(held.needs, 'a Needs you section');
  assert.deepEqual(held.needs.rows.map((r) => r.groupId), ['feat_small']);
  assert.equal(held.needs.count, 1);
  assert.ok(held.line.includes(hold), held.line);
  assert.doesNotMatch(held.line, /Ready to ship/);
  // Owner direction (replaces D3's "badge unchanged"): the top bar's Runs badge counts the held feature too.
  assert.equal(countNeedsYou({ history, groups: [smallFeature({ members, hold })] }), 1, 'the held feature counts in the Runs badge');
  assert.equal(countNeedsYou({ history }), 0, 'no groups passed: runs only');
  const other = of(unowned);
  assert.deepEqual([other.row.model.dot, other.row.needs], ['grey-ring', false]);
  assert.equal(other.needs?.rows.length || 0, 0, 'an unowned hold is not in Needs you');
  assert.equal(countNeedsYou({ history, groups: [smallFeature({ members, hold: unowned })] }), 0, 'an unowned hold is not counted');
});

test('a confirmation hold on a feature with a stopped run is not counted: the badge follows the list, which keeps it under Waiting', () => {
  const hold = 'Needs your confirmation: R-ux-2';
  const members = TEN.slice(0, 2).map((id, i) => ({ position: i + 1, title: `Slice ${i + 1}`, pipelineId: id, kind: 'hist', run: { status: i ? 'stopped' : 'done' } }));
  const history = TEN.slice(0, 2).map((id, i) => histIt(id, { run: { status: i ? 'stopped' : 'done' }, pr: null }));
  const g = smallFeature({ members, hold });
  const row = groupRow(g, { now: NOW });
  assert.equal(row.model.hold, undefined, 'the group model keeps no hold while a run is stopped');
  const inList = buildRunsModel({ history, groups: [g], now: NOW }).sections.find((x) => x.id === 'needs')?.count || 0;
  assert.equal(countNeedsYou({ history, groups: [g] }), inList, 'the badge equals the Needs you section');
});

test('s7 owner direction: the Runs badge counts a feature held for your confirmation only with the flag on', () => {
  const hold = 'Needs your confirmation: R-ux-2';
  const members = TEN.slice(0, 2).map((id, i) => ({ position: i + 1, title: `Slice ${i + 1}`, pipelineId: id, kind: 'hist', run: { status: 'done' } }));
  const history = TEN.slice(0, 2).map((id) => histIt(id, { run: { status: 'done' } }));
  const on = [smallFeature({ members, hold })];
  assert.equal(countNeedsYou({ history, groups: on }), 1);
  // Flag off, the server sends a marked feature with no marker and no hold (run-groups.mjs): nothing is counted, and the
  // list keeps it out of Needs you.
  const { smallRuns, ...plain } = smallFeature({ members });
  assert.equal(countNeedsYou({ history, groups: [plain] }), 0, 'flag off: unchanged');
  const model = buildRunsModel({ history, groups: [plain], now: NOW });
  assert.equal(model.sections.find((s) => s.id === 'needs')?.rows.length || 0, 0);
  // A stale hold on an unmarked group is never counted.
  assert.equal(countNeedsYou({ history, groups: [{ ...plain, hold }] }), 0, 'unmarked: not counted');
  // app.js passes the groups only while the flag is on.
  const app = readFileSync(new URL('../ui/public/app.js', import.meta.url), 'utf8');
  assert.match(app, /groups: flagOn\('shaperSmallRuns'\) \? state\.runGroups \|\| \[\] : \[\]/);
});

// ── Slice 9 (owner direction): a feature waiting only for a Verifier note's Acknowledge needs you, as a confirmation does ──
test("s9 owner direction: a Verifier notes hold sits in Needs you and counts in the Runs badge, only with the flag on", () => {
  const members = TEN.slice(0, 2).map((id, i) => ({ position: i + 1, title: `Slice ${i + 1}`, pipelineId: id, kind: 'hist', run: { status: 'done' } }));
  const history = TEN.slice(0, 2).map((id) => histIt(id, { run: { status: 'done' }, pr: null }));
  for (const hold of ["Acknowledge the Verifier's note to ship", "Acknowledge the Verifier's notes to ship"]) {
    const g = smallFeature({ members, hold });
    const row = groupRow(g, { now: NOW });
    assert.deepEqual([row.model.state, row.model.dot, row.model.symbol, row.model.word], ['ready', 'amber', null, 'Needs you'], hold);
    assert.deepEqual([row.needs, row.needsIcon], [true, ''], hold);
    const needs = buildRunsModel({ history, groups: [g], now: NOW }).sections.find((s) => s.id === 'needs');
    assert.deepEqual(needs?.rows.map((r) => r.groupId), ['feat_small'], hold);
    assert.equal(countNeedsYou({ history, groups: [g] }), 1, hold);
  }
  // Flag off, the server sends no marker and no hold (run-groups.mjs): unchanged, not counted, not in Needs you.
  const { smallRuns, ...plain } = smallFeature({ members });
  assert.equal(countNeedsYou({ history, groups: [plain] }), 0, 'flag off: unchanged');
  assert.equal(buildRunsModel({ history, groups: [plain], now: NOW }).sections.find((s) => s.id === 'needs')?.rows.length || 0, 0);
  assert.equal(countNeedsYou({ history, groups: [{ ...plain, hold: "Acknowledge the Verifier's note to ship" }] }), 0, 'unmarked: not counted');
});

// ── Slice 11 (R-ux-4): a Verifier round holds the group row, and shows as a check row after the runs ─────────────────
const V_DONE = { status: 'done' };
const verified = (checks, extra = {}) => groupModel({ kind: 'feature', title: 'F', members: [V_DONE, V_DONE], ...(checks ? { checks } : {}), ...extra }, { now: NOW });
const round = (state, gaps = null, n = 2) => ({ round: n, state, gaps });
const CONFIRM_HOLD = 'Needs your confirmation: R-ux-2';

test("s11 groupModel: a failed newest round is the group row's state and line, with no action and no hold", () => {
  const m = verified([round('failed', 1)], { hold: CONFIRM_HOLD });
  assert.deepEqual([m.state, m.line, m.word, m.dot, m.symbol], ['failed', 'Verifier round 2 failed · 1 gap', 'Failed', 'red', 'alert']);
  assert.deepEqual(m.actions, [], 'the row\'s ids point at a member run');
  assert.equal('hold' in m, false);
  assert.deepEqual(m.check, { round: 2, state: 'failed', gaps: 1 });
  assert.deepEqual(m.count, { done: 2, total: 2, text: '2/2' }, 'a round is never counted');
  assert.equal(m.members.length, 2);
});

test('s11 groupModel: only the newest round counts; a passed or answered one leaves the members to decide', () => {
  for (const [state, gaps, want, line] of [
    ['verifying', null, 'working', 'Verifier round 2 checking'], ['paused', null, 'paused', 'Verifier round 2 paused'],
    ['asking', 1, 'needs-you', 'Verifier round 2 needs you · 1 gap'], ['stopped', null, 'stopped', 'Verifier round 2 stopped']]) {
    const m = verified([round('passed', 0, 1), round(state, gaps)]);
    assert.deepEqual([m.state, m.line, m.actions], [want, line, []], state);
  }
  for (const state of ['passed', 'gaps']) {
    const m = verified([round('failed', 1, 1), round(state, 0)]);
    assert.deepEqual([m.state, m.line, 'check' in m], ['ready', 'Ready to ship · 2 of 2 done', false], state);
  }
});

test('s11 groupModel: a failing or live member and a PR outrank the round; without checks the result is dev\'s', () => {
  const failing = verified([round('verifying')], { members: [V_DONE, { status: 'error' }] });
  assert.deepEqual([failing.state, failing.line, 'check' in failing], ['failed', 'Run 2 of 2 · failed', false]);
  const going = verified([round('failed', 1)], { members: [V_DONE, { status: 'running' }] });
  assert.deepEqual([going.state, going.line, 'check' in going], ['starting', 'Run 2 of 2 · starting', false]);
  const shipped = verified([round('failed', 1)], { pr: { url: 'https://github.com/o/r/pull/1', number: 1, state: 'MERGED' } });
  assert.deepEqual([shipped.state, 'check' in shipped], ['merged', false]);
  // The Verifier changes the row only when the members alone read ready: here it does, so the next assert is real.
  assert.equal(verified([round('failed', 1)]).state, 'failed');
  for (const hold of [undefined, CONFIRM_HOLD]) {
    assert.deepEqual(verified([], { hold }), verified(null, { hold }), `hold ${hold}`);
  }
});

const V_CHECK = (extra = {}) => ({ kind: 'check', round: 2, state: 'gaps', gaps: 1, pipelineId: 'v1', runId: '', href: '#history/k/v1', cost: 1, ...extra });
const checkedFeature = (checks, extra = {}) => smallFeature({ cost: { usd: 3, byPipeline: { sr1: 1, sr2: 1, v1: 1 } },
  members: ['sr1', 'sr2'].map((id, i) => ({ position: i + 1, title: `Slice ${i + 1}`, pipelineId: id, kind: 'hist', href: `#history/k/${id}`, run: { status: 'done' } })),
  checks, ...extra });
const checkedModel = (g) => buildRunsModel({ history: ['sr1', 'sr2', 'v1'].map((id) => histIt(id, { run: { status: 'done' }, pr: null })),
  groups: [g], toggled: new Map([[`chain:${g.id}`, true]]), now: NOW });
const checkedHost = (g) => { const host = doc.createElement('div'); host.append(...renderRunsList(doc, checkedModel(g))); return host; };
const checkItem = (c) => {
  const items = checkedHost(checkedFeature([V_CHECK(c)])).querySelectorAll('.runs-item[data-row-key="chain:feat_small"] > .runs-members > .runs-item[data-level="check"]');
  assert.equal(items.length, 1, 'one check row');
  const it = items[0];
  return { it, a: it.querySelector(':scope > a.runs-row'), dot: it.querySelector(':scope > .runs-pick > .status-dot'),
    sub: () => it.querySelector(':scope > a.runs-row > .runs-row-sub').textContent };
};

test('s11 check row: after the runs, with the shield in the pick column, no checkbox, no ⋯, its words and its cost hover', () => {
  const c = checkItem({});
  assert.ok(c.it.classList.contains('runs-item') && c.it.classList.contains('is-check'));
  assert.equal(c.it.dataset.rowKey, 'check:feat_small/v1');
  assert.equal(c.it.previousElementSibling.dataset.level, 'member', 'after the runs');
  assert.equal(c.it.nextElementSibling, null);
  assert.equal(c.it.querySelector('.runs-check'), null);
  assert.equal(c.it.querySelector('.runs-more'), null);
  const shield = icon(doc, 'shield').querySelector('svg').innerHTML;
  const drawn = [...c.it.querySelectorAll(':scope > .runs-pick > .ic')].find((x) => x.querySelector('svg')?.innerHTML === shield);
  assert.ok(drawn, 'the shield icon');
  assert.equal(drawn.getAttribute('aria-hidden'), 'true');
  assert.ok(c.a.classList.contains('runs-row-check'));
  assert.equal(c.a.getAttribute('href'), '#history/k/v1');
  assert.equal(c.a.dataset.line, 'Verifier · round 2 · 1 gap');
  assert.equal(c.a.getAttribute('title'), 'Cost $1.00');
  assert.equal(c.a.querySelector('.runs-row-title').textContent, 'Verifier · round 2');
  assert.equal(c.sub(), '1 gap');
  assert.doesNotMatch(c.it.textContent, /Ready to ship/);
});

test('s11 check row: its dot and mark per state, named once for a screen reader', () => {
  const gaps = checkItem({});
  assert.ok(gaps.dot.classList.contains('is-red'));
  assert.equal(gaps.it.dataset.mark, 'failed');
  assert.equal(gaps.dot.getAttribute('aria-label'), 'Gaps found');
  const failed = checkItem({ state: 'failed', gaps: null });
  assert.equal(failed.sub(), 'failed');
  assert.equal(failed.it.dataset.mark, 'failed');
  assert.equal(failed.dot.getAttribute('aria-hidden'), 'true', 'the word already says failed');
  assert.equal(failed.dot.hasAttribute('aria-label'), false);
  const asking = checkItem({ state: 'asking', gaps: 1, runId: 'rv', href: '#running/rv' });
  assert.equal(asking.it.dataset.mark, 'ask');
  assert.ok(asking.dot.classList.contains('is-amber'));
  assert.equal(asking.dot.getAttribute('aria-label'), 'Needs you');
  assert.equal(asking.a.dataset.state, 'needs-you');
  assert.equal(asking.a.dataset.runId, 'rv');
  for (const [state, cls, word] of [['paused', 'is-grey', 'paused'], ['stopped', 'is-dark-grey', 'stopped']]) {
    const c = checkItem({ state, gaps: null });
    assert.equal(c.sub(), word);
    assert.equal(c.it.hasAttribute('data-mark'), false, state);
    assert.ok(c.dot.classList.contains(cls), state);
    assert.equal(c.dot.getAttribute('aria-hidden'), 'true', state);
  }
  const live = checkItem({ state: 'verifying', gaps: null });
  assert.deepEqual([live.sub(), live.it.dataset.mark, live.dot.classList.contains('is-peach')], ['checking', 'live', true]);
  const passed = checkItem({ state: 'passed', gaps: 0 });
  assert.deepEqual([passed.sub(), passed.it.dataset.mark, passed.dot.classList.contains('is-green')], ['passed', 'done', true]);
});

test('s11 group row: the round\'s rows fold into the group, and a failed or asking round sits in Needs you with its icon', () => {
  for (const [state, needs, needsIcon] of [['failed', true, 'fail'], ['asking', true, 'ask'], ['verifying', false, ''], ['paused', false, '']]) {
    const g = checkedFeature([V_CHECK({ state, runId: 'rv' })]);
    const row = groupRow(g, { now: NOW });
    assert.deepEqual([row.needs, row.needsIcon], [needs, needsIcon], state);
    assert.ok(row.memberKeys.has('p:v1') && row.memberKeys.has('r:rv'), state);
    assert.deepEqual(row.checks?.map((c) => c.key), ['check:feat_small/v1'], state);
    assert.equal(row.members.length, 2, state);
    const model = checkedModel(g);
    assert.deepEqual(rowsOf(model).map((r) => r.key), ['chain:feat_small'], `${state}: the round's History row folds into the group`);
    assert.equal(!!model.sections.find((s) => s.id === 'needs')?.rows.length, needs, `${state}: Needs you`);
  }
});

test('s11 badge: countNeedsYou agrees with Needs you when a Verifier round holds the group', () => {
  const history = ['sr1', 'sr2', 'v1'].map((id) => histIt(id, { run: { status: 'done' }, pr: null }));
  const section = (g, live = []) => buildRunsModel({ live, history, groups: [g], now: NOW }).sections.find((s) => s.id === 'needs')?.count || 0;
  // A failed round: the group sits in Needs you, and the badge counts it.
  const failed = checkedFeature([V_CHECK({ state: 'failed' })]);
  assert.deepEqual([countNeedsYou({ history, groups: [failed] }), section(failed)], [1, 1], 'failed');
  // An asking round whose live run is already counted (it asks): one, not two; the row folds into the group.
  const asking = checkedFeature([V_CHECK({ state: 'asking', runId: 'rv' })]);
  const liveAsk = [liveIt('rv', { pipelineId: 'v1', ask: true })];
  const liveIn = [{ runId: 'rv', pipelineId: 'v1', status: 'running', ask: true }];
  assert.equal(countNeedsYou({ live: liveIn, history, groups: [asking] }), 1, 'asking, live run counted once');
  assert.equal(section(asking, liveAsk), 1, 'asking: one Needs you row');
  assert.equal(countNeedsYou({ history, groups: [asking] }), 1, 'asking, no live run listed: the group counts');
  // A checking round over a confirmation hold: the round holds the row, so neither the list nor the badge counts it.
  for (const state of ['verifying', 'paused', 'stopped']) {
    const g = checkedFeature([V_CHECK({ state })], { hold: CONFIRM_HOLD });
    assert.deepEqual([countNeedsYou({ history, groups: [g] }), section(g)], [0, 0], state);
  }
  // A passed round leaves the hold to decide, as before.
  const passed = checkedFeature([V_CHECK({ state: 'passed', gaps: 0 })], { hold: CONFIRM_HOLD });
  assert.deepEqual([countNeedsYou({ history, groups: [passed] }), section(passed)], [1, 1], 'passed + hold');
});

test('s11 badge: a server-shaped group (GET /api/run-groups: members with a top-level status, no run) counts the same', () => {
  // app.js runsNeedsInput passes state.runGroups as the server sent them; the badge must read their members' status.
  const server = (state, extra = {}) => ({ id: 'feat_small', kind: 'feature', groupKind: 'feature', title: 'Ten runs', smallRuns: true,
    members: ['sr1', 'sr2'].map((id) => ({ pipelineId: id, title: id, status: 'done' })),
    checks: [{ round: 2, state, gaps: 1, pipelineId: 'v1' }], ...extra });
  assert.equal(countNeedsYou({ groups: [server('failed')] }), 1, 'failed');
  assert.equal(countNeedsYou({ groups: [server('verifying', { hold: CONFIRM_HOLD })] }), 0, 'verifying + confirmation');
  assert.equal(countNeedsYou({ groups: [server('passed', { hold: CONFIRM_HOLD })] }), 1, 'passed + confirmation');
});

test('s11 group row: in Needs you its line is the Verifier line, not needsWhy\'s or the section\'s short form', () => {
  const alone = checkedFeature([V_CHECK({ state: 'failed' })]);
  assert.equal(listLine(groupRow(alone, { now: NOW }), { section: 'needs' }), 'Verifier round 2 failed · 1 gap');
  // The round's own failed History row folds into the group and puts it in Needs you: the Verifier's line still comes
  // first, before the section's short form. (A member that needs you through its PR is the group's current member, D7:
  // it names itself and the round does not hold the row.)
  const g = checkedFeature([V_CHECK({ state: 'failed' })]);
  const model = buildRunsModel({ history: [...['sr1', 'sr2'].map((id) => histIt(id, { run: { status: 'done' }, pr: null })),
    histIt('v1', { status: 'error', run: { status: 'error' }, pr: null })], groups: [g], toggled: new Map([['chain:feat_small', true]]), now: NOW });
  const row = model.sections.find((s) => s.id === 'needs')?.rows.find((r) => r.key === 'chain:feat_small');
  assert.ok(row, 'the group sits in Needs you');
  assert.equal(listLine(row, { section: 'needs' }), 'Verifier round 2 failed · 1 gap');
  const host = doc.createElement('div');
  host.append(...renderRunsList(doc, model));
  const sub = host.querySelector('.runs-item[data-row-key="chain:feat_small"] > a.runs-row > .runs-row-sub').textContent;
  assert.match(sub, /^Verifier round 2 failed · 1 gap · \d\d:\d\d$/, 'the line, then the time (listLine: and(line, time))');
});

test('s11 css: the check row\'s ground is --field, with the shield in --ink-3', () => {
  const css = readFileSync(new URL('../ui/public/shape/shape-it.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = css.match(/[^{}]*\.is-check[^{}]*\{[^}]*\}/g) || [];
  assert.ok(rules.some((r) => /\.srows\.runs-members[^{]*\.runs-item\.is-check/.test(r) && r.includes('var(--field)')), rules.join('\n'));
  assert.ok(rules.some((r) => r.includes('var(--ink-3)')), rules.join('\n'));
});

// ── Slice 18 (D10, D11): a failed round or an open confirmation outranks In review on the Runs row and the badge ─────
const S18_IDS = ['sr1', 'sr2', 'sr3'];
/** A marked feature whose 3 done runs are all in one open pull request. */
const inReview = (extra = {}) => smallFeature({ cost: { usd: 3, byPipeline: { sr1: 1, sr2: 1, sr3: 1, v1: 0.5 } },
  members: S18_IDS.map((id, i) => ({ position: i + 1, title: `Slice ${i + 1}`, pipelineId: id, kind: 'hist', run: { status: 'done', pr: REVIEW(9) } })),
  ...extra });
const s18History = S18_IDS.map((id) => histIt(id, { run: { status: 'done' }, pr: null }));
/** The group's row, its Needs you membership, its drawn status line, and what the Runs badge counts. */
const s18Draw = (g) => {
  const model = buildRunsModel({ history: s18History, groups: [g], now: NOW });
  const host = doc.createElement('div');
  host.append(...renderRunsList(doc, model));
  return { row: groupRow(g, { now: NOW }), needs: model.sections.find((s) => s.id === 'needs')?.rows.map((r) => r.groupId) || [],
    sub: host.querySelector(`.runs-item[data-row-key="chain:${g.id}"] > a.runs-row > .runs-row-sub`)?.textContent || '',
    badge: countNeedsYou({ history: s18History, groups: [g] }) };
};

test('s18: an In review feature with an open confirmation sits in Needs you and its line starts with the confirmation', () => {
  for (const [name, extra] of [['a PR per run', {}], ['the group\'s One PR', { pr: REVIEW(9) }]]) {
    const d = s18Draw(inReview({ hold: CONFIRM_HOLD, ...extra }));
    assert.equal(d.row.model.state, 'in-review', name);
    assert.deepEqual(d.needs, ['feat_small'], name);
    assert.ok(d.sub.startsWith(CONFIRM_HOLD), `${name}: ${d.sub}`);
    assert.equal(d.badge, 1, `${name}: counted once, as its row`);
  }
});

test('s18: an In review feature with a failed newest round sits in Needs you, its line starts with the round, and the badge counts it', () => {
  for (const [name, extra] of [['a PR per run', {}], ['the group\'s One PR', { pr: REVIEW(9) }]]) {
    const d = s18Draw(inReview({ checks: [V_CHECK({ state: 'failed' })], ...extra }));
    assert.ok(d.sub.startsWith('Verifier round 2 failed'), `${name}: ${d.sub}`);
    assert.equal(d.row.model.state, 'failed', name);
    assert.deepEqual(d.needs, ['feat_small'], name);
    assert.equal(d.badge, 1, `${name}: counted once, as its row`);
  }
  const two = [inReview({ checks: [V_CHECK({ state: 'failed' })] }), inReview({ id: 'feat_held', hold: CONFIRM_HOLD, cost: undefined,
    members: ['h1', 'h2'].map((id, i) => ({ position: i + 1, title: id, pipelineId: id, kind: 'hist', run: { status: 'done', pr: REVIEW(12) } })) })];
  // The second feature's runs are listed too: a group stands where its first listed member sits.
  const history = [...s18History, ...['h1', 'h2'].map((id) => histIt(id, { run: { status: 'done' }, pr: null }))];
  const needs = buildRunsModel({ history, groups: two, now: NOW }).sections.find((s) => s.id === 'needs');
  assert.deepEqual([needs?.count, countNeedsYou({ history, groups: two })], [2, 2]);
});

// The control: a notes hold on an In review feature. The row reads In review outside Needs you, and the badge agrees.
test('s18 control: an In review feature with only a notes hold keeps its row; the badge follows the list', () => {
  const d = s18Draw(inReview({ hold: "Acknowledge the Verifier's note to ship" }));
  assert.deepEqual([d.row.model.state, d.row.model.line, d.row.needs], ['in-review', 'In review · 1 PR', false]);
  assert.deepEqual(d.needs, []);
  assert.ok(d.sub.startsWith('In review · 1 PR'), d.sub);
  assert.equal(d.badge, 0);
});
