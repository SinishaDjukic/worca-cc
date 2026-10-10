// test/ui-runs-list-model.test.mjs — the Runs list model (ui/public/runs-list.mjs): row words
// and icons, times, Needs you, grouping, dedupe, search, the started-by filter, folding, and
// the DOM the list is built from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  rowTime, liveRowState, histRowState, schedRowState, countNeedsYou,
  buildRunsModel, rowSub, rowMatches, isRowSelected, renderRunsList, rowInFilter, dateBucket, RUNS_FILTERS, DATE_BUCKETS,
} from '../ui/public/runs-list.mjs';

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
const keysOf = (m) => m.groups.flatMap((g) => g.rows.map((r) => r.key));

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
  assert.equal(liveRowState({ status: 'paused', pauseReason: 'cost_pipeline' }).word, 'Cost limit');
  assert.equal(liveRowState({ status: 'paused', pauseReason: 'usage_limit', limitEngine: 'codex' }).word, 'Codex usage limit', 'a usage limit names its engine');
  assert.equal(histRowState({ status: 'paused', pauseReason: 'usage_limit', limitEngine: 'claude' }).word, 'Claude usage limit');
  assert.equal(liveRowState({ status: 'paused', pauseReason: 'usage_limit' }).word, 'Usage limit', 'a limit that was not the engine\'s (OpenRouter) names none');
  assert.equal(liveRowState({ status: 'paused', pauseReason: null }).word, 'Paused');
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
  assert.equal(once.groups[0].rows[0].href, '#schedules/once');
  assert.equal(once.groups[0].rows[0].title, 'Scheduled run', 'a ticket title can be null');
  const series = buildRunsModel({ scheduled: [{ id: 't2', scheduleId: 's1', status: 'scheduled', runAt: at(30, 17, 0), groupKey: 'g', groupName: 'G' }], now: NOW });
  assert.equal(series.groups[0].rows[0].href, '#schedules/repeating');
  // A firing ticket's id IS its run's id (app.js:23648): once the run is live, it shows once.
  const firing = buildRunsModel({
    live: [liveIt('t3')],
    scheduled: [{ id: 't3', status: 'firing', runAt: at(30, 14, 59), groupKey: 'emp-00000001', groupName: 'Employee project' }],
    now: NOW,
  });
  assert.deepEqual(keysOf(firing), ['live:t3'], 'a firing ticket whose run is listed live is not repeated');
});

test('Needs you: questions, pauses and unread failures — each also stays in its project group', () => {
  const m = buildRunsModel({
    live: [
      liveIt('ask1', { ask: { kind: 'workflow', step: 'Plan' }, groupKey: 'roll-00000003', groupName: 'Rollouts' }),
      liveIt('pause1', { status: 'paused', groupKey: 'worca-00000002', groupName: 'worca-cc' }),
      liveIt('fail1', { status: 'error', failedStep: 'Tester', unread: true, groupKey: 'worca-00000002', groupName: 'worca-cc' }),
      liveIt('run1', { step: 'Implement' }),
    ],
    history: [histIt('h1'), histIt('h2', { status: 'error' })],
    now: NOW,
  });
  assert.deepEqual(m.needs.map((r) => r.key), ['live:ask1', 'live:pause1', 'live:fail1']);
  assert.deepEqual(m.needs.map((r) => rowSub(r, { inNeeds: true })),
    ['Plan review · Rollouts', 'Paused · worca-cc', 'Tester failed · worca-cc']);
  assert.deepEqual(m.groups.map((g) => g.name), ['Employee project', 'Rollouts', 'worca-cc']);
  const worca = m.groups.find((g) => g.key === 'worca-00000002');
  assert.deepEqual(worca.rows.map((r) => r.key),
    ['live:pause1', 'live:fail1', 'hist:worca-00000002/h1', 'hist:worca-00000002/h2']);
  assert.equal(worca.count, 4);
  assert.equal(rowSub(m.groups[0].rows[0]), 'Running · Implement');
  assert.equal(rowSub(worca.rows[2]), 'Merged · 11:17');
});

test('a history row whose run is listed live is not shown twice', () => {
  const m = buildRunsModel({
    live: [liveIt('r1', { pipelineId: 'p1', groupKey: 'worca-00000002', groupName: 'worca-cc' })],
    history: [histIt('p1', { status: 'running' }), histIt('p2')],
    now: NOW,
  });
  assert.deepEqual(keysOf(m), ['live:r1', 'hist:worca-00000002/p2']);
});

test('search: status words, project names and run names; every word must match', () => {
  const input = {
    live: [
      liveIt('run1', { title: 'Employee Onboarding Checklist', step: 'Implement' }),
      liveIt('p1', { title: 'Pitch deck', status: 'paused', pauseReason: 'cost_pipeline', groupKey: 'worca-00000002', groupName: 'worca-cc' }),
    ],
    history: [
      histIt('h1', { title: 'Add AI PR Description' }),
      histIt('h2', { title: 'Distribution Set Diff View', pr: 'NONE', checks: 0, files: 2, projectKey: 'roll-00000003', groupName: 'Rollouts' }),
    ],
    now: NOW,
  };
  const keys = (query) => keysOf(buildRunsModel({ ...input, query }));
  assert.deepEqual(keys('merged'), ['hist:worca-00000002/h1']);
  assert.deepEqual(keys('ready to ship'), ['hist:roll-00000003/h2']);
  assert.deepEqual(keys('paused'), ['live:p1'], 'a cost-limit pause is still "paused"');
  assert.deepEqual(keys('ROLLOUTS'), ['hist:roll-00000003/h2']);
  assert.deepEqual(keys('onboarding running'), ['live:run1']);
  assert.deepEqual(keys('merged rollouts'), []);
  assert.equal(buildRunsModel({ ...input, query: 'zzz' }).total, 0);
});

test('the started-by filter keeps only that person’s rows, live and finished', () => {
  const m = buildRunsModel({
    live: [liveIt('mine', { by: 'ana' }), liveIt('theirs', { by: 'bo' })],
    history: [histIt('h1', { by: 'ana' }), histIt('h2', { by: 'bo' })],
    person: 'ana', now: NOW,
  });
  assert.deepEqual(keysOf(m), ['live:mine', 'hist:worca-00000002/h1']);
});

test('a folded group keeps its head and count but no rows; a search unfolds it', () => {
  const input = { history: [histIt('h1'), histIt('h2')], collapsed: new Set(['worca-00000002']), now: NOW };
  const g = buildRunsModel(input).groups[0];
  assert.equal(g.collapsed, true);
  assert.equal(g.count, 2);
  assert.equal(buildRunsModel({ ...input, query: 'h1' }).groups[0].collapsed, false);
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

test('renderRunsList: Needs you on top, foldable heads, rows as links with a title and a subline', () => {
  const { window } = new JSDOM('<!doctype html><div id="h"></div>');
  const doc = window.document;
  const m = buildRunsModel({
    live: [liveIt('ask1', { ask: { kind: 'workflow' } })],
    history: [histIt('h1')],
    collapsed: new Set(['worca-00000002']),
    now: NOW,
  });
  const host = doc.getElementById('h');
  host.append(...renderRunsList(doc, m));
  const needs = host.querySelector('.runs-needs');
  assert.match(needs.querySelector('.runs-needs-head').textContent, /Needs you\s*1/);
  const row = needs.querySelector('a.runs-row');
  assert.equal(row.getAttribute('href'), '#running/ask1');
  assert.equal(row.dataset.runId, 'ask1');
  assert.equal(row.dataset.slot, 'needs');
  assert.equal(row.dataset.icon, 'ask', 'the click handler reads it to land the pane on the question');
  assert.equal(row.querySelector('.runs-row-sub').textContent, 'Workflow review · Employee project');
  assert.ok(row.querySelector('.runs-ic.runs-ic-ask svg'));
  const groupCopy = host.querySelector('.runs-group .runs-row[data-run-id="ask1"]');
  assert.equal(groupCopy.dataset.slot, 'group', 'the repeat in the project group is told apart for focus restore');
  const heads = [...host.querySelectorAll('.runs-group-head')];
  assert.deepEqual(heads.map((h) => h.getAttribute('aria-expanded')), ['true', 'false']);
  assert.equal(host.querySelector('.runs-group[data-group-key="worca-00000002"] .runs-row'), null, 'a folded group renders no rows');
  const empty = renderRunsList(doc, buildRunsModel({ now: NOW }), { emptyText: 'No runs yet.' });
  assert.equal(empty[0].textContent, 'No runs yet.');
});

test('filters: Live keeps what has not ended, Finished what has, Needs you only its group', () => {
  assert.deepEqual(RUNS_FILTERS, ['all', 'live', 'finished', 'needs', 'archived']);
  const live = [liveIt('run'), liveIt('ask', { ask: { kind: 'clarify', step: 'Plan' } }),
    liveIt('ended', { status: 'done', pipelineId: 'p-ended' })];
  const history = [histIt('h-done'), histIt('h-stop', { status: 'stopped' }), histIt('h-int', { status: 'interrupted' })];
  const titles = (filter) => buildRunsModel({ live, history, filter, now: NOW }).groups.flatMap((g) => g.rows.map((r) => r.title)).sort();
  assert.deepEqual(titles('live'), ['ask', 'run']);
  assert.deepEqual(titles('finished'), ['ended', 'h-done', 'h-int', 'h-stop'],
    'a run that ended but still lingers as a live row counts as finished; interrupted is finished');
  assert.equal(titles('all').length, 6);
  const needs = buildRunsModel({ live, history, filter: 'needs', now: NOW });
  assert.deepEqual(needs.groups, [], 'Needs you is the whole list');
  assert.deepEqual(needs.needs.map((r) => r.title), ['ask']);
  assert.equal(buildRunsModel({ live, history, filter: 'bogus', now: NOW }).filter, 'all', 'an unknown filter shows everything');
  assert.equal(rowInFilter({ kind: 'sched', icon: 'scheduled' }, 'live'), true, 'a scheduled run has not ended');
});

test('filters: Archived keeps only rows flagged archived, with its own empty note', () => {
  const live = [liveIt('run')];
  const history = [histIt('h-live'), histIt('h-arch', { archived: true })];
  const titles = (filter) => buildRunsModel({ live, history, filter, now: NOW }).groups.flatMap((g) => g.rows.map((r) => r.title)).sort();
  assert.deepEqual(titles('archived'), ['h-arch'], 'the flag decides, not the row kind');
  assert.equal(rowInFilter({ kind: 'hist' }, 'archived'), false, 'an unflagged row is out even in the archived feed');
  assert.equal(rowInFilter({ kind: 'hist', archived: true }, 'archived'), true);
  assert.equal(rowInFilter({ kind: 'live', archived: true }, 'archived'), true);
  const doc = new JSDOM('').window.document;
  const note = (opts) => renderRunsList(doc, buildRunsModel({ now: NOW, ...opts })).map((n) => n.textContent).join('|');
  assert.equal(note({ live: [liveIt('r')], filter: 'archived' }), 'No archived runs.');
});

test('an archived row says "Archived" on its status line and keeps its terminal icon', () => {
  assert.deepEqual(histRowState({ status: 'done', pr: 'MERGED', archived: true }),
    { icon: 'done', word: 'Archived', detail: '' }, 'the word replaces the glance headline');
  assert.deepEqual(histRowState({ status: 'stopped', archived: true }), { icon: 'stop', word: 'Archived', detail: '' });
  assert.deepEqual(histRowState({ status: 'paused', pauseReason: 'cost_pipeline', archived: true }),
    { icon: 'paused', word: 'Archived', detail: '' }, 'even a parked row reads Archived once it is archived');
  assert.equal(histRowState({ status: 'done', pr: 'MERGED' }).word, 'Merged', 'an active row is untouched');
  const m = buildRunsModel({ history: [histIt('h-arch', { archived: true })], filter: 'archived', now: NOW });
  const row = m.groups[0].rows[0];
  assert.equal(row.icon, 'done', 'the terminal icon stays');
  assert.equal(rowSub(row), 'Archived · 11:17', 'the word leads the subline');
  // Search finds it by its word.
  const hit = buildRunsModel({ history: [histIt('h-arch', { archived: true })], filter: 'archived', query: 'archived', now: NOW });
  assert.deepEqual(hit.groups[0].rows.map((r) => r.title), ['h-arch']);
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

test('group by date: sections in order, empty ones dropped, History by last activity, the project in the subline', () => {
  const live = [liveIt('now')];
  const history = [
    histIt('late-finish', { startedAt: at(29, 23, 50), mtime: new Date(2026, 8, 30, 0, 10).getTime() }),
    histIt('yday', { status: 'stopped', startedAt: at(29, 9, 0), mtime: new Date(2026, 8, 29, 9, 30).getTime() }),
    histIt('old', { startedAt: at(1, 9, 0) }),
  ];
  const m = buildRunsModel({ live, history, groupBy: 'date', now: NOW });
  assert.equal(m.groupBy, 'date');
  assert.deepEqual(m.groups.map((g) => [g.key, g.name, g.rows.map((r) => r.title)]), [
    ['date:today', 'Today', ['now', 'late-finish']],
    ['date:yesterday', 'Yesterday', ['yday']],
    ['date:older', 'Older', ['old']],
  ], 'a run started yesterday that finished today is Today; mtime 0 falls back to the start');
  const sub = (g, i) => rowSub(m.groups[g].rows[i], { bucket: m.groups[g].bucket });
  assert.equal(sub(0, 0), 'Running · Employee project', 'a live row drops its start time');
  assert.equal(sub(0, 1), 'Merged · worca-cc · 00:10', 'Today keeps the finish time');
  assert.equal(sub(1, 0), 'Stopped · worca-cc', 'Yesterday needs no time');
  assert.equal(sub(2, 0), 'Merged · worca-cc · Sep 1');
  const folded = buildRunsModel({ live, history, groupBy: 'date', collapsed: new Set(['date:today']), now: NOW });
  assert.equal(folded.groups[0].collapsed, true, 'date sections fold by their own keys');
  const doc = new JSDOM('').window.document;
  const heads = renderRunsList(doc, m).filter((n) => n.classList.contains('runs-group')).map((n) => n.dataset.groupKey);
  assert.deepEqual(heads, ['date:today', 'date:yesterday', 'date:older']);
});

test('#620: a history row carries its base-check note in the subline, and search finds it', () => {
  const m = buildRunsModel({ live: [], history: [histIt('h1', { base: 'conflicts with dev' }), histIt('h2')], now: NOW });
  const worca = m.groups.find((g) => g.key === 'worca-00000002');
  const [h1, h2] = worca.rows;
  assert.equal(rowSub(h1), 'Merged · conflicts with dev · 11:17');
  assert.equal(rowSub(h2), 'Merged · 11:17', 'no note, no extra part');
  assert.equal(rowSub(h1, { bucket: 'today' }).startsWith('Merged · conflicts with dev'), true);
  assert.equal(rowMatches(h1, 'conflicts'), true);
  assert.equal(rowMatches(h2, 'conflicts'), false);
});
