// test/source-pane.test.mjs — jsdom tests for the pluggable New-Pipeline source
// pane. `call` is a fake (no network); the debounce clock is injected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderSourcePane, collectSourcePane, debounce } from '../ui/public/source-pane.mjs';

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
  // Lazy population: nothing fetched at render; first focus fetches; second is a no-op.
  assert.equal(calls.length, 0);
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
  const pane = renderSourcePane(SOURCE, { call, doc, timers: clock });
  const search = pane.querySelector('.sp-search');
  search.value = 'flaky';
  search.dispatchEvent(new win.Event('input'));
  clock.flush();                                     // fire the debounced listTasks
  await new Promise((r) => setTimeout(r, 0));        // let the async render land
  const row = pane.querySelector('.sp-row');
  assert.ok(row, 'result row renders');
  assert.match(row.textContent, /Fix the flaky test/);
  assert.match(row.textContent, /bug/);              // labels
  assert.match(row.textContent, /2026-07-01/);       // updatedAt
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

test('collect errors when no task is picked', () => {
  const pane = renderSourcePane(SOURCE, { call: async () => null, doc });
  assert.match(collectSourcePane(pane).error, /Pick a task/);
});
