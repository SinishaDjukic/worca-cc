// test/ui-log-filter-node-axis.test.mjs
// P6b — the shared log-filter bar on a v2 (graph) run: the `.log-f-step` select
// re-purposed as the node select, the `.log-f-exec` execution chip, and the ONE
// setter behind a footer-row click (applyRunLogFilter) on the run page's Logs tab
// and the History detail. Own boot idiom (a copy of
// test/ui-subagent-cycle-split.test.mjs:11-26) plus a WebSocket driver for the
// Running detail and a fetch-armed History detail (the arm order is the one
// test/ui-history-graph-log-link.test.mjs:200-215 documents as load-bearing).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);
const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECT = '/tmp/proj';

async function boot({ fetchHandler = null } = {}) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  let lastWs = null;
  window.WebSocket = class { constructor() { this.readyState = 1; this._listeners = {}; lastWs = this; } send() {} close() {} addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); } };
  window.fetch = (u, opts) => {
    if (fetchHandler) { const r = fetchHandler(String(u), opts || {}); if (r) return r; }
    return String(u).includes('/api/projects')
      ? Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] }) })
      : Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  (lastWs._listeners.open || []).forEach((fn) => fn());
  const recv = (obj) => (lastWs._listeners.message || []).forEach((fn) => fn({ data: JSON.stringify(obj) }));
  return { window, recv };
}
const settle = async (n = 4) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const go = (window, hash) => { window.location.hash = hash; window.dispatchEvent(new window.Event('hashchange')); };
const click = (window, el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const change = (window, el) => el.dispatchEvent(new window.Event('change', { bubbles: true }));
const $ = (window, sel) => window.document.querySelector(sel);
const lines = (root) => [...root.querySelectorAll('.log .log-line')].map((n) => n.textContent);

// ── fixtures ────────────────────────────────────────────────────────────────
// A real-shaped v2 manifest (buildGraphManifest's node/wire cells): when P6a's
// graph renderer is present it mounts this on the History/Running hosts, so the
// cells carry everything the shared view reads (ports, x/y, colour).
const agent = (id, key, label, color) => ({ id, kind: 'agent', key, label, color, x: 0, y: 0, uiPhase: key,
  ports: { inputs: [{ id: 'task', type: 'md', required: true, loop: false, expands: false }], outputs: [{ id: 'out', type: 'md', when: 'always' }], await: true } });
const MANIFEST = { version: 2, template: { id: 'wf_t', name: 'T' }, graph: {
  nodes: [agent('n_a', 'planner', 'Planner', 'violet'), agent('n_b', 'implementer', 'Implementer', 'peach'),
    { id: 'n_end', kind: 'end', key: null, label: 'End', x: 0, y: 0, uiPhase: 'end',
      ports: { inputs: [{ id: 'result', type: 'any', required: true, loop: false, expands: false }], outputs: [], await: false } }],
  wires: [{ id: 'w1', from: { node: 'n_a', port: 'out' }, to: { node: 'n_b', port: 'task' }, loop: false },
    { id: 'w2', from: { node: 'n_b', port: 'out' }, to: { node: 'n_end', port: 'result' }, loop: false }] } };
const row = (id, nodeId, ordinal, over = {}) => ({ key: id, executionId: id, nodeId, kind: 'cycle', ordinal, cycle: ordinal,
  status: 'done', activeMs: 1, runningSince: null, trigger: { wireIds: [], freshPorts: [] }, ...over });
// Today's bookend shape (key only, no executionId) + a loop (two Planner rows) + a task slice.
const STEPS = [
  { key: 'preflight', phase: 'preflight', cycle: 0, status: 'done', activeMs: 5, runningSince: null },
  row('x:n_a:1', 'n_a', 1), row('x:n_a:2', 'n_a', 2), row('x:n_b:1', 'n_b', 1),
  row('x:n_b:1:p1t2', 'n_b', 1, { kind: 'task', title: 'Add schema', parentExecutionId: 'x:n_b:1' }),
];
// The engine's v2 log shape: attributed lines carry nodeId + executionId + cycle (= ordinal); preflight carries none.
const LINES = [
  { source: 'preflight', level: 'info', text: 'checks', ts: 1 },
  { source: 'planner', level: 'info', text: 'first pass', ts: 2, nodeId: 'n_a', executionId: 'x:n_a:1', cycle: 1 },
  { source: 'planner', level: 'info', text: 'second pass', ts: 3, nodeId: 'n_a', executionId: 'x:n_a:2', cycle: 2 },
  { source: 'implementer', level: 'info', text: 'building', ts: 4, nodeId: 'n_b', executionId: 'x:n_b:1:p1t2', cycle: 1 },
];

// A registered run with the manifest, the ledger and (optionally) the lines
// already arrived, opened on its run page's Logs tab (the Running list card no
// longer carries a log or a filter bar). Returns the `.rd-sec-logs` pane.
async function liveRun(ctx, { id = 'r1', withLines = true } = {}) {
  const { window, recv } = ctx;
  const np = window.__np;
  recv({ type: 'hello', runs: [{ runId: id, title: id, projectDir: PROJECT, status: 'running', kind: 'run', startedAt: '10:00:00', pendingQuestion: null }] });
  await settle();
  const r = np.getRun(id);
  np.onState(r, { status: 'running', stepper: MANIFEST, active: [], steps: STEPS });
  if (withLines) for (const l of LINES) np.onLog(r, l);
  go(window, `running/${id}/details/logs`);   // Details › Live log (the glance is the default)
  await settle();
  const sec = $(window, '#run-detail .rd-sec-logs');
  assert.ok(sec, 'the run page has its Live log tab');
  return { np, r, sec };
}

// ── the run page's Logs tab ─────────────────────────────────────────────────

test('the live record keeps executionId, and the Logs bar re-purposes the step select as the node select', async () => {
  const ctx = await boot();
  const { np, r, sec } = await liveRun(ctx);
  assert.deepEqual(r.logLines.map((l) => l.executionId), [undefined, 'x:n_a:1', 'x:n_a:2', 'x:n_b:1:p1t2']);
  const sel = sec.querySelector('.log-f-step');
  assert.equal(sel.dataset.axis, 'node');
  assert.equal(sel.getAttribute('aria-label'), 'Filter by node');
  assert.deepEqual([...sel.options].map((o) => o.textContent), ['all nodes', 'Planner', 'Implementer']);
  sel.value = 'n_a';
  assert.equal(np.readLogFilterFrom(sec).node, 'n_a');
  assert.equal(np.readLogFilterFrom(sec).step, '', 'the step axis is empty in node mode');
  assert.equal(sec.querySelector('.log-f-exec').hidden, true, 'the chip ships hidden');
  assert.equal(np.readLogFilterFrom(sec).execution, '');
  // A node that first logs AFTER the tab is open: the node facet key is the ONLY
  // thing that can rebuild the dropdowns (source, level and cycle were seen before).
  np.onLog(r, { source: 'planner', level: 'info', text: 'bound', ts: 5, nodeId: 'n_end', executionId: 'x:n_end:1', cycle: 1 });
  assert.deepEqual([...sel.options].map((o) => o.textContent), ['all nodes', 'Planner', 'Implementer', 'End']);
});

test('applyRunLogFilter narrows the Logs tab to one execution and paints the chip; the chip click clears it', async () => {
  const ctx = await boot();
  const { window } = ctx;
  const { np, r, sec } = await liveRun(ctx);
  np.applyRunLogFilter(r, { execution: 'x:n_a:2', node: 'n_a' });
  const chip = sec.querySelector('.log-f-exec');
  assert.equal(chip.hidden, false);
  assert.equal(chip.querySelector('.lfe-text').textContent, 'Planner #2');
  assert.equal(chip.dataset.executionId, 'x:n_a:2');
  assert.equal(sec.querySelector('.log-f-step').value, 'n_a', 'the node select follows the patch');
  assert.equal(np.readLogFilterFrom(sec).execution, 'x:n_a:2');
  assert.deepEqual(lines(sec).map((t) => /second pass/.test(t)), [true], 'one execution → one line');
  click(window, chip.querySelector('.lfe-x'));
  assert.equal(chip.hidden, true);
  assert.equal(r.logFilter.execution, '');
  assert.equal(np.readLogFilterFrom(sec).execution, '');
  assert.equal(lines(sec).length, 2, 'back to the node axis: both Planner lines');
});

test('a task slice names its title on the chip; a row is matched by executionId only, never by key', async () => {
  const ctx = await boot();
  const { np, r, sec } = await liveRun(ctx);
  np.applyRunLogFilter(r, { execution: 'x:n_b:1:p1t2', node: 'n_b' });
  assert.equal(sec.querySelector('.log-f-exec .lfe-text').textContent, 'Implementer #1 · Add schema');
  np.applyRunLogFilter(r, { execution: 'x:n_zz:9', node: '' });
  assert.equal(sec.querySelector('.log-f-exec .lfe-text').textContent, 'x:n_zz:9', 'an unknown execution shows its id');
  assert.equal(np.executionChipText({ steps: [{ key: 'x:n_a:2', nodeId: 'n_a', ordinal: 2 }], stepper: MANIFEST }, 'x:n_a:2'),
    'x:n_a:2', 'a key-only row (no executionId) is not the execution');
});

test('a manual node or cycle pick on the Logs bar clears the execution chip and keeps the pick', async () => {
  const ctx = await boot();
  const { window } = ctx;
  const { np, r, sec } = await liveRun(ctx);
  np.applyRunLogFilter(r, { execution: 'x:n_a:2', node: 'n_a' });
  const sel = sec.querySelector('.log-f-step');
  sel.value = 'n_b';
  change(window, sel);
  assert.equal(r.logFilter.execution, '', 'the manual pick cleared the execution axis');
  assert.equal(r.logFilter.node, 'n_b', 'and the pick itself survived the chip repaint');
  assert.equal(sec.querySelector('.log-f-exec').hidden, true);
  assert.equal(sel.value, 'n_b');
  assert.deepEqual(lines(sec).map((t) => /building/.test(t)), [true]);
  // A level pick is not a broader pick: it leaves the chip alone.
  np.applyRunLogFilter(r, { execution: 'x:n_a:2', node: 'n_a' });
  const lvl = sec.querySelector('.log-f-level');
  lvl.value = 'info';
  change(window, lvl);
  assert.equal(r.logFilter.execution, 'x:n_a:2');
  assert.equal(sec.querySelector('.log-f-exec').hidden, false);
});

test('node-axis repaint rules: a pre-P6 filter literal does not force a repaint every paint; a not-yet-produced node pick keeps the axis across paints', async () => {
  const ctx = await boot();
  await checkRows([
    { name: 'a pre-P6 filter literal (no node/execution keys) does not force a repaint on every paint', run: async () => {
      const { np, r, sec } = await liveRun(ctx);
      r.logFilter = { source: '', level: '', step: '', cycle: '', search: '' };
      assert.equal(np.paintLogFilters(r, sec), false);
    } },
    // P6a seam (found by the merged-tree CDP run): the footer rows a click comes from
    // are painted from the LEDGER, while facets.nodes comes from r.logLines. A pick on
    // a node that has not logged yet must keep the node axis and offer its own option,
    // or readLogFilterFrom reads `node: ''` back and the reconcile wipes the pick.
    { name: 'a node pick that the log has not produced yet keeps the node axis and survives the next paint', run: async () => {
      const { np, r, sec } = await liveRun(ctx, { id: 'r9', withLines: false });
      assert.deepEqual(r.logLines, [], 'no line has arrived: facets.nodes is empty');

      np.applyRunLogFilter(r, { node: 'n_a' });
      const sel = sec.querySelector('.log-f-step');
      assert.equal(sel.dataset.axis, 'node', 'the axis stays on nodes for a pending pick');
      assert.deepEqual([...sel.options].map((o) => o.textContent), ['all nodes', 'Planner'],
        'the picked node is injected as its own option (same honesty as History __setLogFilter)');
      assert.equal(sel.value, 'n_a');
      assert.equal(np.readLogFilterFrom(sec).node, 'n_a', 'so the DOM can represent the model value');
      np.paintLogFilters(r, sec);
      assert.equal(r.logFilter.node, 'n_a', 'a second paint does not wipe the pick');
    } },
  ]);
});

// ── the History detail ──────────────────────────────────────────────────────

const KEY = 'proj-alpha-abcd1234';
const ID = 'fcec04e8';
const DETAIL_URL = `/api/history/${KEY}/${ID}`;
const ROW = { id: ID, projectKey: KEY, projectName: 'Alpha', projectDir: PROJECT, title: 'Add the thing', status: 'done',
  startedAt: '2026-08-18T10:00:00Z', branch: 'worca-cc/thing-fcec04e8', sourceBranch: 'master', mtime: 1, pauseReason: null, retainedWork: null };
const DETAIL = {
  state: { id: ID, title: ROW.title, status: 'done', startedAt: ROW.startedAt, stepper: MANIFEST, steps: STEPS, subAgents: [],
    engine: 2, active: [], endReached: true, result: { type: 'void' }, warnings: [], wireDeliveries: {}, tokens: {}, gate: null,
    branch: { source: 'master', feature: ROW.branch, worktreeDir: '/tmp/wt' }, prompt: 'Add the thing.' },
  results: null, overview: null, clarify: { questions: [], answers: [] }, reviews: [], stepQuestions: [],
  artifacts: [{ kind: 'live-log', relPath: 'live-log.ndjson' }], auditMarkdown: '# saved',
};
const NDJSON = LINES.map((l) => JSON.stringify({ ...l, ts: '2026-08-18T10:00:00Z' })).join('\n');
const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
const okText = (body) => Promise.resolve({ ok: true, status: 200, text: async () => body });
const DAY = 86400000;
const BUDGET = { pipelineLimitUsd: 5, totalLimitUsd: 50, resetPeriod: 'monthly', windowStartMs: Date.now() - 3 * DAY,
  windowEndMs: Date.now() + 4 * DAY, msUntilReset: 4 * DAY, windowSpendUsd: 12.5, allTimeSpendUsd: 12.5, remainingUsd: 37.5, blocked: false };
function historyArms({ detail = () => ok(DETAIL) } = {}) {
  return (url) => {
    if (url.endsWith('/api/history/pr')) return ok({ ok: true });
    if (url.endsWith('/diff')) return Promise.resolve({ ok: false, status: 404, json: async () => ({ error: 'no diff' }) });
    if (url.endsWith('/log')) return okText(NDJSON);
    if (url.endsWith('/api/history')) return ok({ pipelines: [ROW], ghAvailable: false });
    if (url.endsWith(DETAIL_URL)) return detail();
    if (url.endsWith('/api/budget')) return ok(BUDGET);
    return null;
  };
}
async function openHistory(opts) {
  const ctx = await boot({ fetchHandler: historyArms(opts) });
  go(ctx.window, `history/${KEY}/${ID}`);
  await settle(6);
  return ctx;
}
async function openLogsTab(window) {
  click(window, $(window, '#hist-detail .hd-tab[data-sec="logs"]'));
  await settle(4);
  return $(window, '#hist-detail .hd-sec[data-sec="logs"]');
}

// Each row opens its own History boot: the parked-intent row needs a Logs tab nobody built yet.
test('History Logs: manifest labels on the node select, __setLogFilter drives node + chip (cleared by chip/manual pick), and an intent parked before the fetch drains exactly once', async () => {
  await checkRows([
    { name: 'History Logs: manifest labels on the node select; __setLogFilter drives node + chip; chip click and a manual pick clear it', run: async () => {
      const { window } = await openHistory();
      const sec = await openLogsTab(window);
      const sel = sec.querySelector('.log-f-step');
      assert.equal(sel.dataset.axis, 'node');
      assert.deepEqual([...sel.options].map((o) => o.textContent), ['all nodes', 'Planner', 'Implementer']);
      assert.equal(lines(sec).length, 4);
      sec.__setLogFilter({ node: 'n_a' });
      assert.equal(sel.value, 'n_a');
      assert.equal(lines(sec).length, 2);
      sec.__setLogFilter({ execution: 'x:n_a:2' });
      const chip = sec.querySelector('.log-f-exec');
      assert.equal(chip.hidden, false);
      assert.equal(chip.querySelector('.lfe-text').textContent, 'Planner #2', 'the chip reads the saved ledger');
      assert.deepEqual(lines(sec).map((t) => /second pass/.test(t)), [true]);
      click(window, chip.querySelector('.lfe-x'));
      assert.equal(chip.hidden, true);
      assert.equal(lines(sec).length, 2, 'the node axis survives the chip clear');
      sec.__setLogFilter({ execution: 'x:n_a:2' });
      sel.value = 'n_b';
      change(window, sel);
      assert.equal(chip.hidden, true, 'a manual node pick clears the chip');
      assert.equal(sel.value, 'n_b', 'and the pick survives');
      assert.deepEqual(lines(sec).map((t) => /building/.test(t)), [true]);
      // A node the run never logged under is offered (once) so the empty pane reads honestly.
      sec.__setLogFilter({ node: 'n_end' });
      sec.__setLogFilter({ node: 'n_end' });
      assert.equal([...sel.options].filter((o) => o.value === 'n_end').length, 1);
      assert.equal(sel.value, 'n_end');
      assert.equal(sec.querySelector('.log').textContent, '(no lines match the filter)');
    } },
    { name: 'History Logs: a filter intent parked before the fetch is drained after the first paint, exactly once', run: async () => {
      const { window } = await openHistory();
      const sec = $(window, '#hist-detail .hd-sec[data-sec="logs"]');
      assert.equal(sec.dataset.loaded, undefined, 'the Logs tab starts unbuilt');
      sec.__pendingLogFilter = { node: 'n_b' };
      click(window, $(window, '#hist-detail .hd-tab[data-sec="logs"]'));
      await settle(4);
      assert.equal(sec.querySelector('.log-f-step').value, 'n_b');
      assert.deepEqual(lines(sec).map((t) => /building/.test(t)), [true]);
      assert.equal(sec.__pendingLogFilter, null);
    } },
  ]);
});

test('History graph: a v2 card (.node[data-node-id]) is a labelled link whose click opens its log in the drawer under the workflow; Open in Logs opens the Logs tab on that node', async () => {
  let release = null;
  const held = new Promise((res) => { release = res; });
  const { window } = await boot({ fetchHandler: historyArms({ detail: () => held.then(() => ok(DETAIL)) }) });
  go(window, `history/${KEY}/${ID}`);
  // openHistDetail mounts the screen synchronously; the painter is parked on the
  // detail fetch. Plant a v2 card the way P6a's renderer stamps one, THEN let the
  // fetch land so wireHdGraphLogLinks' a11y pass sees it.
  const graph = $(window, '#hist-detail .hd-graph');
  const card = window.document.createElement('div');
  card.className = 'node node-agent run-node';
  card.dataset.nodeId = 'n_a';
  card.dataset.id = 'n_a';
  card.innerHTML = '<div class="nhead"><span class="tt">Planner</span></div>';
  graph.appendChild(card);
  release();
  await settle(6);
  assert.equal(card.getAttribute('role'), 'link');
  assert.equal(card.tabIndex, 0);
  assert.equal(card.getAttribute('aria-label'), 'Show the log of Planner below the workflow');
  const sec = $(window, '#hist-detail .hd-sec[data-sec="logs"]');
  assert.equal(sec.dataset.loaded, undefined, 'the Logs tab starts unbuilt (parked-intent path)');
  // The drawer follows the Logs tab's level: History Logs is Expert, so Advanced gets nothing.
  const level = window.document.documentElement.dataset.level;
  window.document.documentElement.dataset.level = 'advanced';
  click(window, card);
  await settle(2);
  assert.equal($(window, '#hist-detail .wf-log-drawer'), null, 'no drawer below the Logs tab level');
  window.document.documentElement.dataset.level = 'expert';
  click(window, card);
  await settle(4);
  if (level === undefined) delete window.document.documentElement.dataset.level;
  else window.document.documentElement.dataset.level = level;
  const drawer = $(window, '#hist-detail .hd-sec[data-sec="workflow"] .wf-log-drawer');
  assert.ok(drawer && !drawer.hidden, 'the drawer opens under the workflow');
  assert.equal(drawer.querySelector('.wf-log-title').textContent, 'Planner');
  assert.equal(lines(drawer).length, 2, "only Planner's lines");
  const marked = [...window.document.querySelectorAll('#hist-detail .hd-graph [aria-current="true"]')];
  assert.deepEqual(marked.map((n) => n.dataset.nodeId), ['n_a'], 'the card it shows is marked, and only it');
  assert.ok(!$(window, '#hist-detail .hd-tab[data-sec="logs"]').classList.contains('active'), 'the page stays on the graph');
  assert.equal(sec.dataset.loaded, undefined, 'the Logs tab is untouched');
  click(window, drawer.querySelector('.wf-log-full'));
  await settle(4);
  assert.ok($(window, '#hist-detail .hd-tab[data-sec="logs"]').classList.contains('active'));
  assert.equal(sec.querySelector('.log-f-step').value, 'n_a');
  assert.equal(lines(sec).length, 2);
  assert.equal(sec.__pendingLogFilter, null);
});
