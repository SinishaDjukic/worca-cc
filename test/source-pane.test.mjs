// test/source-pane.test.mjs — jsdom tests for the pluggable New-Pipeline source
// pane. `call` is a fake (no network); the debounce clock is injected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  renderSourcePane, collectSourcePane, renderProfileGate, renderProfileBar,
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

test('a task body renders through the injected markdown seam; without it (or before it is ready) it is a verbatim <pre>', async () => {
  const clock = manualTimers();
  const call = async (op, args) => {
    if (op === 'listTasks') return { tasks: [{ id: 'o/r#7', title: 'T', labels: [], updatedAt: '', state: 'open' }] };
    if (op === 'getTask') return { id: args.id, title: 'T', body: '## Steps\n- one', state: 'open', updatedAt: '' };
    return null;
  };
  const pick = async (renderMarkdown) => {
    const pane = renderSourcePane(SOURCE, { call, doc, timers: clock, renderMarkdown });
    const search = pane.querySelector('.sp-search');
    search.value = 'x'; search.dispatchEvent(new win.Event('input'));
    clock.flush();
    await new Promise((r) => setTimeout(r, 0));
    pane.querySelector('.sp-row').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await pane.querySelector('.sp-preview')._load;
    return pane.querySelector('.sp-prev-body');
  };
  const plain = await pick(undefined);
  assert.equal(plain.tagName, 'PRE'); assert.equal(plain.textContent, '## Steps\n- one');
  const notReady = await pick(() => ({ kind: 'plain' }));
  assert.equal(notReady.tagName, 'PRE');
  const md = await pick((text) => {
    const t = doc.createElement('template');
    t.innerHTML = `<h2>${text.split('\n')[0].replace(/^##\s*/, '')}</h2><ul><li>one</li></ul>`;
    return { kind: 'md', frag: t.content };
  });
  assert.equal(md.tagName, 'DIV');
  assert.ok(md.classList.contains('artifact-markdown'));
  assert.equal(md.querySelector('h2').textContent, 'Steps');
  assert.equal(md.querySelector('li').textContent, 'one');
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

test('a slow stale listTasks response never paints over a newer search (latest wins)', async () => {
  // The debounce collapses pending timers, not in-flight fetches: the
  // mount-time empty search can resolve AFTER a fast typed search. Without a
  // sequence guard it would repaint the unfiltered list over the filtered one
  // — and the user could then pick a task that does not match their filter.
  const clock = manualTimers();
  const doc2 = new JSDOM('<!doctype html><body></body>').window.document;
  const bare = { ...SOURCE, inputs: [
    { key: 'filter', type: 'text', label: 'Filter', default: null, options: [], optionsFrom: null },
    { key: 'task', type: 'task-browser', label: 'Issue', options: [], optionsFrom: null, default: null },
  ] };
  let resolveSlow;
  const slow = new Promise((r) => { resolveSlow = r; });
  const call = async (op, args) => {
    if (op !== 'listTasks') return null;
    if (args.search === '') return slow; // the mount-time search hangs…
    return { tasks: [{ id: 'F-1', title: 'Filtered hit', labels: [], updatedAt: '', state: 'open' }] };
  };
  const pane = renderSourcePane(bare, { call, doc: doc2, timers: clock });
  await pane._search('flaky'); // …while the typed one answers immediately
  assert.match(pane.querySelector('.sp-results').textContent, /Filtered hit/);

  resolveSlow({ tasks: [{ id: 'S-1', title: 'Stale unfiltered', labels: [], updatedAt: '', state: 'open' }] });
  await pane._initial;
  assert.match(pane.querySelector('.sp-results').textContent, /Filtered hit/, 'newer results survive');
  assert.doesNotMatch(pane.querySelector('.sp-results').textContent, /Stale unfiltered/);
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

test('profile gate: a source with no profiles links the Marketplace page, where profiles are added', () => {
  const doc2 = new JSDOM('<!doctype html><body></body>').window.document;
  const link = renderProfileGate({ source: JIRA, profiles: [], via: 'none' }, { doc: doc2 }).querySelector('.sp-profile-settings');
  assert.equal(link.textContent, 'Add one on the Marketplace page');
  assert.equal(link.getAttribute('href'), '#marketplace');
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
