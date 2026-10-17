// test/ui-runs-list-model.test.mjs — the Runs list model (ui/public/runs-list.mjs): row words
// and icons, times, Needs you, grouping, dedupe, search, the started-by filter, folding, and
// the DOM the list is built from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import {
  rowTime, liveRowState, histRowState, schedRowState, countNeedsYou,
  buildRunsModel, rowSub, rowMatches, isRowSelected, renderRunsList, rowInFilter, dateBucket, RUNS_FILTERS, DATE_BUCKETS, chainRow,
  liveRow, histRow, normalizeRunsFilter, rowDot, viewChip, normalizeRunsView, featureSummary, memberState,
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
  // D33: Shaper's plan ask names the decision, not "Plan question".
  assert.equal(liveRowState({ status: 'running', ask: { kind: 'plan', step: 'Plan' } }).word, 'Approve the plan');
  assert.equal(liveRowState({ status: 'running', ask: { kind: 'plan', step: 'Plan', outline: true } }).word, 'Approve the slices');
  assert.equal(liveRowState({ status: 'paused', pauseReason: 'cost_pipeline' }).word, 'Cost limit');
  assert.equal(liveRowState({ status: 'paused', pauseReason: 'usage_limit', limitEngine: 'codex' }).word, 'Codex usage limit', 'a usage limit names its engine');
  assert.equal(histRowState({ status: 'paused', pauseReason: 'usage_limit', limitEngine: 'claude' }).word, 'Claude usage limit');
  assert.equal(liveRowState({ status: 'paused', pauseReason: 'usage_limit' }).word, 'Usage limit', 'a limit that was not the engine\'s (OpenRouter) names none');
  assert.equal(liveRowState({ status: 'paused', pauseReason: null }).word, 'Paused by you', 'no reason recorded: a manual pause');
  assert.equal(liveRowState({ status: 'paused', pauseReason: 'error' }).word, 'Error');
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
  // A booked resume's ticket is the listed run's own "Resumes at": that row stands for it, live or History.
  const resume = { id: 't4', status: 'scheduled', runAt: at(30, 17, 0), resumePipelineId: 'p1', groupKey: 'emp-00000001', groupName: 'Employee project' };
  const liveResume = buildRunsModel({ live: [liveIt('r1', { pipelineId: 'p1', status: 'paused' })], scheduled: [resume], now: NOW });
  assert.deepEqual(keysOf(liveResume), ['live:r1'], 'a resume ticket for a live run is not repeated');
  const histResume = buildRunsModel({ history: [histIt('p1', { status: 'paused' })], scheduled: [resume], now: NOW });
  assert.equal(keysOf(histResume).filter((k) => k.startsWith('sched:')).length, 0, 'a resume ticket for a History run is not repeated');
  const unlisted = buildRunsModel({ scheduled: [resume], now: NOW });
  assert.deepEqual(keysOf(unlisted), ['sched:t4'], 'a resume ticket whose run is not listed still shows');
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
  const input = { history: [histIt('h1'), histIt('h2'), histIt('x', { projectKey: 'other-00000003', groupName: 'other' })],
    filter: 'finished', collapsed: new Set(['worca-00000002']), now: NOW };
  const g = buildRunsModel(input).groups.find((x) => x.key === 'worca-00000002');
  assert.equal(g.collapsed, true);
  assert.equal(g.count, 2);
  assert.equal(buildRunsModel({ ...input, query: 'merged' }).groups.find((x) => x.key === 'worca-00000002').collapsed, false);
});

test('countNeedsYou agrees with the Needs you group, dedupe included', () => {
  const live = [
    { pipelineId: 'p1', status: 'paused', pauseReason: 'cost_total', ask: false, unread: false },
    { pipelineId: '', status: 'running', ask: true, unread: false },
    { pipelineId: 'p3', status: 'error', ask: false, unread: false },
  ];
  const history = [{ id: 'p1', status: 'paused', pauseReason: 'cost_total' }, { id: 'p9', status: 'paused', pauseReason: 'cost_total' }, { id: 'p8', status: 'error' }];
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

test('#724 renderRunsList: sections with an amber Needs you, a dot per row, Show older, no tag chips', () => {
  const day = 86400000;
  const m = buildRunsModel({
    live: [liveIt('ask', { ask: { kind: 'clarify', count: 3 }, tags: ['client:acme'] }), liveIt('work', { step: 'Build' }),
      liveIt('mine', { status: 'paused' })],
    history: [histIt('h1', { mtime: NOW - 3600000 }), histIt('old', { mtime: NOW - 20 * day })],
    now: NOW,
  });
  const doc = new JSDOM('<!doctype html><body></body>').window.document;
  doc.body.append(...renderRunsList(doc, m));
  assert.deepEqual([...doc.querySelectorAll('body > section')].map((s) => s.getAttribute('aria-label')), ['Needs you', 'Running', 'Recent']);
  assert.ok(doc.querySelector('section.runs-needs'), 'the Needs you panel keeps its class');
  assert.equal(doc.querySelectorAll('.runs-row').length, 4, 'each run once');
  assert.deepEqual([...doc.querySelectorAll('.runs-row')].map((a) => a.querySelector('.runs-ic').dataset.dot), ['needs', 'work', 'paused', 'done']);
  assert.ok(doc.querySelector('.runs-row[data-row-key="live:mine"]').classList.contains('is-dim'));
  assert.equal(doc.querySelector('.runs-row[data-row-key="live:ask"] .runs-row-sub').textContent, 'Answer 3 questions');
  assert.equal(doc.querySelectorAll('.tag-chip, .runs-row-tags').length, 0, 'no tag chips');
  assert.equal(doc.querySelectorAll('.runs-ic svg').length, 0, 'a dot, not a glyph');
  const more = doc.querySelector('section[aria-label="Recent"] button.runs-show-older');
  assert.equal(more.textContent, 'Show older');
  for (const q of ['client:acme', 'client:', 'acme']) {
    assert.deepEqual(buildRunsModel({ live: [liveIt('ask', { tags: ['client:acme'] }), liveIt('x')], query: q, now: NOW }).groups.flatMap((g) => g.rows.map((r) => r.key)), ['live:ask'], q);
  }
});

test('filters: Finished keeps what has ended, Active everything', () => {
  const live = [liveIt('run'), liveIt('ask', { ask: { kind: 'clarify', step: 'Plan' } }),
    liveIt('ended', { status: 'done', pipelineId: 'p-ended' })];
  const history = [histIt('h-done'), histIt('h-stop', { status: 'stopped' }), histIt('h-int', { status: 'interrupted' })];
  const titles = (filter) => buildRunsModel({ live, history, filter, now: NOW }).groups.flatMap((g) => g.rows.map((r) => r.title)).sort();
  assert.deepEqual(titles('finished'), ['ended', 'h-done', 'h-stop'],
    'a run that ended but still lingers as a live row counts as finished; interrupted has not ended');
  assert.equal(titles('active').length, 6);
  assert.equal(buildRunsModel({ live, history, filter: 'bogus', now: NOW }).filter, 'active', 'an unknown filter shows Active');
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
    { icon: 'done', word: 'Archived', detail: '', hint: '' }, 'the word replaces the glance headline');
  assert.deepEqual(histRowState({ status: 'stopped', archived: true }), { icon: 'stop', word: 'Archived', detail: '', hint: '' });
  assert.deepEqual(histRowState({ status: 'paused', pauseReason: 'cost_pipeline', archived: true }),
    { icon: 'paused', word: 'Archived', detail: '', hint: '' }, 'even a parked row reads Archived once it is archived');
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

test('group by date: buckets in order, empty ones dropped, History by last activity, the project in the subline', () => {
  const live = [liveIt('now')];
  const history = [
    histIt('late-finish', { startedAt: at(29, 23, 50), mtime: new Date(2026, 8, 30, 0, 10).getTime() }),
    histIt('yday', { status: 'stopped', startedAt: at(29, 9, 0), mtime: new Date(2026, 8, 29, 9, 30).getTime() }),
    histIt('old', { startedAt: at(1, 9, 0) }),
  ];
  const m = buildRunsModel({ live, history, groupBy: 'date', now: NOW });
  assert.equal(m.groupBy, 'date');
  assert.deepEqual(m.sections.map((s) => [s.key, s.groups.map((g) => [g.key, g.name, g.rows.map((r) => r.title)])]), [
    ['running', [['running/all', '', ['now']]]],
    ['recent', [['recent/date:today', 'Today', ['late-finish']], ['recent/date:yesterday', 'Yesterday', ['yday']]]],
  ], 'a run started yesterday that finished today is Today; the live row sits flat in Running');
  assert.equal(m.older, 1, 'the Sep 1 run is behind Show older');
  const recent = m.sections[1].groups;
  const sub = (g, i) => rowSub(recent[g].rows[i], { bucket: recent[g].bucket, project: 'worca-cc' });
  assert.equal(rowSub(m.sections[0].groups[0].rows[0], { project: 'Employee project' }), 'Running · 12:34 · Employee project');
  assert.equal(rowSub({ ...m.sections[0].groups[0].rows[0] }, { bucket: 'today', project: 'Employee project' }), 'Running · Employee project', 'a live row drops its start time');
  assert.equal(sub(0, 0), 'Merged · 00:10 · worca-cc', 'Today keeps the finish time');
  assert.equal(sub(1, 0), 'Stopped · worca-cc', 'Yesterday needs no time');
  const fin = buildRunsModel({ live, history, groupBy: 'date', filter: 'finished', now: NOW });
  assert.deepEqual(fin.groups.map((g) => g.key), ['date:today', 'date:yesterday', 'date:older']);
  const older = fin.groups[2];
  assert.equal(rowSub(older.rows[0], { bucket: older.bucket, project: 'worca-cc' }), 'Merged · Sep 1 · worca-cc');
  const folded = buildRunsModel({ live, history, groupBy: 'date', filter: 'finished', collapsed: new Set(['date:today']), now: NOW });
  assert.equal(folded.groups[0].collapsed, true, 'date buckets fold by their own keys');
  const doc = new JSDOM('').window.document;
  const host = doc.createElement('div');
  host.append(...renderRunsList(doc, fin));
  assert.deepEqual([...host.querySelectorAll('.runs-group')].map((n) => n.dataset.groupKey), ['date:today', 'date:yesterday', 'date:older']);
});

// ---- Run progress in the list (P7 thin line, P8 chain row) ----
const chainIt = (extra = {}) => ({
  id: 'c1', title: 'First run', open: false, groupKey: 'emp-00000001', groupName: 'Employee project',
  total: 2, index: 1, fraction: 0.25, tone: 'blue', text: 'Run 1 of 2 · Build',
  members: [
    { state: 'current', pipelineId: 'p1', ticketId: null, runId: 'r1', title: 'First run', href: '#running/r1', icon: 'run' },
    { state: 'waiting', pipelineId: null, ticketId: 't2', title: 'Second run', href: '#schedules/once' },
  ], ...extra,
});

// D17: a chain that is a feature (runsChainItem adds `feature` and `href`).
const featureChainIt = (extra = {}) => chainIt({
  id: 'c7', title: 'Run tags and cost allocation', open: true, feature: { id: 'feat_1' }, href: '#feature/feat_1',
  total: 3, index: 2, text: 'Slice 2 of 3 · Build',
  members: [
    { state: 'done', pipelineId: 'p1', ticketId: null, runId: 'r1', title: '1 · Store tags', href: '#running/r1', prUrl: 'https://github.com/o/r/pull/1' },
    { state: 'current', pipelineId: 'p2', ticketId: 't2', runId: 'r2', title: '2 · Run tags', href: '#running/r2', icon: 'run' },
    { state: 'waiting', pipelineId: null, ticketId: 't3', title: '3 · Cost report', href: '#feature/feat_1' },
  ], ...extra });

test('a 3-slice feature is one row, open, short member names, the feature title once', () => {
  const m = buildRunsModel({
    live: [liveIt('r1', { pipelineId: 'p1', status: 'done' }), liveIt('r2', { pipelineId: 'p2' })],
    scheduled: [{ id: 't3', title: 'Run tags and cost allocation · 3/3: Cost report', status: 'scheduled', after: 't2', groupKey: 'emp-00000001', groupName: 'Employee project' }],
    chains: [featureChainIt()], now: NOW,
  });
  const rows = m.groups.flatMap((g) => g.rows);
  assert.deepEqual(rows.map((r) => r.key), ['chain:c7']);
  assert.equal(rows[0].href, '#feature/feat_1');
  assert.equal(rows[0].open, true);
  assert.deepEqual(rows[0].feature, { id: 'feat_1' });
  const doc = new JSDOM('<body></body>').window.document;
  const host = doc.createElement('div');
  host.append(...renderRunsList(doc, m, {}));
  assert.equal(host.textContent.split('Run tags and cost allocation').length - 1, 1, 'the feature title once');
  assert.deepEqual([...host.querySelectorAll('.runs-chain-link')].map((a) => a.textContent), ['Open feature →', '1 · Store tags', '2 · Run tags', '3 · Cost report']);
  assert.equal(host.querySelector('.runs-chain-open-feature a').getAttribute('href'), '#feature/feat_1', 'the feature page is the first item');
  const toggle = host.querySelector('.runs-chain-toggle');
  assert.equal(toggle.dataset.feature, '1');
  assert.equal(toggle.getAttribute('aria-label'), 'Hide the 3 slices in this feature');
});

test('a started slice waiting on a question is not its own row nor under Needs you: the feature row is', () => {
  const ask = { kind: 'clarify', step: 'Clarify' };
  const m = buildRunsModel({
    live: [liveIt('r2', { pipelineId: 'p2', ask })],
    chains: [featureChainIt({ text: 'Slice 2 of 3 · Needs you', tone: 'amber',
      members: featureChainIt().members.map((x) => (x.runId === 'r2' ? { ...x, needs: true, icon: 'ask' } : x)) })],
    now: NOW,
  });
  assert.deepEqual(m.needs.map((r) => r.key), ['chain:c7']);
  assert.deepEqual(m.groups.flatMap((g) => g.rows).map((r) => r.key), ['chain:c7']);
  const only = buildRunsModel({ live: [liveIt('r2', { pipelineId: 'p2', ask })], chains: [featureChainIt()], now: NOW });
  assert.deepEqual(only.sections.map((s) => s.key), ['needs'], 'the feature row is listed once, under Needs you');
});

test('the feature row needs you exactly when a member row does (one rule): a paused History member counts', () => {
  const m = buildRunsModel({ history: [histIt('p1', { status: 'paused', pauseReason: 'cost_total' })], chains: [featureChainIt()], now: NOW });
  assert.deepEqual(m.needs.map((r) => r.key), ['chain:c7']);
  const quiet = buildRunsModel({ live: [liveIt('r2', { pipelineId: 'p2' })], chains: [featureChainIt()], now: NOW });
  assert.deepEqual(quiet.needs, [], 'nobody needed: the feature row is not added');
});

// #770: a feature row in every state. The fixture mirrors what runsFeatureItem (app.js) produces.
const PR = (n) => `https://github.com/o/r/pull/${n}`;
const presets = (extra = {}) => ({
  id: 'f:feat_9', title: 'Implement Run Presets Feature', feature: { id: 'feat_9' }, href: '#feature/feat_9',
  groupKey: 'worca-00000002', groupName: 'worca-cc', total: 3, index: 3, fraction: 1, tone: 'green', text: 'Slice 3 of 3',
  hasActive: true, extraKeys: [],
  members: [
    { era: 'slice', state: 'done', pipelineId: 'q1', ticketId: null, runId: '', title: '1 · Presets store', href: '#history/worca-00000002/q1', prUrl: PR(759), prNumber: 759, prState: 'OPEN' },
    { era: 'slice', state: 'done', pipelineId: 'q2', ticketId: 't2', runId: '', title: "2 · Save a finished run's setup", href: '#history/worca-00000002/q2', prUrl: PR(761), prNumber: 761, prState: 'OPEN' },
    { era: 'slice', state: 'done', pipelineId: 'q3', ticketId: 't3', runId: '', title: '3 · Presets in schedules', href: '#history/worca-00000002/q3', prUrl: PR(769), prNumber: 769, prState: 'OPEN' },
  ], ...extra });
const presetRuns = (extra = {}) => [
  histIt('q1', { title: 'Implement Run Presets Feature', mtime: NOW - 5 * 3600_000, pr: null, ...extra.q1 }),
  histIt('q2', { title: 'Implement Run Presets Feature · 2/3: Save a finished run\'s setup', mtime: NOW - 3 * 3600_000, pr: null, ...extra.q2 }),
  histIt('q3', { title: 'Implement Run Presets Feature · 3/3: Presets in schedules', mtime: NOW - 2 * 3600_000, pr: null, ...extra.q3 }),
];
const dom = () => { const doc = new JSDOM('').window.document; const host = doc.createElement('div'); doc.body.appendChild(host); return { doc, host }; };

test('#770: a feature with no live slice is ONE row in Recent, collapsed, "3 of 3 slices · in review", no loose slice rows (history only, as after a restart)', () => {
  const m = buildRunsModel({ history: [...presetRuns(), histIt('other')], chains: [presets()], now: NOW });
  assert.deepEqual(m.sections.map((s) => s.key), ['recent']);
  const rows = m.groups.flatMap((g) => g.rows);
  assert.deepEqual(rows.map((r) => r.key), ['chain:f:feat_9', 'hist:worca-00000002/other'], 'newest activity first, slices folded');
  const f = rows[0];
  assert.equal(f.ended, true);
  assert.equal(f.icon, 'done');
  assert.equal(f.word, '3 of 3 slices · in review');
  assert.equal(f.open, false, 'clarify 2: collapsed with nothing live and nobody needed');
  assert.equal(f.activityMs, NOW - 2 * 3600_000, 'its last activity is the newest slice\'s');
  assert.equal(rowSub(f), '3 of 3 slices · in review · 13:00');
  assert.equal(f.progress, null, 'no thin line once nothing runs');
  assert.deepEqual(f.memberRows.map((r) => r.pipelineId), ['q1', 'q2', 'q3']);
});

test('#770: merged and stopped features read so', () => {
  const merged = presets({ members: presets().members.map((x) => ({ ...x, prState: 'MERGED' })) });
  assert.equal(chainRow(merged, NOW).word, '3 of 3 slices · merged');
  const stopped = presets({ members: presets().members.map((x, i) => (i === 0 ? x : { ...x, state: 'failed', prUrl: null })) });
  const r = chainRow(stopped, NOW);
  assert.deepEqual([r.icon, r.word, r.status], ['stop', '1 of 3 slices · stopped', 'stopped']);
  assert.deepEqual(featureSummary([]), { icon: 'stop', status: 'stopped', word: '0 of 0 slices · stopped', count: '0 of 0 slices' });
  assert.equal(featureSummary([{ state: 'done' }]).word, '1 of 1 slice · done', 'no PR: done');
});

test('#770: memberState maps every History and live status word', () => {
  for (const s of ['done', 'complete', 'completed']) assert.equal(memberState(s), 'done', s);
  for (const s of ['error', 'failed', 'stopped', 'aborted']) assert.equal(memberState(s), 'failed', s);
  for (const s of ['running', 'starting', 'paused', 'pausing', 'interrupted', '']) assert.equal(memberState(s), 'current', s);
});

test('#770: one slice that needs you puts the feature under Needs you, open, and nowhere else', () => {
  const runs = presetRuns({ q2: { status: 'paused', pauseReason: 'cost_total' } });
  const item = presets({ members: presets().members.map((x) => (x.pipelineId === 'q2' ? { ...x, state: 'current', icon: 'paused' } : x)),
    text: 'Slice 2 of 3 · Needs you', tone: 'amber' });
  const m = buildRunsModel({ history: runs, chains: [item], now: NOW });
  assert.deepEqual(m.needs.map((r) => r.key), ['chain:f:feat_9']);
  assert.deepEqual(m.sections.map((s) => s.key), ['needs']);
  assert.equal(m.needs[0].open, true, 'a feature that needs you opens');
});

test('#770: after a server restart an interrupted slice (History only) puts the feature under Needs you', () => {
  const runs = presetRuns({ q3: { status: 'interrupted' } });
  const item = presets({ members: presets().members.map((x) => (x.pipelineId === 'q3' ? { ...x, state: 'current' } : x)) });
  const m = buildRunsModel({ history: runs, chains: [item], now: NOW });
  assert.deepEqual(m.needs.map((r) => r.key), ['chain:f:feat_9']);
  assert.equal(m.groups.flatMap((g) => g.rows).some((r) => r.kind === 'hist'), false);
});

test('#770: a person\'s toggle wins outside a search; a search for a slice title finds the feature row, open', () => {
  assert.equal(buildRunsModel({ history: presetRuns(), chains: [presets({ open: true })], now: NOW }).groups[0].rows[0].open, true);
  const m = buildRunsModel({ history: [...presetRuns(), histIt('other')], chains: [presets({ open: false })], query: 'finished run', now: NOW });
  assert.deepEqual(m.groups.flatMap((g) => g.rows).map((r) => r.key), ['chain:f:feat_9']);
  assert.equal(m.groups[0].rows[0].open, true, 'a search opens the matching feature');
  const byTitle = buildRunsModel({ history: presetRuns(), chains: [presets()], query: 'presets feature', now: NOW });
  assert.equal(byTitle.total, 1);
  // "store" is only in a member title (1 · Presets store): no run title, feature title, project or status word has it.
  assert.deepEqual(buildRunsModel({ history: presetRuns(), chains: [presets()], query: 'presets store', now: NOW })
    .groups.flatMap((g) => g.rows).map((r) => r.key), ['chain:f:feat_9'], 'a slice\'s own title finds the feature');
  assert.equal(buildRunsModel({ history: presetRuns(), chains: [presets()], query: 'nothing like it', now: NOW }).total, 0);
});

test('#770: the planning run and an earlier plan\'s runs are claimed (extraKeys), never loose', () => {
  const m = buildRunsModel({ history: [...presetRuns(), histIt('q0', { title: 'Implement Run Presets Feature · re-plan' })],
    chains: [presets({ extraKeys: ['p:q0'] })], now: NOW });
  assert.deepEqual(m.groups.flatMap((g) => g.rows).map((r) => r.key), ['chain:f:feat_9']);
});

test('#770: group by date files a finished feature under its last activity, with the History rows', () => {
  const runs = presetRuns({ q1: { mtime: NOW - 30 * 3600_000 }, q2: { mtime: NOW - 29 * 3600_000 }, q3: { mtime: NOW - 28 * 3600_000 } });
  const m = buildRunsModel({ history: [...runs, histIt('today', { mtime: NOW - 60_000 })], chains: [presets()], groupBy: 'date', now: NOW });
  const recent = m.sections.find((s) => s.key === 'recent');
  assert.deepEqual(recent.groups.map((g) => [g.bucket, g.rows.map((r) => r.key)]),
    [['today', ['hist:worca-00000002/today']], ['yesterday', ['chain:f:feat_9']]]);
});

test('#770 clarify 3: Archived lists the feature once every run in it is archived, as one row', () => {
  const arch = presetRuns().map((p) => ({ ...p, archived: true }));
  const part = buildRunsModel({ history: arch.slice(0, 1), chains: [presets({ hasActive: true })], filter: 'archived', now: NOW });
  assert.equal(part.total, 0, 'a run still active: the feature stays in Active, no loose archived slice');
  const all = buildRunsModel({ history: arch, chains: [presets({ hasActive: false })], filter: 'archived', now: NOW });
  const rows = all.groups.flatMap((g) => g.rows);
  assert.deepEqual(rows.map((r) => r.key), ['chain:f:feat_9']);
  assert.equal(rows[0].archived, true);
  assert.equal(rows[0].word, 'Archived · 3 of 3 slices');
});

test('#770: the expander lists slices with PR numbers, an archived note and the re-plan divider', () => {
  const { doc, host } = dom();
  const item = presets({ open: true, members: [
    { era: 'earlier', state: 'done', pipelineId: 'q0', title: '1 · Old plan', href: '#history/worca-00000002/q0', prUrl: PR(700), prNumber: 700, prState: 'MERGED', archived: true },
    ...presets().members,
  ], extraKeys: [] });
  host.append(...renderRunsList(doc, buildRunsModel({ history: [...presetRuns(), histIt('q0')], chains: [item], now: NOW }), {}));
  assert.deepEqual([...host.querySelectorAll('.runs-chain-pr')].map((a) => a.textContent), ['#700', '#759', '#761', '#769']);
  assert.equal(host.querySelector('.runs-chain-sep').textContent, 'After the re-plan');
  assert.equal(host.querySelector('.runs-chain-sep').nextElementSibling.textContent.includes('1 · Presets store'), true);
  assert.equal(host.querySelectorAll('.runs-chain-note').length, 1);
  assert.equal(host.querySelector('.runs-chain .runs-row-prog'), null);
  assert.equal(host.querySelector('.runs-chain-toggle').getAttribute('aria-label'), 'Hide the 3 slices in this feature',
    'the label counts this plan\'s slices, not the earlier ones');
});

test('#770: a finished feature row has a ⋯ menu, and an enabled checkbox while selecting', () => {
  const { doc, host } = dom();
  host.append(...renderRunsList(doc, buildRunsModel({ history: presetRuns(), chains: [presets()], now: NOW }), {}));
  const more = host.querySelector('.runs-chain > .runs-row-more');
  assert.ok(more, 'a finished feature row has a ⋯ menu');
  assert.equal(more.dataset.rowKey, 'chain:f:feat_9');
  assert.ok(host.querySelector('.runs-chain').classList.contains('has-more'));
  host.replaceChildren(...renderRunsList(doc, buildRunsModel({ history: presetRuns(), chains: [presets()], now: NOW }), { selecting: new Set() }));
  const box = host.querySelector('.runs-chain > .runs-row-check');
  assert.equal(box.dataset.rowKey, 'chain:f:feat_9');
  assert.equal(box.disabled, false);
  assert.equal(host.querySelector('.runs-chain > .runs-row-more'), null, 'no ⋯ while selecting');
});

test('a non-feature chain is unchanged: its member stays under Needs you; its toggle names runs', () => {
  const m = buildRunsModel({ live: [liveIt('r1', { pipelineId: 'p1', ask: { kind: 'workflow', step: 'Plan' } })], chains: [chainIt()], now: NOW });
  assert.deepEqual(m.needs.map((r) => r.key), ['live:r1']);
  const doc = new JSDOM('<body></body>').window.document;
  const host = doc.createElement('div');
  host.append(...renderRunsList(doc, m, {}));
  const toggle = host.querySelector('.runs-chain-toggle');
  assert.equal(toggle.dataset.feature, undefined);
  assert.equal(toggle.getAttribute('aria-label'), 'Show the 2 runs in this chain');
  assert.equal(chainRow(chainIt(), NOW).href, '#running/r1', 'a plain chain links its current member');
});

test('live row carries its progress; a chain item replaces its member rows with ONE chain row', async () => {
  const m = buildRunsModel({
    live: [liveIt('r1', { pipelineId: 'p1', progress: { fraction: 0.4, tone: 'blue' } }), liveIt('r9')],
    scheduled: [{ id: 't2', title: 'Second run', status: 'scheduled', after: 'p1', groupKey: 'emp-00000001', groupName: 'Employee project' }],
    chains: [chainIt()], now: NOW,
  });
  const rows = m.groups.flatMap((g) => g.rows);
  assert.deepEqual(rows.map((r) => r.key), ['chain:c1', 'live:r9']);
  const c = rows[0];
  assert.equal(c.kind, 'chain');
  assert.equal(c.title, 'First run');
  assert.equal(c.word, 'Run 1 of 2 · Build');
  assert.deepEqual(c.progress, { fraction: 0.25, tone: 'blue' });
  assert.equal(c.icon, 'run');
  assert.equal(m.groups[0].rows[1].progress, null);
  assert.equal(buildRunsModel({ live: [liveIt('r1', { progress: { fraction: 0.4, tone: 'blue' } })], now: NOW }).groups[0].rows[0].progress.fraction, 0.4);
});

test('Needs you keeps listing a chain member that asks, folded or not, under every filter', () => {
  const args = { live: [liveIt('r1', { pipelineId: 'p1', ask: { kind: 'workflow', step: 'Plan' } })], chains: [chainIt()], now: NOW };
  const m = buildRunsModel(args);
  assert.deepEqual(m.needs.map((r) => r.key), ['live:r1']);
  assert.deepEqual(m.groups.flatMap((g) => g.rows).map((r) => r.key), ['live:r1', 'chain:c1'], 'Needs you lists the member, Running the chain row');
  const only = buildRunsModel({ ...args, filter: 'needs' });
  assert.deepEqual(only.needs.map((r) => r.key), ['live:r1'], 'a legacy needs filter reads as Active');
  assert.equal(countNeedsYou({ live: [{ pipelineId: 'p1', status: 'running', ask: true }] }), 1);
});

test('a chain of three is ONE row (Run 2 of 3) that expands to ✓ ● ○ members', () => {
  const doc = new JSDOM('<body></body>').window.document;
  const chain = chainIt({ open: true, total: 3, index: 2, text: 'Run 2 of 3 · Plan', members: [
    { state: 'done', pipelineId: 'p0', title: 'Zero', href: '#history/k/p0' },
    { state: 'current', pipelineId: 'p1', runId: 'r1', title: 'First run', href: '#running/r1', icon: 'run' },
    { state: 'waiting', ticketId: 't2', title: 'Second run', href: '#schedules/once' }] });
  const m = buildRunsModel({ live: [liveIt('r1', { pipelineId: 'p1' })], history: [histIt('p0')], chains: [chain], now: NOW });
  const rows = m.groups.flatMap((g) => g.rows);
  assert.deepEqual(rows.map((r) => r.key), ['chain:c1'], 'the done History member folds in too');
  assert.equal(rows[0].word, 'Run 2 of 3 · Plan');
  const host = doc.createElement('div');
  host.append(...renderRunsList(doc, m, {}));
  assert.deepEqual([...host.querySelectorAll('.runs-chain-glyph')].map((g) => g.textContent), ['✓', '●', '○']);
  assert.deepEqual(host.querySelector('.runs-row-chain').dataset.memberKeys.split(' ').sort(), ['p:p0', 'p:p1', 'r:r1', 't:t2'],
    'the row carries its member keys so the selection repaint can rebuild them from the DOM');
});

test('only a current member that is working pulses (is-live): not one that asks or is paused', () => {
  const doc = new JSDOM('<body></body>').window.document;
  const liveOf = (icon) => {
    const chain = chainIt({ open: true, members: [
      { state: 'done', pipelineId: 'p0', title: 'Zero', href: '#history/k/p0' },
      { state: 'current', pipelineId: 'p1', runId: 'r1', title: 'A', href: '#running/r1', icon }] });
    const host = doc.createElement('div');
    host.append(...renderRunsList(doc, buildRunsModel({ live: [liveIt('r1', { pipelineId: 'p1' })], chains: [chain], now: NOW }), {}));
    return [...host.querySelectorAll('.runs-chain-member')].map((li) => li.classList.contains('is-live'));
  };
  assert.deepEqual(liveOf('run'), [false, true]);
  assert.deepEqual(liveOf('ask'), [false, false]);
  assert.deepEqual(liveOf('paused'), [false, false]);
});

test('a member that needs the person is amber, a working one pulses blue, a paused one is grey (D33)', () => {
  const doc = new JSDOM('<body></body>').window.document;
  const classesOf = (icon, asks = false) => {
    const chain = chainIt({ open: true, members: [
      { state: 'done', pipelineId: 'p0', title: 'Zero', href: '#history/k/p0' },
      { state: 'current', pipelineId: 'p1', runId: 'r1', title: 'A', href: '#running/r1', icon, asks }] });
    const host = doc.createElement('div');
    host.append(...renderRunsList(doc, buildRunsModel({ live: [liveIt('r1', { pipelineId: 'p1' })], chains: [chain], now: NOW }), {}));
    const li = host.querySelectorAll('.runs-chain-member')[1];
    return ['is-live', 'is-needs', 'is-paused'].filter((c) => li.classList.contains(c));
  };
  assert.deepEqual(classesOf('run'), ['is-live']);
  assert.deepEqual(classesOf('ask', true), ['is-needs']);
  assert.deepEqual(classesOf('paused', true), ['is-needs'], 'paused with a question waiting: it needs the person');
  assert.deepEqual(classesOf('paused'), ['is-paused']);
});

test('the member dot colours: amber for needs, grey for paused (style.css)', async () => {
  const css = await readFile(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.runs-chain-member\.is-needs \.runs-chain-glyph\{color:var\(--amber-ink\);\}/);
  assert.match(css, /\.runs-chain-member\.is-paused \.runs-chain-glyph\{color:var\(--ink-3\);\}/);
});

test('the chain row glyph follows the current member: ask, paused, else scheduled while it only waits', () => {
  const iconOf = (members) => chainRow(chainIt({ members }), NOW).icon;
  const cur = (icon) => [{ state: 'current', pipelineId: 'p1', runId: 'r1', title: 'A', href: '#running/r1', icon }];
  assert.equal(iconOf(cur('ask')), 'ask');
  assert.equal(iconOf(cur('paused')), 'paused');
  assert.equal(iconOf(cur(undefined)), 'run');
  assert.equal(iconOf([{ state: 'waiting', ticketId: 't2', title: 'B', href: '#schedules/once' }]), 'scheduled');
});

test('filter Finished with a chain: the done member keeps the chain row alive, a live-only chain is dropped', () => {
  const doneChain = chainIt({ members: [
    { state: 'done', pipelineId: 'p0', title: 'Zero', href: '#history/k/p0' },
    { state: 'waiting', ticketId: 't2', title: 'Second', href: '#schedules/once' }] });
  const m = buildRunsModel({ history: [histIt('p0')], chains: [doneChain], filter: 'finished', now: NOW });
  assert.deepEqual(m.groups.flatMap((g) => g.rows).map((r) => r.key), ['chain:c1']);
  const live = buildRunsModel({ live: [liveIt('r1', { pipelineId: 'p1' })], chains: [chainIt()], filter: 'finished', now: NOW });
  assert.deepEqual(live.groups.flatMap((g) => g.rows), []);
});

test('a chain marks its group live and is selected by any member pipeline/run', () => {
  const m = buildRunsModel({ live: [liveIt('r1', { pipelineId: 'p1', groupKey: 'g', groupName: 'G' })], history: [histIt('h1')], chains: [chainIt({ groupKey: 'g', groupName: 'G' })], now: NOW });
  assert.equal(m.groups[0].key, 'running/g', 'live-first');
  const row = m.groups[0].rows[0];
  assert.equal(isRowSelected(row, { pipelineId: 'p1' }), true);
  assert.equal(isRowSelected(row, { runId: 'r1' }), true);
  assert.equal(isRowSelected(row, { runId: 'zz' }), false);
  assert.equal(dateBucket(row, NOW), 'today');
});

test('the thin line is painted under live and chain rows only while live; a chain toggle expands its members', () => {
  const dom = new JSDOM('<body></body>');
  const doc = dom.window.document;
  const m = buildRunsModel({
    live: [liveIt('r1', { pipelineId: 'p1', progress: { fraction: 0.4, tone: 'blue' } }),
      liveIt('r2', { status: 'done', progress: { fraction: 1, tone: 'green' } })],
    chains: [chainIt({ open: true, members: [
      { state: 'done', pipelineId: 'p0', title: 'Zero', href: '#history/k/p0', prUrl: 'https://x.test/1' },
      { state: 'current', pipelineId: 'p1', runId: 'r1', title: 'First run', href: '#running/r1', icon: 'run' }] })],
    now: NOW,
  });
  const host = doc.createElement('div');
  host.append(...renderRunsList(doc, m, { lineFrom: new Map([['chain:c1', '10%']]) }));
  assert.equal(host.querySelectorAll('.runs-row-prog').length, 1, 'ended live row has no line');
  assert.equal(host.querySelector('.runs-chain .runs-row-prog > i').style.width, '10%');
  const tog = host.querySelector('.runs-chain-toggle');
  assert.equal(tog.getAttribute('aria-expanded'), 'true');
  assert.equal(tog.dataset.chainKey, 'chain:c1');
  assert.equal(host.querySelectorAll('.runs-chain-member').length, 2);
  assert.equal(host.querySelector('.runs-chain-pr').getAttribute('href'), 'https://x.test/1');
  const closed = buildRunsModel({ live: [liveIt('r1', { pipelineId: 'p1' })], chains: [chainIt()], now: NOW });
  const h2 = doc.createElement('div');
  h2.append(...renderRunsList(doc, closed, {}));
  assert.equal(h2.querySelector('.runs-chain-members').hidden, true);
  assert.equal(h2.querySelectorAll('.runs-chain-member').length, 0);
});

test('#620: a history row carries its base-check note in the subline, and search finds it', () => {
  const m = buildRunsModel({ live: [], history: [histIt('h1', { base: 'conflicts with dev' }), histIt('h2')], now: NOW });
  const [h1, h2] = m.groups.flatMap((g) => g.rows);
  assert.equal(rowSub(h1), 'Merged · conflicts with dev · 11:17');
  assert.equal(rowSub(h2), 'Merged · 11:17', 'no note, no extra part');
  assert.equal(rowSub(h1, { bucket: 'today' }).startsWith('Merged · conflicts with dev'), true);
  assert.equal(rowMatches(h1, 'conflicts'), true);
  assert.equal(rowMatches(h2, 'conflicts'), false);
});

const sectionKeys = (m) => m.sections.map((s) => s.key);
const allKeys = (m) => m.sections.flatMap((s) => s.groups.flatMap((g) => g.rows.map((r) => r.key)));

test('#724 each run once: a Needs-you run is not repeated in its project group, in any view', () => {
  const live = [
    liveIt('ask1', { pipelineId: 'pa', ask: { kind: 'clarify', step: 'Plan', count: 2 }, groupKey: 'worca-00000002', groupName: 'worca-cc' }),
    liveIt('pause1', { pipelineId: 'pp', status: 'paused', pauseReason: 'cost_pipeline', groupKey: 'worca-00000002', groupName: 'worca-cc' }),
    liveIt('run1', { step: 'Build' }),
  ];
  const history = [histIt('pp', { status: 'paused', pauseReason: 'cost_pipeline' }), histIt('h1'), histIt('h2', { status: 'error' })];
  for (const filter of ['active', 'finished', 'archived']) {
    for (const groupBy of ['project', 'date']) {
      const keys = allKeys(buildRunsModel({ live, history, filter, groupBy, now: NOW }));
      assert.equal(new Set(keys).size, keys.length, `${filter}/${groupBy}: no key twice`);
    }
  }
  const m = buildRunsModel({ live, history, now: NOW });
  assert.deepEqual(sectionKeys(m), ['needs', 'running', 'recent']);
  assert.deepEqual(m.sections[0].groups.flatMap((g) => g.rows.map((r) => r.key)), ['live:ask1', 'live:pause1']);
  assert.ok(!m.sections[1].groups.some((g) => g.rows.some((r) => r.key === 'live:pause1')), 'not again under Running');
});

test('#724 sections: Running lists live runs, then dimmed paused-by-you, resuming and waiting ones', () => {
  const m = buildRunsModel({
    live: [
      liveIt('mine', { status: 'paused', pauseReason: '' }),
      liveIt('auto', { status: 'paused', pauseReason: 'usage_limit', resumeAt: NOW + 3600000 }),
      liveIt('work', { step: 'Build' }),
    ],
    scheduled: [{ id: 't1', title: 'Nightly', status: 'scheduled', after: { id: 'p0', title: 'Billing export' }, groupKey: 'emp-00000001', groupName: 'Employee project' }],
    now: NOW,
  });
  assert.deepEqual(sectionKeys(m), ['running'], 'Needs you is absent when empty; nothing finished');
  assert.deepEqual(m.sections[0].groups.flatMap((g) => g.rows.map((r) => r.key)), ['live:work', 'live:mine', 'live:auto', 'sched:t1']);
  assert.deepEqual(m.sections[0].groups.flatMap((g) => g.rows.map(rowDot)), ['work', 'paused', 'wait', 'wait']);
});

test('#724 Recent: finished in the last 7 days, newest first; older ones only behind Show older', () => {
  const day = 86400000;
  const history = [
    histIt('d1', { mtime: NOW - 1 * day }), histIt('d0', { mtime: NOW - 3600000 }),
    histIt('d6', { mtime: NOW - 6 * day }), histIt('d9', { mtime: NOW - 9 * day }), histIt('d30', { mtime: NOW - 30 * day }),
  ];
  const m = buildRunsModel({ history, now: NOW });
  const recent = m.sections.find((s) => s.key === 'recent');
  assert.deepEqual(recent.groups.flatMap((g) => g.rows.map((r) => r.pipelineId)), ['d0', 'd1', 'd6']);
  assert.equal(recent.older, 2);
  const fin = buildRunsModel({ history, filter: 'finished', now: NOW });
  assert.equal(fin.sections.length, 1);
  assert.equal(fin.sections[0].count, 5, 'Finished is the full history');
  const onlyOld = buildRunsModel({ history: [histIt('d30', { mtime: NOW - 30 * day })], now: NOW });
  assert.deepEqual(sectionKeys(onlyOld), ['recent'], 'Recent stays to carry Show older');
  assert.equal(onlyOld.sections[0].count, 0);
});

test('#724 filters: Active | Finished | Archived; old stored values read back as Active', () => {
  assert.deepEqual(RUNS_FILTERS, ['active', 'finished', 'archived']);
  for (const v of ['all', 'live', 'needs', 'bogus', null]) assert.equal(normalizeRunsFilter(v), 'active');
  assert.equal(normalizeRunsFilter('finished'), 'finished');
  const live = [liveIt('run'), liveIt('ended', { status: 'done', pipelineId: 'p-ended' })];
  const history = [histIt('h-done'), histIt('h-paused', { status: 'paused' }), histIt('h-int', { status: 'interrupted' })];
  const titles = (filter) => buildRunsModel({ live, history, filter, now: NOW }).groups.flatMap((g) => g.rows.map((r) => r.title)).sort();
  assert.deepEqual(titles('finished'), ['ended', 'h-done'], 'a paused or interrupted History row is not finished');
  assert.equal(buildRunsModel({ live, history, filter: 'needs', now: NOW }).filter, 'active');
});

test('#724 one project: no project headers, the subline names the project', () => {
  const g = { groupKey: 'worca-00000002', groupName: 'worca-cc' };
  const one = buildRunsModel({ live: [liveIt('a', { ...g, step: 'Build' }), liveIt('b', { ...g, status: 'paused', pauseReason: 'cost_total' })], history: [histIt('h1')], now: NOW });
  assert.ok(one.groups.every((x) => !x.head), 'no project header in any section');
  const doc = new JSDOM('<!doctype html><body></body>').window.document;
  doc.body.append(...renderRunsList(doc, one));
  assert.equal(doc.querySelectorAll('.runs-group-head').length, 0);
  assert.deepEqual([...doc.querySelectorAll('.runs-row-sub')].map((n) => n.textContent),
    ['Total budget · resume or raise it · worca-cc', 'Running · Build · worca-cc', 'Merged · 11:17 · worca-cc']);
  const two = buildRunsModel({ live: [liveIt('a', { ...g }), liveIt('c')], now: NOW });
  assert.deepEqual(two.sections[0].groups.map((x) => [x.head, x.key]), [[true, 'running/emp-00000001'], [true, 'running/worca-00000002']]);
});

test('#724 group by date inside the sections: Needs you and Running flat, Recent in date buckets', () => {
  const m = buildRunsModel({
    live: [liveIt('ask', { ask: { kind: 'clarify', count: 1 } }), liveIt('work')],
    history: [histIt('t', { mtime: NOW - 3600000 }), histIt('y', { mtime: NOW - 86400000 })], groupBy: 'date', now: NOW,
  });
  assert.deepEqual(m.sections.map((s) => [s.key, s.groups.map((x) => x.bucket || '')]),
    [['needs', ['']], ['running', ['']], ['recent', ['today', 'yesterday']]]);
});

test('#724 the dot colours and the pulse come from tokens and stop under reduced motion (style.css)', async () => {
  const css = await readFile(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.runs-ic\[data-dot="needs"\]\{background:var\(--amber\);\}/);
  assert.match(css, /\.runs-ic\[data-dot="work"\]\{background:var\(--peach\);animation:runs-dot-pulse 1\.6s ease-in-out infinite;\}/);
  assert.match(css, /\.runs-ic\{[^}]*width:9px;height:9px;[^}]*background:var\(--ink-3\);/);
  assert.match(css, /\.runs-ic\[data-dot="wait"\]\{background:transparent;border:2px solid var\(--ink-3\)/);
  assert.match(css, /@keyframes runs-dot-pulse\{0%,100%\{opacity:1;transform:scale\(1\);\}50%\{opacity:\.45;transform:scale\(\.8\);\}\}/);
  assert.match(css, /prefers-reduced-motion: reduce\)\{\s*\.runs-ic\[data-dot="work"\],\.rc-sic \.sic-spin,\.rd-prs-ico\.is-run,\.rd-pr-spin/);
  assert.doesNotMatch(css, /\.rd-prs-ico\.is-run\{animation:ws-spin/);
  assert.doesNotMatch(css, /\.runs-ic-run \.runs-glyph\{animation:wr-spin/);
});

test('#724 needsYou: only a person can move it — each pause reason placed', () => {
  const RESUME = NOW + 3600000;
  const one = (it) => countNeedsYou({ live: [{ runId: 'r', pipelineId: 'p', ask: false, unread: false, pauseReason: '', resumeAt: null, ...it }], history: [] });
  assert.equal(one({ status: 'paused' }), 0, 'a manual pause (no reason) is not counted');
  assert.equal(one({ status: 'paused', pauseReason: 'usage_limit', resumeAt: RESUME }), 0, 'auto-resuming usage limit');
  assert.equal(one({ status: 'pausing', pauseReason: 'cost_pipeline' }), 0, 'pausing is on its way');
  assert.equal(countNeedsYou({ live: [], history: [], scheduled: [{ id: 't1', after: { id: 'p0' } }] }), 0, 'tickets never count');
  for (const pauseReason of ['cost_pipeline', 'cost_total', 'cost_pipeline_policy', 'cost_total_policy', 'error', 'recoverable', 'drain', 'night_guardrail', 'usage_limit']) {
    assert.equal(one({ status: 'paused', pauseReason }), 1, `${pauseReason} needs you`);
  }
  assert.equal(one({ status: 'interrupted' }), 1, 'interrupted needs you');
  assert.equal(one({ status: 'running', ask: true }), 1, 'an open question');
  assert.equal(one({ status: 'paused', ask: true }), 1, 'a question still open on a manual pause');
  assert.equal(one({ status: 'error', unread: true }), 1, 'a failed run nobody opened');
  assert.equal(one({ status: 'error', unread: false }), 0, 'a failed run already opened');
  // History rows follow the same pause rule.
  const hist = (p) => countNeedsYou({ live: [], history: [{ id: 'h', status: 'paused', pauseReason: null, ...p }] });
  assert.equal(hist({}), 0);
  assert.equal(hist({ pauseReason: 'cost_total' }), 1);
  assert.equal(hist({ pauseReason: 'usage_limit', resumeAt: RESUME }), 0);
  assert.equal(hist({ status: 'interrupted' }), 1);
  // D18: an archived row never needs you, whatever its pause.
  assert.equal(histRow(histIt('a', { status: 'paused', pauseReason: 'cost_total', archived: true }), NOW).needs, false);
  assert.equal(histRow(histIt('b', { status: 'paused', pauseReason: 'cost_total' }), NOW).needs, true);
});

test('#724 row words: paused by you, resumes at, answer N questions, waiting after a run', () => {
  const at14 = new Date(2026, 8, 30, 14, 5).getTime() + 86400000;   // tomorrow 14:05
  assert.equal(liveRowState({ status: 'paused', pauseReason: '' }).word, 'Paused by you');
  assert.deepEqual(liveRowState({ status: 'paused', pauseReason: 'usage_limit', resumeAt: at14 }),
    { icon: 'paused', word: 'Resumes at 14:05', detail: 'usage limit', hint: '' });
  assert.equal(liveRowState({ status: 'paused', pauseReason: 'usage_limit', limitEngine: 'codex', resumeAt: at14 }).detail, 'Codex usage limit');
  assert.equal(liveRowState({ status: 'running', ask: { kind: 'clarify', step: 'Plan', count: 3 } }).word, 'Answer 3 questions');
  assert.equal(liveRowState({ status: 'running', ask: { kind: 'form', step: '', count: 1 } }).word, 'Answer 1 question');
  assert.equal(liveRowState({ status: 'running', ask: { kind: 'plan', step: '' } }).word, 'Approve the plan');
  assert.deepEqual(schedRowState({ status: 'scheduled', after: { id: 'p0', title: 'Billing export' } }),
    { icon: 'scheduled', word: 'Waiting', detail: 'after Billing export' });
  const cost = liveRow(liveIt('c', { status: 'paused', pauseReason: 'cost_pipeline' }), NOW);
  assert.equal(rowSub(cost), 'Cost limit · resume or raise it');
  const err = liveRow(liveIt('e', { status: 'paused', pauseReason: 'error' }), NOW);
  assert.equal(rowSub(err), 'Error · resume to retry');
  const mine = liveRow(liveIt('m', { status: 'paused', startedAt: at(30, 9, 45) }), NOW);
  assert.equal(rowSub(mine), 'Paused by you · 09:45');
  assert.equal(rowSub(mine, { project: 'worca-cc' }), 'Paused by you · 09:45 · worca-cc');
  // D19: a manual pause with a question still open needs you and says so.
  const asked = liveRow(liveIt('q', { status: 'paused', ask: { kind: 'clarify', step: 'Plan', count: 3 } }), NOW);
  assert.equal(asked.needs, true);
  assert.equal(rowSub(asked), 'Paused by you · Answer 3 questions');
  // D18: the archived override clears the hint.
  assert.deepEqual(histRowState({ status: 'paused', pauseReason: 'cost_pipeline', archived: true }),
    { icon: 'paused', word: 'Archived', detail: '', hint: '' });
});

test('#740 viewChip: no chip for Active · Project, one label for every other view', () => {
  assert.equal(viewChip({ show: 'active', groupBy: 'project' }), null);
  assert.equal(viewChip({ show: 'finished', groupBy: 'date' }), 'Finished · by date');
  assert.equal(viewChip({ show: 'finished', groupBy: 'project' }), 'Finished · by project');
  assert.equal(viewChip({ show: 'active', groupBy: 'date' }), 'Active · by date');
  assert.equal(viewChip({ show: 'archived', groupBy: 'project' }), 'Archived · by project');
  assert.equal(viewChip({ show: 'needs', groupBy: 'bogus' }), null, 'legacy and unknown values are the default view');
  assert.equal(viewChip(), null);
});

test('#740 normalizeRunsView: a stored legacy filter of needs, live or all reads back as Active', () => {
  for (const show of ['needs', 'live', 'all']) {
    assert.deepEqual(normalizeRunsView({ show, groupBy: 'date' }), { show: 'active', groupBy: 'date' }, show);
  }
  assert.deepEqual(normalizeRunsView({ show: null, groupBy: null }), { show: 'active', groupBy: 'project' }, 'nothing stored');
  assert.deepEqual(normalizeRunsView({ show: 'archived', groupBy: 'project' }), { show: 'archived', groupBy: 'project' });
});

test('#739: a finished row gets a ⋯ button beside (not inside) its link; a live row stays bare; select mode checkboxes', () => {
  const { window } = new JSDOM('<!doctype html><div id="h"></div>');
  const doc = window.document;
  const model = buildRunsModel({
    live: [{ runId: 'r1', pipelineId: 'p1', title: 'Live', status: 'running', startedAt: NOW }],
    history: [{ id: 'h1', projectKey: 'k', title: 'Done', status: 'done', startedAt: NOW - 1000, mtime: NOW - 1000 }],
    now: NOW,
  });
  const host = doc.getElementById('h');
  host.append(...renderRunsList(doc, model));
  const item = host.querySelector('.runs-item[data-row-key="hist:k/h1"]');
  assert.ok(item, 'the finished row is wrapped');
  const more = item.querySelector('.runs-row-more');
  assert.equal(more.getAttribute('aria-label'), 'More actions for Done');
  assert.equal(more.closest('a'), null, 'the ⋯ button is never inside the link');
  assert.equal(host.querySelector('.runs-row[data-run-id="r1"]').parentElement.classList.contains('runs-item'), false);
  host.replaceChildren(...renderRunsList(doc, model, { selecting: new Set(['hist:k/h1']) }));
  const boxes = [...host.querySelectorAll('.runs-row-check')];
  assert.deepEqual(boxes.map((b) => [b.dataset.rowKey, b.checked, b.disabled]), [['live:r1', false, true], ['hist:k/h1', true, false]]);
  assert.equal(boxes[0].title, "Can't archive: still running");
  assert.equal(host.querySelector('.runs-row-more'), null, 'no ⋯ while selecting');
});
