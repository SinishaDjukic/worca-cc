// test/source-pane.test.mjs — jsdom tests for the pluggable New-Pipeline source
// pane. `call` is a fake (no network); the debounce clock is injected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  renderSourcePane, collectSourcePane, debounce, formatUpdated, renderProfileGate, renderProfileBar,
} from '../ui/public/source-pane.mjs';

const win = new JSDOM('<!doctype html><body></body>').window;
const doc = win.document;

const SOURCE = {
  type: 'plugin', plugin: 'github-source', sourceId: 'github', displayName: 'GitHub Issues',
  inputs: [
    { key: 'repo', type: 'remote-select', label: 'Repository', optionsFrom: 'listRepos', options: [], default: null },
    { key: 'filter', type: 'text', label: 'Filter', default: 'assignee:@me state:open', options: [], optionsFrom: null },
    { key: 'kind', type: 'select', label: 'Kind', options: ['issue', 'pr'], default: 'issue', optionsFrom: null },
    { key: 'task', type: 'task-browser', label: 'Issue', options: [], optionsFrom: null, default: null },
  ],
};

// Manual clock for the injected-timers seam: debounce schedules into a map;
// flush() runs whatever survived clearTimeout.
function manualTimers() {
  const timers = new Map();
  let seq = 0;
  return {
    setTimeout: (fn) => { const id = ++seq; timers.set(id, fn); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    flush: () => { const fns = [...timers.values()]; timers.clear(); fns.forEach((f) => f()); },
  };
}

test('renders all 4 input types in schema order; remote-select loads lazily, once', async () => {
  const calls = [];
  const call = async (op, args) => {
    calls.push([op, args]);
    return op === 'listRepos' ? [{ value: 'o/r', label: 'o/r' }] : { tasks: [] };
  };
  const pane = renderSourcePane(SOURCE, { call, doc });
  assert.equal(pane.querySelectorAll('.field').length, 4);
  const remote = pane.querySelector('select.sp-remote[data-input-key="repo"]');
  assert.ok(remote, 'remote-select renders a dropdown');
  assert.equal(pane.querySelector('input[data-input-key="filter"]').value, 'assignee:@me state:open');
  assert.equal(pane.querySelector('select[data-input-key="kind"]').value, 'issue');
  const tb = pane.querySelector('.sp-task-browser[data-input-key="task"]');
  assert.ok(tb.querySelector('.sp-search') && tb.querySelector('.sp-results')
    && tb.querySelector('.sp-preview') && tb.querySelector('.sp-task-id'));
  // Lazy population applies to the remote-select: it must NOT fetch its options
  // until focused. The task list is different — it loads once on render so the
  // browser isn't blank before the user types.
  await pane._initial;
  assert.equal(calls.filter(([op]) => op === 'listRepos').length, 0);
  assert.deepEqual(calls.filter(([op]) => op === 'listTasks').map(([, a]) => a.search), ['']);
  remote.dispatchEvent(new win.Event('focus'));
  remote.dispatchEvent(new win.Event('focus'));
  await remote._load;
  assert.equal(calls.filter(([op]) => op === 'listRepos').length, 1);
  assert.equal(remote.querySelector('option').value, 'o/r');
});

test('debounce coalesces rapid input into one trailing call', () => {
  const clock = manualTimers();
  const got = [];
  const d = debounce((v) => got.push(v), 300, clock);
  d('a'); d('ab'); d('abc');
  assert.equal(got.length, 0, 'nothing fires before the delay');
  clock.flush();
  assert.deepEqual(got, ['abc'], 'only the last invocation survives');
});

test('search -> pick a row: taskId set, preview rendered, collect round-trips', async () => {
  const clock = manualTimers();
  const call = async (op, args) => {
    if (op === 'listTasks') {
      assert.equal(args.search, 'flaky');           // debounced search text reaches the op
      return { tasks: [{ id: 'o/r#7', title: 'Fix the flaky test', labels: ['bug'], updatedAt: '2026-07-01T10:00:00Z', state: 'open' }] };
    }
    if (op === 'getTask') return { id: args.id, title: 'Fix the flaky test', body: 'It fails on CI only.', state: 'open', updatedAt: '' };
    return null;
  };
  const pane = renderSourcePane(SOURCE, {
    call, doc, timers: clock, now: () => Date.parse('2026-07-04T10:00:00Z'),
  });
  const search = pane.querySelector('.sp-search');
  search.value = 'flaky';
  search.dispatchEvent(new win.Event('input'));
  clock.flush();                                     // fire the debounced listTasks
  await new Promise((r) => setTimeout(r, 0));        // let the async render land
  const row = pane.querySelector('.sp-row');
  assert.ok(row, 'result row renders');
  assert.match(row.textContent, /Fix the flaky test/);
  assert.match(row.textContent, /bug/);              // labels
  assert.match(row.textContent, /updated 3d ago/);   // updatedAt, humanised
  row.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const preview = pane.querySelector('.sp-preview');
  await preview._load;
  assert.ok(row.classList.contains('sel'), 'picked row is highlighted');
  assert.equal(preview.hidden, false);
  assert.match(preview.textContent, /It fails on CI only\./);
  const picked = collectSourcePane(pane);
  assert.equal(picked.error, undefined);
  assert.equal(picked.taskId, 'o/r#7');
  assert.deepEqual(picked.inputs, { repo: '', filter: 'assignee:@me state:open', kind: 'issue' });
});

test('editing a filter input re-runs the listing with the new value', async () => {
  const clock = manualTimers();
  const seen = [];
  const call = async (op, args) => {
    if (op === 'listTasks') { seen.push(args.inputs.filter); return { tasks: [] }; }
    return null;
  };
  const pane = renderSourcePane(SOURCE, { call, doc, timers: clock });
  await pane._initial;
  seen.length = 0;

  // Typing a filter must take effect on its own — before this, only the search
  // box re-queried, so a typed filter looked like it was being ignored.
  const filter = pane.querySelector('input[data-input-key="filter"]');
  filter.value = 'label:urgent';
  filter.dispatchEvent(new win.Event('input'));
  clock.flush();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(seen, ['label:urgent']);

  // <select> fires 'change'; the shared debounce collapses any duplicate.
  const kind = pane.querySelector('select[data-input-key="kind"]');
  kind.value = 'pr';
  kind.dispatchEvent(new win.Event('change'));
  clock.flush();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(seen.length, 2);
});

test('empty results: "Type to search." with nothing asked for, "No tasks matched." otherwise', async () => {
  const clock = manualTimers();
  const doc2 = new JSDOM('<!doctype html><body></body>').window.document;
  const bare = { ...SOURCE, inputs: [
    { key: 'filter', type: 'text', label: 'Filter', default: null, options: [], optionsFrom: null },
    { key: 'task', type: 'task-browser', label: 'Issue', options: [], optionsFrom: null, default: null },
  ] };
  const pane = renderSourcePane(bare, { call: async () => ({ tasks: [] }), doc: doc2, timers: clock });
  await pane._initial;
  assert.match(pane.querySelector('.sp-results').textContent, /Type to search\./);

  await pane._search('flaky');
  assert.match(pane.querySelector('.sp-results').textContent, /No tasks matched\./);
});

test('formatUpdated: relative while recent, absolute past a week, hover keeps full precision', () => {
  const now = Date.parse('2026-07-31T12:00:00Z');
  const at = (ms) => formatUpdated(new Date(now - ms).toISOString(), now).text;
  assert.equal(at(5_000), 'just now');
  assert.equal(at(12 * 60_000), '12m ago');
  assert.equal(at(5 * 3600_000), '5h ago');
  assert.equal(at(3 * 86400_000), '3d ago');
  assert.equal(at(-60_000), 'just now');                       // clock skew, not "in 1 minute"

  // Past a week: a date, and the year only when it isn't the current one.
  const thisYear = formatUpdated('2026-05-28T08:47:54.000Z', now);
  assert.match(thisYear.text, /28/);
  assert.doesNotMatch(thisYear.text, /2026/);
  assert.match(formatUpdated('2025-05-28T08:47:54.000Z', now).text, /2025/);
  assert.match(thisYear.title, /2026/);                        // hover is always full precision
  assert.equal(formatUpdated('not a date', now).text, 'not a date');
});

test('task rows label the timestamp as "updated" and carry the exact value', async () => {
  const clock = manualTimers();
  const doc2 = new JSDOM('<!doctype html><body></body>').window.document;
  const call = async () => ({ tasks: [{
    id: 'PROJ-1', title: 'Fix Login Session Cache for REST Service',
    labels: ['backend'], updatedAt: '2026-05-28T08:47:54.000Z', state: 'open',
  }] });
  const pane = renderSourcePane(SOURCE, {
    call, doc: doc2, timers: clock, now: () => Date.parse('2026-07-31T12:00:00Z'),
  });
  await pane._initial;
  const el = pane.querySelector('.sp-updated');
  assert.match(el.textContent, /^updated /, 'a bare date would leave created-vs-updated ambiguous');
  assert.match(el.title, /^Updated /);
  assert.equal(el.dataset.updatedAt, '2026-05-28T08:47:54.000Z');
  assert.doesNotMatch(el.textContent, /T08:47|\.000Z/, 'raw ISO no longer leaks into the row');
});

test('task rows show the id ahead of the title, without disturbing the row layout', async () => {
  const clock = manualTimers();
  const doc2 = new JSDOM('<!doctype html><body></body>').window.document;
  const call = async () => ({ tasks: [
    { id: 'PROJ-42', title: 'Fix Login Session Cache for REST Service', labels: [], updatedAt: '', state: 'open' },
    // Trackers that already prefix the key must not render it twice.
    { id: 'PROJ-43', title: 'PROJ-43 Already prefixed', labels: [], updatedAt: '', state: 'open' },
  ] });
  const pane = renderSourcePane(SOURCE, { call, doc: doc2, timers: clock });
  await pane._initial;
  const [a, b] = pane.querySelectorAll('.sp-row');

  assert.equal(a.querySelector('.sp-key').textContent, 'PROJ-42');
  assert.match(a.querySelector('.sp-row-title').textContent, /^PROJ-42Fix Login/);
  assert.equal(a.dataset.taskId, 'PROJ-42', 'picking still round-trips the raw id');
  // .sp-row is a space-between flex; a third child would spread the row apart.
  assert.equal(a.children.length, 2);

  assert.equal(b.querySelector('.sp-key'), null, 'id already in the title -> not repeated');
  assert.equal(b.querySelector('.sp-row-title').textContent, 'PROJ-43 Already prefixed');
});

test('collect errors when no task is picked', () => {
  const pane = renderSourcePane(SOURCE, { call: async () => null, doc });
  assert.match(collectSourcePane(pane).error, /Pick a task/);
});

// ── profile gate ───────────────────────────────────────────────────────────────
// A multi-profile source cannot list anything until it is known WHICH instance
// to ask. The gate is deliberately a one-time choice bound to the project
// rather than a per-run dropdown: a dropdown is how you start a pipeline
// against the wrong tracker, and the mistake is invisible until the run is
// already underway.
const JIRA = { plugin: 'jira-source', sourceId: 'jira', displayName: 'Jira (jtr)' };
const PROFILES = [{ id: 'acme', label: 'Acme' }, { id: 'globex', label: null }];

test('profile gate: unbound project offers the roster and binds what was picked', async () => {
  const doc2 = new JSDOM('<!doctype html><body></body>').window.document;
  const picked = [];
  const gate = renderProfileGate(
    { source: JIRA, profiles: PROFILES, via: 'none', scopeLabel: 'worca-cc' },
    { doc: doc2, onPick: (p) => { picked.push(p); } },
  );
  const sel = gate.querySelector('.sp-profile-sel');
  assert.deepEqual([...sel.options].map((o) => o.value), ['acme', 'globex']);
  assert.match(gate.textContent, /worca-cc/, 'says WHICH project is being bound');
  sel.value = 'globex';
  gate.querySelector('.sp-profile-use').click();
  assert.deepEqual(picked, ['globex']);
});

test('profile gate: a workspace whose projects disagree names the candidates', () => {
  const doc2 = new JSDOM('<!doctype html><body></body>').window.document;
  const gate = renderProfileGate(
    { source: JIRA, profiles: PROFILES, via: 'conflict', candidates: ['acme', 'globex'], scopeLabel: 'ws-1' },
    { doc: doc2, onPick: () => {} },
  );
  // Guessing one of them is the exact silent-wrong-tracker bug; say so instead.
  assert.match(gate.textContent, /acme/);
  assert.match(gate.textContent, /globex/);
  assert.match(gate.textContent, /disagree|differ|conflict/i);
});

// Once bound, the choice stays ON SCREEN. Hiding it after the first answer is
// how you end up reading the wrong tracker without noticing — the bar is the
// standing answer to "which instance am I about to pull from". Changing it
// REBINDS the project (persistent), which is what keeps it from degenerating
// into the per-run dropdown the gate exists to avoid.
test('profile bar: always shows the roster with the active profile selected', () => {
  const doc2 = new JSDOM('<!doctype html><body></body>').window.document;
  const picked = [];
  const bar = renderProfileBar(
    { source: JIRA, profiles: PROFILES, profile: 'globex', via: 'binding', scopeLabel: 'worca-cc' },
    { doc: doc2, onChange: (p) => picked.push(p) },
  );
  const sel = bar.querySelector('.sp-profile-sel');
  assert.deepEqual([...sel.options].map((o) => o.value), ['acme', 'globex']);
  assert.equal(sel.value, 'globex', 'the bound profile is the selected one');
  sel.value = 'acme';
  sel.dispatchEvent(new doc2.defaultView.Event('change'));
  assert.deepEqual(picked, ['acme'], 'switching rebinds rather than just filtering this run');
});

test('profile bar: says HOW the profile was resolved, so an inherited one is not mistaken for a choice', () => {
  const doc2 = new JSDOM('<!doctype html><body></body>').window.document;
  const only = renderProfileBar({ source: JIRA, profiles: [PROFILES[0]], profile: 'acme', via: 'only' }, { doc: doc2 });
  assert.match(only.textContent, /only profile/i);
  const members = renderProfileBar({ source: JIRA, profiles: PROFILES, profile: 'acme', via: 'members' }, { doc: doc2 });
  assert.match(members.textContent, /member|project/i);
});

test('profile bar: a roster that grew in settings is reflected without a reload', () => {
  // The bar is re-rendered from the /api/sources roster, so a profile added (or
  // removed) in Plugins settings shows up here as soon as that list refreshes.
  const doc2 = new JSDOM('<!doctype html><body></body>').window.document;
  const before = renderProfileBar({ source: JIRA, profiles: PROFILES, profile: 'acme', via: 'binding' }, { doc: doc2 });
  assert.equal(before.querySelectorAll('.sp-profile-sel option').length, 2);
  const after = renderProfileBar({
    source: JIRA, profiles: [...PROFILES, { id: 'third', label: 'Third' }], profile: 'acme', via: 'binding',
  }, { doc: doc2 });
  assert.deepEqual([...after.querySelectorAll('.sp-profile-sel option')].map((o) => o.value), ['acme', 'globex', 'third']);
});

test('profile gate: no profiles at all points at Plugins settings, not an empty picker', () => {
  const doc2 = new JSDOM('<!doctype html><body></body>').window.document;
  const gate = renderProfileGate({ source: JIRA, profiles: [], via: 'none' }, { doc: doc2, onPick: () => {} });
  assert.equal(gate.querySelector('.sp-profile-use'), null, 'nothing to pick, so no confirm button');
  assert.ok(gate.querySelector('.sp-profile-settings'), 'the way out is creating a profile');
});
