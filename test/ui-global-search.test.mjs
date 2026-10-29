// test/ui-global-search.test.mjs — the top bar search model (ui/public/global-search.mjs): every
// query word must match, the rank and its ties, the 5 / 6 caps, the empty query, the row meta
// built from real fields only, and the ⌘K / Ctrl K chord and label.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchRows, shortcutLabel, isSearchCombo, RUN_LIMIT, OTHER_LIMIT, SETTINGS_LIMIT, ADDON_LIMIT, chatRows, CHAT_LIMIT } from '../ui/public/global-search.mjs';

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

test('no match: every group is empty (the popover shows "No matches" and the Ask row)', () => {
  const out = run({ live: [live('r1')], projects: [{ key: 'k', name: 'proj' }] }, 'zzz');
  assert.deepEqual(out, { runs: [], other: [], settings: [], addons: [] });
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

test('labels: "hotfix", "label:hot" and "label:hotfix" offer "Runs labelled hotfix"; "label:" lists every label; no source, no row', () => {
  const src = { labels: ['hotfix', 'needs demo'] };
  for (const q of ['hotfix', 'label:hot', 'label:hotfix', 'HOTFIX']) {
    assert.deepEqual(run(src, q).other, [{ kind: 'label', id: 'hotfix', title: 'Runs labelled hotfix', meta: 'Runs filter', label: 'hotfix' }], q);
  }
  assert.deepEqual(run(src, 'label:').other.map((r) => r.label), ['hotfix', 'needs demo']);
  assert.deepEqual(run(src, 'label:needs demo').other.map((r) => r.label), ['needs demo']);
  assert.deepEqual(run(src, 'runs').other, [], 'the row title is not searched: "runs" does not list every label');
  assert.deepEqual(run({}, 'hotfix').other, []);
  assert.deepEqual(run(src, '').other, [], 'an empty query lists runs only');
});

// ── Settings and Add-ons groups (settings-index.mjs) ─────────────────────────
const UNLOCKED = { level: 'expert', flags: { runLabels: true } };
const setRows = (q, over = {}) => run({ ...UNLOCKED, ...over }, q);

test('R-po-1/3/5/14: a tab name finds a Settings row in its own group; an empty query lists neither group', () => {
  const r = setRows('Guardrails');
  assert.deepEqual(r.settings.map((x) => x.href), ['#settings/guardrails']);
  assert.equal(r.settings[0].meta, 'Settings tab');
  assert.deepEqual([r.runs, r.other, r.addons], [[], [], []]);
  const none = setRows('');
  assert.deepEqual([none.settings, none.addons], [[], []]);
});

test('R-po-4: every word must match; a title prefix ranks first', () => {
  assert.deepEqual(setRows('budget zzz').settings, []);
  assert.deepEqual(setRows('budget limits').settings.map((x) => x.title), ['Budget & cost limits']);
  assert.equal(setRows('run').settings[0].title, 'Runs', 'the tab whose name starts with the query leads');
});

test('R-po-8/17: a setting row names its tab; "dark mode" finds Appearance on General', () => {
  const r = setRows('dark mode').settings;
  assert.deepEqual(r.map((x) => x.title), ['Appearance']);
  assert.equal(r[0].meta, 'Settings · General');
  assert.equal(r[0].href, '#settings/general/appearance-card');
  assert.equal(r[0].note, '', 'nothing to unlock');
});

test('R-po-12/A-6: former Settings tabs and alternative words land in Add-ons, never in Settings', () => {
  for (const [q, href] of [['Marketplace', '#marketplace'], ['connectors', '#connectors'], ['Models', '#models'], ['providers', '#providers'], ['integrations', '#connectors']]) {
    const r = setRows(q);
    assert.ok(r.addons.some((x) => x.href === href && x.meta === 'Add-ons page'), q);
    assert.ok(!r.settings.some((x) => x.href === href), `${q} is not a Settings row`);
  }
});

test('R-po-18/A-5: every name match is listed before an alternative-word-only match; a tab before its settings', () => {
  // "run": the Presets tab holds it only in an alternative word ("run presets"). It ranks after every name match
  // (the card "Budget & cost limits" matches through its tab's name, Runs), so the five rows have no room for it.
  assert.deepEqual(setRows('run').settings.map((x) => x.title),
    ['Runs', 'Smart run naming', 'Sync before run', 'Scheduled runs', 'Budget & cost limits']);
  assert.deepEqual(setRows('mode').settings.map((x) => x.title), ['Interface mode', 'Away mode', 'Engine & models', 'Appearance'],
    'Appearance has "mode" only in "dark mode"');
  assert.deepEqual(setRows('chat').settings.map((x) => x.title), ['Chat', 'Chat notifications', 'Engine & models', 'Limits & access'],
    'the Chat tab before the card that also starts with "chat", then the cards found through the tab name');
});

test('R-po-10/11: locked rows stay listed with a note naming the mode and the Labs feature', () => {
  const p = setRows('presets', { level: 'simple', flags: {} }).settings[0];
  assert.equal(p.href, '#settings/presets');
  assert.deepEqual(p.locks.map((l) => l.type), ['mode']);
  assert.equal(p.meta, 'Settings tab');
  assert.equal(p.note, 'Switch to Advanced mode');
  assert.equal(setRows('guardrails', { level: 'simple' }).settings[0].note, 'Switch to Advanced mode');
  const away = setRows('away mode', { level: 'simple' }).settings[0];
  assert.deepEqual([away.title, away.note], ['Away mode', 'Switch to Advanced mode']);
  const labels = setRows('labels', { flags: {} }).settings.find((x) => x.title === 'Labels');
  assert.equal(labels.note, 'Turn on Labs: Run labels');
  assert.equal(setRows('cost tags', { flags: {} }).settings.find((x) => x.title === 'Cost tags').note, '', 'Cost tags left Labs');
  assert.deepEqual(setRows('marketplace', { level: 'simple', flags: {} }).addons[0].locks, [], 'A-9: add-ons never lock');
});

test('group limits: Settings ≤ SETTINGS_LIMIT (5), Add-ons ≤ ADDON_LIMIT (4)', () => {
  assert.deepEqual([SETTINGS_LIMIT, ADDON_LIMIT], [5, 4]);
  assert.equal(setRows('a').settings.length, SETTINGS_LIMIT, '"a" matches more than five settings');
  assert.equal(setRows('s').addons.length, ADDON_LIMIT);
});

test('#948 s2 chatRows: at most 5 of 7; an archived chat reads "Archived · time"; the snippet is the sub line; #chat/ID', () => {
  const now = new Date(2026, 9, 25, 12, 0, 0).getTime();
  const at = (d) => new Date(now - d * 864e5).toISOString();
  const threads = Array.from({ length: 7 }, (_, i) => ({ id: `ask_0000000${i}`, title: `Chat ${i}`, updatedAt: at(i + 1), archived: false }));
  threads[0] = { ...threads[0], archived: true, archivedAt: at(1) };
  threads[1] = { ...threads[1], match: { snippet: '…a login form…' } };
  threads[2] = { ...threads[2], title: null };
  const rows = chatRows(threads, { now });
  assert.equal(CHAT_LIMIT, 5);
  assert.equal(rows.length, 5);
  assert.match(rows[0].meta, /^Archived · /);
  assert.equal(rows[1].sub, '…a login form…');
  assert.equal(rows[1].meta, 'Fri');
  assert.equal(rows[2].title, 'New chat');
  assert.deepEqual([rows[3].kind, rows[3].href, rows[3].sub], ['chat', '#chat/ask_00000003', '']);
});

test('chatRows: a chat found by its group name reads "Group · NAME"', () => {
  const [r] = chatRows([{ id: 'ask_00000001', title: 'Fix the login', updatedAt: new Date().toISOString(), match: { group: 'Release prep' } }]);
  assert.equal(r.sub, 'Group · Release prep');
});
