// test/ui-global-search.test.mjs — the top bar search model (ui/public/global-search.mjs): every
// query word must match, the rank and its ties, the 5 / 6 caps, the empty query, the row meta
// built from real fields only, and the ⌘K / Ctrl K chord and label.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchRows, shortcutLabel, isSearchCombo, RUN_LIMIT, OTHER_LIMIT } from '../ui/public/global-search.mjs';

const NOW = new Date(2026, 9, 9, 15, 0).getTime();            // Fri Oct 9 2026, 15:00 local
const at = (d, h, m = 0) => new Date(2026, 9, d, h, m).toISOString();
const live = (runId, extra = {}) => ({
  runId, pipelineId: '', title: runId, status: 'running', ask: null, pauseReason: '', unread: false,
  step: '', failedStep: '', startedAt: at(9, 12), groupKey: 'billing-00000001', groupName: 'billing-api',
  by: '', pr: null, checks: null, files: null, ...extra,
});
const hist = (id, extra = {}) => ({
  id, projectKey: 'worca-00000002', title: id, status: 'done', pauseReason: null,
  startedAt: at(8, 10), mtime: at(8, 11), groupName: 'worca', by: '', pr: 'MERGED', checks: null, files: null, ...extra,
});
const run = (sources, q) => searchRows(sources, q, { now: NOW, tz: 'UTC' });
const titles = (rows) => rows.map((r) => r.title);

test('every query word must match: across title, project and state word for runs; name and meta for the rest', () => {
  const sources = {
    live: [live('r1', { title: 'Refactor auth', ask: { kind: 'workflow', step: 'Plan' } })],
    history: [hist('p1', { title: 'Fix login bug' })],
    projects: [{ key: 'billing-00000001', name: 'billing-api' }],
  };
  assert.deepEqual(titles(run(sources, 'billing review').runs), ['Refactor auth'], 'project + state word');
  assert.deepEqual(titles(run(sources, 'LOGIN Bug').runs), ['Fix login bug'], 'case-insensitive');
  assert.deepEqual(titles(run(sources, 'login nope').runs), [], 'one missing word drops the row');
  assert.deepEqual(titles(run(sources, 'merged worca').runs), ['Fix login bug'], 'the finished word is the glance headline');
  assert.deepEqual(titles(run(sources, 'billing project').other), ['billing-api'], 'name + meta');
  assert.deepEqual(titles(run(sources, 'billing workflow').other), [], 'a project is not a workflow');
});

test('rank: title prefix > a title word starts with the first query word > a match elsewhere — before the tie order', () => {
  const sources = {
    live: [live('a', { title: 'Catalog sync', status: 'paused' })],     // needs you, but only a substring
    history: [hist('b', { title: 'Fix login page' }), hist('c', { title: 'Login page polish', mtime: at(1, 9) })],
    projects: [{ key: 'k1', name: 'blog' }, { key: 'k2', name: 'logbook' }, { key: 'k3', name: 'web-login' }],
  };
  assert.deepEqual(titles(run(sources, 'log').runs), ['Login page polish', 'Fix login page', 'Catalog sync']);
  assert.deepEqual(titles(run(sources, 'log').other), ['logbook', 'web-login', 'blog'], 'after a hyphen is a word start');
  assert.deepEqual(titles(run(sources, 'login page').runs), ['Login page polish', 'Fix login page'],
    'the prefix is the whole query; word-start uses the first word');
});

test('ties: runs needs you → live → newest; the rest project → workspace → workflow → schedule, then name', () => {
  const sources = {
    live: [live('run-old', { title: 'deploy run old', startedAt: at(9, 8) }), live('run-new', { title: 'deploy run new', startedAt: at(9, 14) }),
      live('ask', { title: 'deploy ask', ask: { kind: 'questions', step: '' }, startedAt: at(9, 1) })],
    history: [hist('h-new', { title: 'deploy finished new', mtime: at(9, 13) }), hist('h-old', { title: 'deploy finished old', mtime: at(2, 9) }),
      hist('h-paused', { title: 'deploy paused', status: 'paused', mtime: at(1, 9) })],
    projects: [{ key: 'pz', name: 'deploy zeta' }, { key: 'pa', name: 'deploy alpha' }],
    workspaces: [{ id: 'w1', name: 'deploy ws', projectCount: 2 }],
    workflows: [{ id: 'wf_1', name: 'deploy flow', builtin: false }],
    schedules: [{ id: 's1', title: 'deploy nightly', sentence: 'Every day at 02:00', status: 'active' }],
  };
  assert.deepEqual(titles(run(sources, 'deploy').runs),
    ['deploy ask', 'deploy paused', 'deploy run new', 'deploy run old', 'deploy finished new']);
  assert.deepEqual(titles(run(sources, 'deploy').other),
    ['deploy alpha', 'deploy zeta', 'deploy ws', 'deploy flow', 'deploy nightly']);
});

test(`caps: ${RUN_LIMIT} runs and ${OTHER_LIMIT} others`, () => {
  assert.equal(RUN_LIMIT, 5);
  assert.equal(OTHER_LIMIT, 6);
  const sources = {
    history: Array.from({ length: 8 }, (_, i) => hist(`x${i}`, { title: `alpha ${i}` })),
    projects: Array.from({ length: 9 }, (_, i) => ({ key: `k${i}`, name: `alpha ${i}` })),
  };
  const out = run(sources, 'alpha');
  assert.equal(out.runs.length, 5);
  assert.equal(out.other.length, 6);
  assert.equal(run(sources, '').runs.length, 5);
});

test('the empty query lists runs only: needs you, then running, then the newest finished; the second group is empty', () => {
  const sources = {
    live: [live('running', { startedAt: at(9, 9) }), live('asking', { ask: { kind: 'gate', step: '' }, startedAt: at(9, 2) })],
    history: [hist('older', { mtime: at(3, 9) }), hist('newest', { mtime: at(9, 14) }), hist('mid', { mtime: at(7, 9) }),
      hist('parked', { status: 'paused', mtime: at(1, 9) })],
    projects: [{ key: 'k', name: 'proj' }],
  };
  const out = run(sources, '   ');
  assert.deepEqual(titles(out.runs), ['asking', 'parked', 'running', 'newest', 'mid']);
  assert.deepEqual(out.other, []);
});

test('no match: both groups are empty (the popover shows "No matches" and the Ask row)', () => {
  const out = run({ live: [live('r1')], projects: [{ key: 'k', name: 'proj' }] }, 'zzz');
  assert.deepEqual(out, { runs: [], other: [] });
});

test('plain matching: regex characters are literal, accents are case-folded only, surrounding spaces are dropped', () => {
  const sources = {
    history: [hist('a', { title: 'Fix (auth) [v2] *now*' }), hist('b', { title: 'Café menu' }), hist('c', { title: 'Price $5.00 ^up \\ back' })],
  };
  for (const q of ['(auth)', '[v2]', '*now*', 'auth) [v2']) assert.deepEqual(titles(run(sources, q).runs), ['Fix (auth) [v2] *now*'], q);
  for (const q of ['$5.00', '^up', '\\', '5.00 ^UP']) assert.deepEqual(titles(run(sources, q).runs), ['Price $5.00 ^up \\ back'], q);
  for (const q of ['.*', '?', '+', '|', 'a|b', 'x{2}', '(?:a)']) assert.deepEqual(run(sources, q).runs, [], `${q} is not a pattern`);
  assert.deepEqual(titles(run(sources, 'CAFÉ').runs), ['Café menu'], 'case-insensitive past ASCII');
  assert.deepEqual(titles(run(sources, 'café').runs), ['Café menu']);
  assert.deepEqual(titles(run(sources, 'cafe').runs), [], 'no accent folding');
  assert.deepEqual(titles(run(sources, '  \t café   MENU \n ').runs), ['Café menu'], 'trimmed, any run of whitespace splits');
  assert.equal(run(sources, '(auth)').runs[0].id, 'hist:worca-00000002/a', 'a title prefix with a bracket still ranks');
});

test('a long history (600 runs): every query word still filters, the five newest matches come first', () => {
  const history = Array.from({ length: 600 }, (_, i) => hist(`h${i}`, { title: `${i % 2 ? 'deploy' : 'build'} ${i}`, mtime: new Date(NOW - i * 6e4).toISOString() }));
  const sources = { live: [live('r1', { title: 'deploy live' })], history };
  assert.deepEqual(titles(run(sources, 'deploy').runs), ['deploy live', 'deploy 1', 'deploy 3', 'deploy 5', 'deploy 7']);
  assert.deepEqual(titles(run(sources, 'build 59').runs), ['build 590', 'build 592', 'build 594', 'build 596', 'build 598']);
  assert.deepEqual(titles(run(sources, '').runs), ['deploy live', 'build 0', 'deploy 1', 'build 2', 'deploy 3']);
});

test('run rows: "<project> · <state word>", the dot tone, the route; a History row a live run stands for is dropped, archived too', () => {
  const sources = {
    live: [
      live('r-ask', { pipelineId: 'p-ask', ask: { kind: 'workflow', step: 'Plan' } }),
      live('r-run'), live('r-start', { status: 'starting' }), live('r-fail', { status: 'error', failedStep: 'Tester', unread: false }),
    ],
    history: [hist('p-ask', { title: 'shadow' }), hist('p-done'), hist('p-err', { status: 'error' }), hist('p-arch', { archived: true })],
  };
  const rows = run(sources, '').runs.concat(run(sources, 'p-err').runs);
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.deepEqual(by['live:r-ask'], { kind: 'run', id: 'live:r-ask', title: 'r-ask', meta: 'billing-api · Plan review', tone: 'need', href: '#running/r-ask' });
  assert.equal(by['live:r-run'].tone, 'run');
  assert.equal(by['live:r-run'].meta, 'billing-api · Running');
  assert.equal(by['live:r-start'].tone, 'run');
  assert.equal(by['live:r-fail'].tone, 'fail');
  assert.equal(by['live:r-fail'].meta, 'billing-api · Tester failed');
  assert.deepEqual(by['hist:worca-00000002/p-done'], { kind: 'run', id: 'hist:worca-00000002/p-done', title: 'p-done', meta: 'worca · Merged', tone: 'idle', href: '#history/worca-00000002/p-done' });
  assert.equal(by['hist:worca-00000002/p-err'].tone, 'fail');
  assert.equal(run(sources, 'shadow').runs.length, 0, 'the live row stands for its History row');
  assert.equal(run(sources, 'p-arch').runs.length, 0, 'archived rows are not searched');
});

test('other rows carry only real fields: project, workspace count, built-in workflow, series sentence, one-off time', () => {
  const sources = {
    projects: [{ key: 'shop-1', name: 'shop' }],
    workspaces: [{ id: 'wks-a', name: 'shop team', projectCount: 1 }, { id: 'wks-b', name: 'shop all', projectCount: 3 }],
    workflows: [{ id: 'wf_default', name: 'shop Default', builtin: true }, { id: 'wf_x', name: 'shop flow', builtin: false }],
    schedules: [
      { id: 's1', title: 'shop nightly', sentence: 'Every day at 02:00', status: 'paused' },
      { id: 's2', title: 'shop gone', sentence: 'Every day at 03:00', status: 'ended' },
      { id: 's3', title: null, sentence: 'shop weekly', status: 'active' },
    ],
    tickets: [
      { id: 't1', scheduleId: null, title: 'shop once', status: 'scheduled', runAt: '2026-10-09T02:00:00.000Z', after: null },
      { id: 't2', scheduleId: null, title: 'shop missed', status: 'missed', runAt: '2026-10-07T23:30:00.000Z', after: null },
      { id: 't3', scheduleId: null, title: 'shop chained', status: 'scheduled', runAt: '9999-12-31T00:00:00.000Z', after: { kind: 'run', id: 'x' } },
      { id: 't4', scheduleId: 's1', title: 'shop occurrence', status: 'scheduled', runAt: '2026-10-10T02:00:00.000Z', after: null },
      { id: 't5', scheduleId: null, title: 'shop firing', status: 'firing', runAt: '2026-10-09T01:00:00.000Z', after: null },
      { id: 't6', scheduleId: null, title: null, status: 'scheduled', runAt: '2026-10-09T02:00:00.000Z', after: null },
      { id: 't7', scheduleId: null, title: 'shop chained missed', status: 'missed', runAt: '9999-12-31T00:00:00.000Z', after: { kind: 'run', id: 'y' } },
    ],
  };
  // One kind per call: together they are more rows than the cap.
  const rowsOf = (key, q = 'shop') => run({ [key]: sources[key] }, q).other;
  const all = ['projects', 'workspaces', 'workflows', 'schedules', 'tickets'].flatMap((key) => rowsOf(key)).concat(rowsOf('tickets', 'scheduled run'));
  const by = Object.fromEntries(all.map((r) => [r.id, r]));
  assert.deepEqual(by['shop-1'], { kind: 'project', id: 'shop-1', title: 'shop', meta: 'Project', href: '#projects/shop-1' });
  assert.deepEqual(by['wks-a'], { kind: 'workspace', id: 'wks-a', title: 'shop team', meta: 'Workspace · 1 project', href: '#workspaces/wks-a' });
  assert.equal(by['wks-b'].meta, 'Workspace · 3 projects');
  assert.deepEqual(by.wf_default, { kind: 'workflow', id: 'wf_default', title: 'shop Default', meta: 'Workflow · built-in', workflowId: 'wf_default' });
  assert.equal(by.wf_x.meta, 'Workflow');
  assert.deepEqual(by.s1, { kind: 'schedule', id: 's1', title: 'shop nightly', meta: 'Every day at 02:00', href: '#schedules/repeating' });
  assert.deepEqual(by.s3, { kind: 'schedule', id: 's3', title: 'Repeating schedule', meta: 'shop weekly', href: '#schedules/repeating' });
  assert.deepEqual(by.t1, { kind: 'ticket', id: 't1', title: 'shop once', meta: 'Fri Oct 9, 02:00', href: '#schedules/once' });
  assert.equal(by.t2.meta, 'Missed · Wed Oct 7, 23:30');
  assert.equal(by.t3.meta, 'Waiting for a run', 'an after-ticket’s runAt is a sentinel, never a time');
  assert.equal(by.t7.meta, 'Missed', 'a missed after-ticket says Missed, as the Schedules page does, and still shows no time');
  assert.equal(by.t6.title, 'Scheduled run');
  for (const gone of ['s2', 't4', 't5']) assert.equal(by[gone], undefined, `${gone} is not listed`);
});

test('shortcutLabel: ⌘K on a Mac, Ctrl K on Windows, Linux and an unknown platform', () => {
  const win = (navigator) => ({ navigator });
  assert.equal(shortcutLabel(win({ platform: 'MacIntel' })), '⌘K');
  assert.equal(shortcutLabel(win({ userAgentData: { platform: 'macOS' }, platform: '' })), '⌘K');
  assert.equal(shortcutLabel(win({ platform: 'iPad' })), '⌘K');
  assert.equal(shortcutLabel(win({ platform: 'Win32' })), 'Ctrl K');
  assert.equal(shortcutLabel(win({ userAgentData: { platform: 'Windows' } })), 'Ctrl K');
  assert.equal(shortcutLabel(win({ platform: 'Linux x86_64' })), 'Ctrl K');
  assert.equal(shortcutLabel(win({})), 'Ctrl K');
  assert.equal(shortcutLabel(undefined), 'Ctrl K');
});

test('isSearchCombo: ⌘K and Ctrl+K (any case, Shift allowed); never with Alt, never a bare k', () => {
  assert.equal(isSearchCombo({ key: 'k', metaKey: true }), true);
  assert.equal(isSearchCombo({ key: 'k', ctrlKey: true }), true);
  assert.equal(isSearchCombo({ key: 'K', ctrlKey: true, shiftKey: true }), true);
  assert.equal(isSearchCombo({ key: 'k', ctrlKey: true, altKey: true }), false);
  assert.equal(isSearchCombo({ key: 'k' }), false);
  assert.equal(isSearchCombo({ key: 'j', metaKey: true }), false);
  assert.equal(isSearchCombo(null), false);
});
