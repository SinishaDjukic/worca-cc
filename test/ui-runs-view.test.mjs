// test/ui-runs-view.test.mjs — the Runs page: one list (runs redesign §3.1) beside a content pane: sections, the View
// menu, rows and groups drawn from the one run model, selection, keys, the action bar, the row ⋯ menu, Add to group,
// the sidebar badge and the tab title.
// boot() / settle() / go() follow test/ui-running-routing.test.mjs (no shared harness, by convention).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';
import { auditRunsLayout } from '../tools/runs-layout-audit.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

const __dir = dirname(fileURLToPath(import.meta.url));
const htmlPath = join(__dir, '..', 'ui', 'public', 'index.html');
const appPath = join(__dir, '..', 'ui', 'public', 'app.js');
const PROJECT = '/tmp/proj';
const KEY = 'proj-0000abcd';
const HIST = [
  { id: 'aaaa0001', projectKey: KEY, projectName: 'proj', projectDir: PROJECT, title: 'Merged thing', status: 'done',
    startedAt: '2026-09-29T09:18:00Z', mtime: 3, pr: { number: 7, state: 'MERGED', url: 'https://example.test/7' } },
  { id: 'aaaa0002', projectKey: KEY, projectName: 'proj', projectDir: PROJECT, title: 'Stopped thing', status: 'stopped',
    startedAt: '2026-09-29T08:00:00Z', mtime: 2 },
];
const windows = [];
afterEach(() => { while (windows.length) windows.pop().close(); });

// An archived row as GET /api/history?archived=1 serves it: the row is flagged, the
// stamp rides along, and the branch/worktree behind it are gone.
const ARCH = { id: 'cccc0009', projectKey: KEY, projectName: 'proj', projectDir: PROJECT,
  title: 'Archived thing', status: 'done', startedAt: '2026-09-01T09:00:00Z', mtime: Date.parse('2026-09-01T10:00:00Z'),
  archived: true, archivedAt: '2026-09-01T10:00:00Z' };

// A Shaper feature as GET /api/run-groups lists it: slice 1 runs (p-live), slices 2 and 3 wait on the one before.
const FEATURE_GROUP = { id: 'feat_000000000001', kind: 'feature', title: 'Run tags', projectKey: null,
  cost: { usd: 4.56, byPipeline: { 'p-live': 4.56 } }, members: [
    { position: 1, title: 'Store tags', pipelineId: 'p-live', ticketId: null, status: 'running', pr: null, ticket: null, adhoc: false, after: null },
    { position: 2, title: 'Run tags', pipelineId: null, ticketId: 't2', status: null, pr: null, ticket: { id: 't2', status: 'scheduled', runAt: null, after: true }, adhoc: false, after: 1 },
    { position: 3, title: 'Cost report', pipelineId: null, ticketId: 't3', status: null, pr: null, ticket: { id: 't3', status: 'scheduled', runAt: null, after: true }, adhoc: false, after: 2 }] };

async function settle(window, n = 4) { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); }
function go(window, hash) { window.location.hash = hash; window.dispatchEvent(new window.Event('hashchange')); }
const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));
const live = (runId, extra = {}) => ({ runId, title: runId, projectDir: PROJECT, status: 'running', kind: 'run',
  startedAt: '10:00:00', pendingQuestion: null, ...extra });
const VIEW = (v) => ({ 'worca-cc.runs.view': JSON.stringify({ show: 'all', groupBy: 'none', person: '', ...v }) });
const rowEl = (doc, sel) => doc.querySelector(`#runs-list a.runs-row${sel}`);
const itemOf = (doc, sel) => rowEl(doc, sel).closest('.runs-item');
function tick(window, node) {
  node.checked = !node.checked;
  node.dispatchEvent(new window.Event('change', { bubbles: true }));
}
// The View menu: open it and pick an item by its label.
async function pickView(window, doc, label) {
  click(window, doc.getElementById('runs-view-btn'));
  const item = [...doc.querySelectorAll('.wfv-menu [role^="menuitem"]')].find((n) => (n.querySelector('.wfv-menu-l') || n).textContent === label);
  assert.ok(item, `the View menu lists ${label}`);
  click(window, item);
  await settle(window);
}

// `setup(window)` runs before app.js loads: a stub its module-load wiring must see goes there.
// `runGroups` answers GET /api/run-groups with the array's current contents; `onGroupCall` sees each POST / DELETE on
// /api/run-groups* (logged in `groupPosts`); `bulk(body)` answers POST /api/runs/bulk (bodies logged in `posts`).
async function boot({ url = 'http://localhost:4317/', storage = {}, projects = [{ name: 'proj', path: PROJECT, exists: true }], history = HIST, archived = [ARCH], chains = [],
  runGroups = [], onGroupCall = () => {}, bulk = () => ({ ok: true, done: [], cancelled: [], skipped: [] }), setup, tickets = [], labels = [] } = {}) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url }));
  const { window } = dom;
  windows.push(window);
  window.Element.prototype.scrollIntoView = function () {};
  if (setup) setup(window);
  let lastWs = null;
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._l = {}; lastWs = this; }
    send() {} close() {}
    addEventListener(t, fn) { (this._l[t] ||= []).push(fn); }
  };
  const posts = [];
  const groupPosts = [];
  const schedCalls = [];
  const labelPosts = [];
  let prToken = null;                                  // the History PR lookup's token (POST /api/history/pr)
  const ok =(body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
  window.fetch = (u, init = {}) => {
    const s = String(u);
    const method = (init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : null;
    if (s.endsWith('/api/runs/bulk') && method === 'POST') { posts.push(body); return ok(bulk(body)); }
    // Run labels (slice 1): the vocabulary, and the bulk delta (each post logged in `labelPosts`).
    if (s.endsWith('/api/labels')) return ok({ labels });
    if (s.endsWith('/api/runs/bulk/labels') && method === 'POST') {
      labelPosts.push(body);
      return ok({ runs: body.pipelineIds.map((id) => ({ id, labels: body.add || [], changed: true })), missing: [] });
    }
    if (s.endsWith('/api/history/pr') && method === 'POST') { prToken = body && body.token; return ok({}); }
    if (s.includes('/api/run-groups') && method !== 'GET') { groupPosts.push({ method, url: s, body }); onGroupCall({ method, url: s, body }); return ok({ ok: true }); }
    if (s.endsWith('/api/run-groups')) return ok({ groups: runGroups });
    if (s.includes('/api/projects')) return ok({ projects });
    // `history` may be a function: a test that reloads History can answer differently each time.
    if (s.includes('/api/history?archived=1')) return ok({ pipelines: archived, ghAvailable: true });
    // A function may return a promise: History then answers late (after a deep-linked page painted).
    if (s.endsWith('/api/history')) return Promise.resolve(typeof history === 'function' ? history() : history).then((pipelines) => ok({ pipelines, ghAvailable: true }));
    // The detail itself only: a looser match would answer its /log, /diff and /comments with a state body.
    if (/\/api\/history\/[^/]+\/aaaa000[12]$/.test(s)) return ok({ state: { title: 'Merged thing', status: 'done', steps: [], stepper: null } });
    if (/\/api\/history\/[^/]+\/p-roll\d$/.test(s)) return ok({ state: { title: 'Tokens', status: 'done', steps: [], stepper: null } });
    // An archived run's detail: the stamp is what flips the header to Restore.
    if (/\/api\/history\/[^/]+\/cccc0009$/.test(s)) return ok({ state: { title: 'Archived thing', status: 'done', steps: [], stepper: null, archivedAt: ARCH.archivedAt } });
    if (s.includes('/api/runs/cccc0009/restore')) return ok({ ok: true, id: 'cccc0009', restored: true, warnings: [] });
    if (s.includes('/api/workspaces')) return ok({ workspaces: [] });
    if (s.includes('/api/schedules/') && method !== 'GET') { schedCalls.push({ method, url: s }); return ok({ status: 'queued' }); }
    if (s.endsWith('/api/schedules')) return ok({ schedules: [], tickets, counts: {}, chains });
    return ok({ config: { steps: {}, customModels: [] }, models: [], efforts: [], pipelines: 0, projects: 0, workspaces: 0 });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* read-only */ }
  }
  globalThis.window = window;
  globalThis.document = window.document;
  window.localStorage.clear();
  for (const [k, v] of Object.entries(storage)) window.localStorage.setItem(k, v);
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await settle(window);
  lastWs._l.open?.forEach((fn) => fn());
  const recv = (obj) => lastWs._l.message.forEach((fn) => fn({ data: JSON.stringify(obj) }));
  const confirmWith = async (yes) => {
    click(window, window.document.getElementById(yes ? 'confirm-ok' : 'confirm-cancel'));
    await settle(window, 8);
  };
  return { window, doc: window.document, recv, posts, groupPosts, schedCalls, labelPosts, confirmWith, prToken: () => prToken };
}

test('one Runs nav item; a bare #running or #history lands on #runs with the empty state', async () => {
  const { window, doc } = await boot();
  assert.equal(doc.querySelectorAll('.nav button[data-nav="running"], .nav button[data-nav="history"]').length, 0);
  const btn = doc.querySelector('.nav button[data-nav="runs"]');
  click(window, btn);
  await settle(window);
  assert.equal(window.location.hash, '#runs');
  assert.equal(doc.querySelector('[data-view="runs"]').classList.contains('hidden'), false);
  assert.equal(btn.getAttribute('aria-current'), 'page');
  assert.equal(doc.getElementById('runs-empty').hidden, false, 'nothing remembered: the empty state');
  const depth = window.history.length;
  go(window, 'history'); await settle(window);
  assert.equal(window.location.hash, '#runs');
  assert.equal(window.history.length, depth + 1,
    '#history was REPLACED by #runs (a pushed #runs would make Back loop on #history)');
  go(window, 'new'); await settle(window);
  go(window, 'running'); await settle(window);
  assert.equal(window.location.hash, '#runs');
  assert.ok(btn.classList.contains('active'));
  assert.equal(doc.getElementById('topnav-title').textContent, 'Runs');
});

test('a live run groups with its registered project even before History loads (Group by Project)', async () => {
  const { window, doc, recv } = await boot({
    projects: [{ name: 'proj', path: PROJECT, exists: true, key: KEY }], history: [], storage: VIEW({ groupBy: 'project' }),
  });
  recv({ type: 'hello', runs: [live('r1')] });
  go(window, 'runs'); await settle(window);
  assert.equal(rowEl(doc, '[data-run-id="r1"]').closest('.runs-sec').dataset.section, `project:${KEY}`);
});

test('a finished run still listed live ends its row with its History row’s PR chip', async () => {
  const { window, doc, recv } = await boot();
  recv({ type: 'hello', runs: [live('r1', { pipelineId: 'aaaa0001' }), live('r2')] });
  recv({ type: 'done', runId: 'r1', status: 'done' });     // a run that ends live lingers until opened
  go(window, 'runs'); await settle(window);
  const chip = (id) => doc.querySelector(`#runs-list a.runs-row[data-run-id="${id}"] .runs-pr`);
  assert.ok(doc.querySelector('#runs-list .runs-row[data-run-id="r1"]'), 'the finished run is listed live');
  assert.ok(chip('r1'), 'the live row stands for its History row (MERGED), so it shows the PR');
  assert.equal(chip('r1').className, 'runs-pr is-merged');
  assert.equal(chip('r1').querySelector('.runs-pr-word').textContent, 'Merged');
  assert.equal(chip('r2'), null, 'a running run has no PR yet');
  click(window, chip('r1').querySelector('svg'));
  // Read before the route settles: a finished run then moves on to its saved page.
  assert.equal(window.location.hash, '#running/r1', 'the chip is not a control: a click on it is the row’s');
});

test('a finished run opens its saved page in the same pane and closes the live one', async () => {
  const { window, doc, recv } = await boot();
  recv({ type: 'hello', runs: [live('r1')] });
  go(window, 'running/r1'); await settle(window);
  const hrow = rowEl(doc, `[data-pipeline-id="aaaa0001"][data-project-key="${KEY}"]`);
  assert.ok(hrow);
  assert.equal(hrow.querySelector('.runs-pr-word').textContent, 'Merged');
  click(window, hrow); await settle(window);
  assert.equal(window.location.hash, `#history/${KEY}/aaaa0001`);
  assert.ok(doc.getElementById('hist-shell').classList.contains('detail-open'));
  assert.equal(doc.getElementById('run-shell').classList.contains('detail-open'), false);
  assert.equal(doc.getElementById('run-detail').innerHTML, '', 'a detail -> detail hop swaps the pane at once');
  assert.equal(doc.getElementById('runs-pane').dataset.kind, 'hist');
  assert.ok(rowEl(doc, '[data-pipeline-id="aaaa0001"]').classList.contains('selected'));
});

test('a live row listed before its pipeline id arrives picks the id up', async () => {
  const { window, doc, recv } = await boot();
  recv({ type: 'hello', runs: [live('r1')] });
  go(window, 'runs'); await settle(window);
  const row = () => rowEl(doc, '[data-run-id="r1"]');
  assert.equal(row().dataset.pipelineId, undefined);
  recv({ type: 'state', runId: 'r1', id: 'p9a8b7c6' });   // the first snapshot after createPipeline
  await settle(window);
  assert.equal(row().dataset.pipelineId, 'p9a8b7c6', 'selection and focus fallbacks match on it');
});

test('the pane remembers the last run: leave and come back and it reopens', async () => {
  const { window, doc, recv } = await boot();
  recv({ type: 'hello', runs: [live('r1')] });
  go(window, 'running/r1'); await settle(window);
  go(window, 'new'); await settle(window);
  click(window, doc.querySelector('.nav button[data-nav="runs"]')); await settle(window);
  assert.equal(window.location.hash, '#running/r1');
  assert.ok(doc.getElementById('run-shell').classList.contains('detail-open'));
});

test('a remembered run the server no longer knows (or that ended before a reload) opens its saved page', async () => {
  // Each row boots its own page.
  await checkRows([
    { name: 'a remembered run the server no longer knows opens its saved page', run: async () => {
      const storage = { 'worca-cc.runs.last': JSON.stringify({ runId: 'gone', pipelineId: 'aaaa0001', projectKey: KEY }) };
      const { window, doc, recv } = await boot({ storage });
      recv({ type: 'hello', runs: [] });
      await settle(window);
      go(window, 'runs'); await settle(window);
      assert.equal(window.location.hash, `#history/${KEY}/aaaa0001`);
      assert.ok(doc.getElementById('hist-shell').classList.contains('detail-open'));
    } },
    { name: 'a reload onto #runs whose remembered run ended meanwhile lands on its saved page', run: async () => {
      // Boot ON #runs: before `hello` the memory is trusted and the live stub opens. That open
      // must not overwrite the stored pipeline/project, or the bounce after `hello` has nowhere to go.
      const storage = { 'worca-cc.runs.last': JSON.stringify({ runId: 'gone', pipelineId: 'aaaa0001', projectKey: KEY }) };
      const { window, doc, recv } = await boot({ url: 'http://localhost:4317/#runs', storage });
      assert.equal(window.location.hash, '#running/gone', 'restored before hello');
      const kept = JSON.parse(window.localStorage.getItem('worca-cc.runs.last'));
      assert.equal(kept.pipelineId, 'aaaa0001');
      assert.equal(kept.projectKey, KEY);
      const depth = window.history.length;
      recv({ type: 'hello', runs: [] });
      await settle(window);
      assert.equal(window.location.hash, `#history/${KEY}/aaaa0001`);
      assert.equal(window.history.length, depth,
        'the dead #running/gone entry was REPLACED: a pushed bounce would leave it for Back to bounce off again');
      await settle(window);
      assert.ok(doc.getElementById('hist-shell').classList.contains('detail-open'));
    } },
  ]);
});

test('a dead #running link shows the list, not the other run the pane remembers', async () => {
  const { window, doc, recv } = await boot();
  recv({ type: 'hello', runs: [live('r1')] });
  go(window, 'running/r1'); await settle(window);            // the pane now remembers r1
  go(window, 'new'); await settle(window);
  go(window, 'running/dead'); await settle(window);          // e.g. an old Ask card's link
  assert.equal(window.location.hash, '#runs');
  assert.equal(doc.getElementById('run-shell').classList.contains('detail-open'), false, 'not r1');
  assert.equal(doc.getElementById('runs-empty').hidden, false, 'the list and the empty pane (D6: "else the list")');
});

test('a Needs-you question row for the run already open lands the pane on its question', async () => {
  const { window, doc, recv } = await boot();
  // The clarify shape test/ui-question.test.mjs uses (clarifyEvent): it paints #run-detail .rd-questions.
  const pq = { id: 'clarify-1', kind: 'clarify',
    questions: [{ id: 'q1', question: 'Where to store sessions?', options: ['Redis', 'Postgres', ''], allowFreeText: true }] };
  recv({ type: 'hello', runs: [live('q1', { pendingQuestion: pq })] });
  go(window, 'running/q1/details'); await settle(window);
  const screen = doc.querySelector('#run-detail .rd');
  let scrolled = 0;
  window.Element.prototype.scrollIntoView = function () { scrolled += 1; };
  click(window, doc.querySelector('#runs-list .runs-sec[data-section="needs"] a.runs-row[data-run-id="q1"]')); await settle(window);
  assert.equal(window.location.hash, '#running/q1');
  assert.equal(screen.dataset.mode, 'glance');
  assert.ok(scrolled > 0, 'scrolled to the question without waiting for a panel rebuild');
});

test('a History reload keeps each row’s last known PR until Phase 2 answers', async () => {
  let calls = 0;
  const history = () => (calls++ === 0 ? HIST : HIST.map(({ pr, ...rest }) => rest));   // reloads carry no pr, like the server
  const { window, doc, recv } = await boot({ history });
  go(window, 'runs'); await settle(window);
  const word = () => rowEl(doc, '[data-pipeline-id="aaaa0001"]').querySelector('.runs-pr-word')?.textContent;
  assert.equal(word(), 'Merged');
  recv({ type: 'pipelines-changed' });                  // → loadHistoryView({ force: true })
  await settle(window, 8);
  assert.ok(calls >= 2, 'History was fetched again');
  assert.equal(word(), 'Merged', 'not "Ready" while the PR lookup runs');
});

test('§3.1 sections: Needs you, Running, Recent in order, each with a count; each run once', async () => {
  const { window, doc, recv } = await boot();
  recv({ type: 'hello', runs: [live('ask', { pendingQuestion: { id: 'q', kind: 'plan' } }), live('work')] });
  go(window, 'runs'); await settle(window);
  const secs = [...doc.querySelectorAll('#runs-list .runs-sec')];
  assert.deepEqual(secs.map((s) => [s.dataset.section, s.querySelector('.runs-sec-head .runs-count').textContent]),
    [['needs', '1'], ['running', '1'], ['recent', '2']]);
  const keys = [...doc.querySelectorAll('#runs-list .runs-item[data-level="top"]')].map((n) => n.dataset.rowKey);
  assert.equal(new Set(keys).size, keys.length);
  assert.deepEqual(auditRunsLayout(doc.getElementById('runs-list'), { viewport: { width: 1440, height: 900 }, rect: () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }) }, doc)
    .filter((p) => p.rule === 'fact-twice'), [], 'no row states a fact twice');
});

test('the View menu: Show and Group by narrow and regroup the list, the chip resets it, and the choice survives a reload', async () => {
  await checkRows([
    { name: 'Show = Running / Finished narrow the list; the chip says so and its × resets the view', run: async () => {
      const first = await boot();
      const { window, doc } = first;
      go(window, 'runs'); await settle(window);
      first.recv({ type: 'hello', runs: [live('r-live')] });
      await settle(window);
      const titles = () => [...doc.querySelectorAll('#runs-list .runs-item[data-level="top"] .runs-row-title')].map((n) => n.textContent);
      const chip = doc.getElementById('runs-view-chip');
      assert.equal(chip.hidden, true, 'no chip for the default view');
      click(window, doc.getElementById('runs-view-btn'));
      const items = [...doc.querySelectorAll('.wfv-menu .wfv-menu-item[role="menuitemradio"]')].map((n) => [n.querySelector('.wfv-menu-l').textContent, n.querySelector('.wfv-menu-hint')?.textContent || '']);
      assert.deepEqual(items.slice(0, 6), [['All', '3'], ['Needs you', '0'], ['Running', '1'], ['Waiting', '0'], ['Finished', '2'], ['Archived', '']]);
      click(window, doc.querySelector('.wfv-menu [role="menuitemradio"]'));   // All again: closes it
      await settle(window);
      await pickView(window, doc, 'Finished');
      assert.deepEqual(titles().sort(), ['Merged thing', 'Stopped thing']);
      assert.equal(chip.hidden, false);
      assert.equal(chip.querySelector('.runs-view-chip-t').textContent, 'Finished · 2 of 3 runs');
      await pickView(window, doc, 'Running');
      assert.deepEqual(titles(), ['r-live']);
      assert.deepEqual(JSON.parse(window.localStorage.getItem('worca-cc.runs.view')), { show: 'running', groupBy: 'none', person: '', labels: [] });
      const second = await boot({ storage: { 'worca-cc.runs.view': window.localStorage.getItem('worca-cc.runs.view') } });
      go(second.window, 'runs'); await settle(second.window);
      assert.equal(second.doc.getElementById('runs-view-chip').querySelector('.runs-view-chip-t').textContent, 'Running · 0 of 2 runs', 'the view survives a reload');
      click(second.window, second.doc.querySelector('#runs-view-chip .runs-view-reset'));
      await settle(second.window);
      assert.equal(second.doc.getElementById('runs-view-chip').hidden, true);
      assert.equal(JSON.parse(second.window.localStorage.getItem('worca-cc.runs.view')).show, 'all');
    } },
    { name: 'Group by Project folds a project section across reloads; Group by Date shows date sections', run: async () => {
      const first = await boot({ storage: VIEW({ groupBy: 'project' }) });
      go(first.window, 'runs'); await settle(first.window);
      const head = first.doc.querySelector(`#runs-list .runs-sec-head[data-section-key="project:${KEY}"]`);
      click(first.window, head); await settle(first.window);
      const saved = first.window.localStorage.getItem('worca-cc.runs.collapsed');
      assert.deepEqual(JSON.parse(saved), [`project:${KEY}`]);
      const second = await boot({ storage: { ...VIEW({ groupBy: 'project' }), 'worca-cc.runs.collapsed': saved } });
      go(second.window, 'runs'); await settle(second.window);
      const head2 = second.doc.querySelector(`#runs-list .runs-sec-head[data-section-key="project:${KEY}"]`);
      assert.equal(head2.getAttribute('aria-expanded'), 'false');
      assert.equal(second.doc.querySelector(`#runs-list .runs-sec[data-section="project:${KEY}"] .runs-item`), null);
      await pickView(second.window, second.doc, 'Date');
      assert.ok(second.doc.querySelector('#runs-list .runs-sec[data-section^="date:"]'), 'date sections');
      assert.equal(second.doc.querySelector('#runs-view-chip .runs-view-chip-t').textContent, 'By date');
    } },
    { name: 'the old filter / group-by keys migrate once into the one view record', run: async () => {
      const { window, doc } = await boot({ storage: { 'worca-cc.runs.filter': 'live', 'worca-cc.runs.groupBy': 'project' } });
      go(window, 'runs'); await settle(window);
      assert.deepEqual(JSON.parse(window.localStorage.getItem('worca-cc.runs.view')), { show: 'running', groupBy: 'project', person: '', labels: [] });
      assert.equal(window.localStorage.getItem('worca-cc.runs.filter'), null);
      assert.equal(doc.querySelector('#runs-view-chip .runs-view-chip-t').textContent, 'Running · By project · 0 of 2 runs');
    } },
  ]);
});

// ── Show = Archived (issue #575) ──────────────────────────────────────────

test('Show = Archived fetches the archived feed only when picked (and on the first paint when remembered) and lists its rows', async () => {
  // Each row boots its own page.
  await checkRows([
    { name: 'Show = Archived fetches the archived feed only when picked, and lists its rows', run: async () => {
      const { window, doc } = await boot();
      go(window, 'runs'); await settle(window);
      let archivedFetches = 0;
      const inner = window.fetch;
      const wrapped = (u, init) => {
        if (String(u).includes('/api/history?archived=1')) archivedFetches += 1;
        return inner(u, init);
      };
      window.fetch = wrapped; globalThis.fetch = wrapped;
      assert.equal(archivedFetches, 0, 'nothing archived is fetched until Archived is picked');
      await pickView(window, doc, 'Archived');
      assert.equal(archivedFetches, 1, 'one archived fetch per pick');
      const titles = () => [...doc.querySelectorAll('#runs-list .runs-row-title')].map((n) => n.textContent);
      assert.deepEqual(titles(), ['Archived thing']);
      const row = rowEl(doc, '[data-pipeline-id="cccc0009"]');
      assert.equal(row.querySelector('.runs-row-sub').textContent, 'Archived · Sep 1', 'the word says where the run lives');
      assert.equal(doc.querySelector('#runs-view-chip .runs-view-chip-t').textContent, 'Archived · 1 run');
      await pickView(window, doc, 'All');
      assert.deepEqual(titles().sort(), ['Merged thing', 'Stopped thing'],
        'All shows the active history only (the archived feed is a separate array)');
      assert.equal(archivedFetches, 1, 'switching back does not re-fetch');
      await pickView(window, doc, 'Archived');
      assert.equal(archivedFetches, 2, 'each pick re-fetches (cheap, stays fresh)');
    } },
    { name: 'a remembered Show = Archived fetches its feed on the first paint and keeps the chip × as the way out', run: async () => {
      const { window, doc } = await boot({ storage: VIEW({ show: 'archived' }) });
      let archivedFetches = 0;
      const inner = window.fetch;
      const wrapped = (u, init) => {
        if (String(u).includes('/api/history?archived=1')) archivedFetches += 1;
        return inner(u, init);
      };
      window.fetch = wrapped; globalThis.fetch = wrapped;
      go(window, 'runs'); await settle(window);
      assert.ok(archivedFetches >= 1, 'the feed loads without a pick');
      assert.deepEqual([...doc.querySelectorAll('#runs-list .runs-row-title')].map((n) => n.textContent), ['Archived thing']);
      assert.equal(doc.getElementById('runs-view-chip').hidden, false, 'the chip and its × are at every level');
    } },
  ]);
});

test('an archived run’s detail offers Restore, not Archive, and hides Resume and follow-up', async () => {
  const { window, doc } = await boot();
  go(window, 'runs'); await settle(window);
  await pickView(window, doc, 'Archived');
  const posts = [];
  const inner = window.fetch;
  const wrapped = (u, init) => {
    if (String(u).includes('/restore')) posts.push({ url: String(u), method: (init && init.method) || 'GET' });
    return inner(u, init);
  };
  window.fetch = wrapped; globalThis.fetch = wrapped;
  click(window, rowEl(doc, '[data-pipeline-id="cccc0009"]')); await settle(window);
  assert.equal(window.location.hash, `#history/${KEY}/cccc0009`);
  const archiveBtn = doc.querySelector('#hist-detail .hd-archive');
  const restoreBtn = doc.querySelector('#hist-detail .hd-restore');
  assert.equal(archiveBtn.hidden, true, 'no Archive over an archived run');
  assert.equal(restoreBtn.hidden, false, 'Restore is offered in the ⋯ menu');
  assert.equal(doc.querySelector('#hist-detail .hd-after').hidden, true, 'no follow-up off an archived run');
  assert.equal(doc.querySelector('#hist-detail .hd-resume-split').hidden, true, 'no resume either');
  click(window, restoreBtn); await settle(window);
  assert.equal(doc.getElementById('confirm-title').textContent, 'Restore this run?');
  click(window, doc.getElementById('confirm-ok')); await settle(window);
  assert.deepEqual(posts, [{ url: `/api/runs/cccc0009/restore?projectKey=${KEY}`, method: 'POST' }],
    'the restore posts the runActionQuery-scoped URL');
  assert.equal(window.location.hash, '#runs', 'back to the Runs list');
  assert.ok(doc.getElementById('confirm-modal').classList.contains('hidden'), 'the modal is down');
});

test('pipelines-changed refreshes a loaded Archived feed, and a mid-flight change queues one more fetch', async () => {
  let archived = [ARCH];
  let archivedFetches = 0;
  const { window, doc, recv } = await boot({ setup: () => {} });
  const inner = window.fetch;
  const wrapped = (u, init) => {
    if (String(u).includes('/api/history?archived=1')) {
      archivedFetches += 1;
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ pipelines: archived, ghAvailable: true }) });
    }
    return inner(u, init);
  };
  window.fetch = wrapped; globalThis.fetch = wrapped;
  go(window, 'runs'); await settle(window);
  recv({ type: 'pipelines-changed' }); await settle(window);
  assert.equal(archivedFetches, 0, 'a never-loaded feed is not fetched on a change');
  await pickView(window, doc, 'Archived');
  assert.equal(archivedFetches, 1);
  // Restored elsewhere (another tab, the CLI): the broadcast drops it from the open view.
  archived = [];
  recv({ type: 'pipelines-changed' }); await settle(window);
  assert.equal(archivedFetches, 2, 'the change refetches the loaded feed');
  assert.equal(rowEl(doc, '[data-pipeline-id="cccc0009"]'), null, 'the restored row is gone');
  // Two changes in one tick: the second lands mid-flight and must not be dropped.
  recv({ type: 'pipelines-changed' }); recv({ type: 'pipelines-changed' }); await settle(window);
  assert.equal(archivedFetches, 4, 'one fetch plus exactly one queued re-fetch');
});

test('an archived run opened from the loaded feed shows its project in the glance head', async () => {
  // Regression (issue #575 review): histRecordFor used to search only historyAll,
  // so the clicked archived row fell through to the {id, projectKey} stub — no
  // projectDir, no title — and the glance head printed "(no project)".
  const { window, doc } = await boot();
  go(window, 'runs'); await settle(window);
  await pickView(window, doc, 'Archived');
  click(window, rowEl(doc, '[data-pipeline-id="cccc0009"]')); await settle(window);
  assert.equal(window.location.hash, `#history/${KEY}/cccc0009`);
  const meta = doc.querySelector('#hist-detail .hd-glance .rd-page-meta');
  assert.ok(meta, 'the glance head carries a meta line');
  assert.doesNotMatch(meta.textContent, /\(no project\)/);
  assert.match(meta.textContent, /proj/, 'the project name comes from the archived row');
  assert.equal(doc.querySelector('#hist-detail .rd-page-title').textContent, 'Archived thing',
    'the title comes from the archived row, not the raw id');
});

test('a deep-linked archived run on a cold feed repairs its stub record once the feed lands', async () => {
  // The deep link opens the detail BEFORE any archived fetch: the record is the
  // minimal stub. The payload's archivedAt stamp kicks the lazy feed load, whose
  // refreshHdFromRow pass repairs the record and repaints the head.
  const { window, doc } = await boot({ url: `http://localhost:4317/#history/${KEY}/cccc0009` });
  await settle(window, 8);
  assert.equal(window.location.hash, `#history/${KEY}/cccc0009`);
  const meta = doc.querySelector('#hist-detail .hd-glance .rd-page-meta');
  assert.ok(meta, 'the glance head carries a meta line');
  assert.doesNotMatch(meta.textContent, /\(no project\)/, 'the stub never sticks');
  assert.match(meta.textContent, /proj/);
  assert.equal(doc.querySelector('#hist-detail .rd-page-title').textContent, 'Archived thing');
});

const CHAIN2 = () => [{ id: 'p:pchain01', title: 'Chain root', members: [
  { pipelineId: 'pchain01', ticketId: null, state: 'current', title: 'Chain root', projectDir: PROJECT, after: null },
  { pipelineId: null, ticketId: 'tick0002', state: 'waiting', title: 'Chain next', projectDir: PROJECT, after: 1 },
] }];
const groupItem = (doc, key) => doc.querySelector(`#runs-list .runs-item[data-row-key="${key}"]`);

test('a "Run after" chain is one group row with its bar; ⌄ closes and opens its members and keeps focus', async () => {
  const { window, doc, recv } = await boot({ chains: CHAIN2(), history: [] });
  recv({ type: 'hello', runs: [live('r1', { pipelineId: 'pchain01' })] });
  go(window, 'runs'); await settle(window);
  const host = doc.getElementById('runs-list');
  assert.equal(host.querySelectorAll('.runs-item[data-level="top"][data-row-key^="chain:"]').length, 1, 'the live member is folded into ONE group row');
  assert.equal(host.querySelectorAll('.runs-item[data-level="top"] > a.runs-row[data-run-id="r1"]').length, 1, 'the group row links its current run');
  const g = () => groupItem(doc, 'chain:p:pchain01');
  assert.ok(g().querySelector(':scope > a.runs-row > .runs-row-prog'), 'the continuous group bar');
  assert.equal(g().querySelector(':scope > a.runs-row .runs-count').textContent, '0/2');
  const tog = () => g().querySelector(':scope > .runs-row-tail .runs-expand');
  assert.equal(tog().getAttribute('aria-expanded'), 'true', 'open while the group is not finished (D29)');
  tog().focus();
  click(window, tog());
  await settle(window);
  assert.equal(tog().getAttribute('aria-expanded'), 'false');
  assert.equal(g().querySelectorAll('.runs-members .runs-item').length, 0);
  assert.equal(doc.activeElement, tog(), 'focus returns to the rebuilt toggle');
  click(window, tog());
  await settle(window);
  assert.equal(g().querySelectorAll('.runs-members .runs-item').length, 2);
});

test('a plain Run-after chain lists all 3 members, open, with shapeFirst off and on (D29)', async () => {
  for (const shapeFirst of [false, true]) {
    // runChains shape: root running, two after-tickets, each after the one before (member.after = 1-based position).
    const chains = [{ id: 'p:pc000001', title: 'Billing chain', members: [
      { pipelineId: 'pc000001', ticketId: null, title: 'Step one', state: 'current', prUrl: null, historyKey: KEY, projectKey: KEY, after: null },
      { pipelineId: null, ticketId: 'tc2', title: 'Step two', state: 'waiting', after: 1 },
      { pipelineId: null, ticketId: 'tc3', title: 'Step three', state: 'waiting', after: 2 }] }];
    const { window, doc, recv } = await boot({ chains });
    recv({ type: 'hello', flags: { shapeFirst }, runs: [live('rc1', { pipelineId: 'pc000001', title: 'Step one' })] });
    go(window, 'runs'); await settle(window);
    const g = doc.querySelector('#runs-list .runs-item[data-row-key="chain:p:pc000001"]');
    assert.ok(g, `one group row (shapeFirst ${shapeFirst})`);
    assert.equal(g.closest('.runs-sec').dataset.section, 'running');
    assert.equal(g.querySelector(':scope > .runs-row-tail .runs-expand').getAttribute('aria-expanded'), 'true');
    const members = g.querySelectorAll(':scope > .runs-members > .runs-item');
    assert.equal(members.length, 3, `3 member rows (shapeFirst ${shapeFirst})`);
    assert.equal(members[1].querySelector('.runs-row-sub').textContent, 'Waiting · starts after run 1');
    assert.equal(members[2].querySelector('.runs-row-sub').textContent, 'Waiting · starts after run 2');
    window.close();
  }
});

test('a deep-linked feature page repaints when History answers late: its member reads its project and PR (QA)', async () => {
  const group = { id: 'feat_000000000002', kind: 'feature', title: 'Done feature', projectKey: null, cost: { usd: 1, byPipeline: {} },
    members: [{ position: 1, title: 'Merged thing', pipelineId: 'aaaa0001', ticketId: null, status: 'done', pr: null, ticket: null, adhoc: false, after: null }] };
  const { window, doc, recv } = await boot({ url: `http://localhost:4317/#feature/${group.id}`, runGroups: [group],
    history: () => new Promise((r) => setTimeout(() => r(HIST), 30)) });
  recv({ type: 'hello', runs: [] });   // the boot's History load: it answers after the page painted
  await new Promise((r) => setTimeout(r, 60));
  await settle(window, 8);
  const page = doc.querySelector('.feature-page');
  assert.doesNotMatch(page.textContent, /unknown project/);
  assert.match(page.textContent, /proj/, 'the project name');
  assert.match(page.textContent, /Merged/, 'the member reads its merged PR from History');
});

test('a Shaper feature (from /api/run-groups) is one group row that opens the feature page; ⌄ holds; a question raises it', async () => {
  const { window, doc, recv } = await boot({ runGroups: [FEATURE_GROUP], history: [] });
  recv({ type: 'hello', runs: [live('r-live', { pipelineId: 'p-live' })] });
  go(window, 'runs'); await settle(window);
  const g = () => groupItem(doc, `chain:${FEATURE_GROUP.id}`);
  assert.equal(g().querySelector(':scope > a.runs-row').getAttribute('href'), `#feature/${FEATURE_GROUP.id}`);
  assert.deepEqual([...g().querySelectorAll('.runs-members .runs-row-title')].map((t) => t.textContent),
    ['1 · Store tags', '2 · Run tags', '3 · Cost report']);
  const tog = () => g().querySelector(':scope > .runs-row-tail .runs-expand');
  click(window, tog()); await settle(window);
  assert.equal(tog().getAttribute('aria-expanded'), 'false', 'a person\'s toggle wins');
  recv({ type: 'state', runId: 'r-live', status: 'running' });
  await settle(window);
  assert.equal(tog().getAttribute('aria-expanded'), 'false', 'and holds across repaints');
  recv({ type: 'question', runId: 'r-live', question: { id: 'q1', kind: 'clarify', questions: [] } });
  await settle(window);
  assert.equal(g().closest('.runs-sec').dataset.section, 'needs', 'a slice waiting for a person raises its feature');
  const dot = g().querySelector(':scope > .runs-pick .status-dot');
  assert.equal(dot.dataset.state, 'needs-you');
  assert.ok(dot.querySelector('svg.status-sym'));
  const sec = doc.querySelector('#runs-list .runs-sec[data-section="needs"] .runs-sec-head .runs-count');
  assert.equal(sec.textContent, '1');
});

test('a state frame and a schedules-changed frame keep the group toggle focused, and a repaint without a text change keeps the bar element', async () => {
  const { window, doc, recv } = await boot({ chains: CHAIN2(), history: [] });
  recv({ type: 'hello', runs: [live('r1', { pipelineId: 'pchain01' })] });
  go(window, 'runs'); await settle(window);
  const g = () => groupItem(doc, 'chain:p:pchain01');
  const tog = () => g().querySelector(':scope > .runs-row-tail .runs-expand');
  const fill = () => g().querySelector(':scope > a.runs-row > .runs-row-prog > i');
  const before = fill();
  tog().focus();
  recv({ type: 'state', runId: 'r1', id: 'pchain01', status: 'running', steps: [], subAgents: [] });
  await settle(window);
  assert.equal(doc.activeElement, tog(), 'focus survives a state frame');
  assert.strictEqual(fill(), before, 'the bar element is reused when the row text did not change');
  recv({ type: 'schedules-changed' });
  await settle(window);
  assert.equal(doc.activeElement, tog(), 'focus survives schedules-changed');
});

const STAGED = () => ({ version: 2, template: { id: 'wf', name: 'WF' }, graph: { nodes: [
  { id: 'n_plan', kind: 'agent', key: 'planner', label: 'Planner', progressStage: 'plan', ports: { inputs: [], outputs: [], await: true } },
  { id: 'n_impl', kind: 'agent', key: 'implementer', label: 'Implementer', progressStage: 'build', ports: { inputs: [], outputs: [], await: true } },
], wires: [] } });
const STAGED_STEPS = () => [
  { key: 'x:n_plan:1', executionId: 'x:n_plan:1', nodeId: 'n_plan', ordinal: 1, kind: 'cycle', cycle: 1, status: 'done' },
  { key: 'x:n_impl:1', executionId: 'x:n_impl:1', nodeId: 'n_impl', ordinal: 1, kind: 'cycle', cycle: 1, status: 'start' },
];

test('a plain live run with a staged manifest draws its four-section stage block and its stage in the Running section', async () => {
  const { window, doc, recv } = await boot({ history: [] });
  recv({ type: 'hello', runs: [live('r1', { pipelineId: 'p1' })] });
  recv({ type: 'state', runId: 'r1', id: 'p1', status: 'running', stepper: STAGED(), steps: STAGED_STEPS(),
    active: [{ nodeId: 'n_impl', executionId: 'x:n_impl:1' }], subAgents: [], totalCostUsd: 0 });
  go(window, 'runs'); await settle(window);
  const row = rowEl(doc, '[data-run-id="r1"]');
  assert.ok(row.querySelector('.runs-stage .run-prog-track'), 'the four-section stage block');
  assert.equal(row.querySelector('.runs-row-sub').textContent, 'Build', 'the Running section already says the state');
});

test('chain freshness: no chains at first, then a schedules-changed frame folds the member into a group row', async () => {
  const chains = [];
  const { window, doc, recv } = await boot({ chains, history: [] });
  recv({ type: 'hello', runs: [live('r1', { pipelineId: 'pchain01' })] });
  go(window, 'runs'); await settle(window);
  const host = doc.getElementById('runs-list');
  assert.equal(host.querySelectorAll('.runs-item[data-row-key^="chain:"]').length, 0);
  chains.push(...CHAIN2());
  recv({ type: 'schedules-changed' });
  await settle(window);
  assert.equal(host.querySelectorAll('.runs-item[data-row-key^="chain:"]').length, 1);
});

// ── Selection, keys and the action bar (§3.2, §5a.4) ───────────────────────

test('keyboard (§5a.4): Space toggles the focused row, ⌘A selects every visible row, Esc clears and hides the bar', async () => {
  const { window, doc, recv } = await boot();
  recv({ type: 'hello', runs: [live('r1'), live('r2')] });
  go(window, 'runs'); await settle(window);
  const row = () => rowEl(doc, '[data-run-id="r1"]');   // re-queried: a repaint rebuilds rows
  const key = (k, o = {}) => row().dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }));
  row().focus();
  key(' ');
  await settle(window);
  assert.ok(row().closest('.runs-item').classList.contains('is-checked'));
  assert.equal(doc.getElementById('runs-bulk').hidden, false);
  assert.equal(doc.getElementById('runs-bulk-n').textContent, '1 selected');
  key('a', { metaKey: true });
  await settle(window);
  const top = doc.querySelectorAll('#runs-list .runs-item[data-level="top"]');
  assert.equal(doc.querySelectorAll('#runs-list .runs-item[data-level="top"].is-checked').length, top.length);
  assert.equal(doc.getElementById('runs-all').checked, true);
  key('Escape');
  await settle(window);
  assert.equal(doc.querySelectorAll('#runs-list .is-checked').length, 0);
  assert.equal(doc.getElementById('runs-bulk').hidden, true);
});

test('A11: no checkbox on hover; ⌘-click selects without navigating, Shift-click adds the range, Esc ends it', async () => {
  const css = readFileSync(join(__dir, '..', 'ui', 'public', 'style.css'), 'utf8');
  assert.doesNotMatch(css, /:has\(> \.runs-pick:hover/, 'checkboxes show only while selecting');
  const { window, doc, recv } = await boot();
  recv({ type: 'hello', runs: [live('r1'), live('r2'), live('r3'), live('r4')] });
  go(window, 'runs'); await settle(window);
  const wrap = doc.querySelector('.runs-all-wrap');
  assert.ok(wrap && wrap.contains(doc.getElementById('runs-all')), '#runs-all sits in its "Select all" label');
  assert.equal(wrap.hidden, true, 'Select all shows only while selecting');
  const keys = [...doc.querySelectorAll('#runs-list .runs-item[data-level="top"]')].map((n) => n.dataset.rowKey);
  const rowOf = (k) => doc.querySelector(`#runs-list .runs-item[data-row-key="${k}"] > a.runs-row`);
  const modClick = (k, o) => rowOf(k).dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, ...o }));
  const checked = () => [...doc.querySelectorAll('#runs-list .runs-item[data-level="top"].is-checked')].map((n) => n.dataset.rowKey);
  modClick(keys[0], { metaKey: true });
  await settle(window);
  assert.equal(window.location.hash, '#runs', '⌘-click never opens the run');
  assert.deepEqual(checked(), [keys[0]]);
  assert.ok(doc.getElementById('runs-list').classList.contains('is-selecting'));
  assert.equal(doc.querySelector('.runs-all-wrap').hidden, false);
  modClick(keys[2], { shiftKey: true });
  await settle(window);
  assert.deepEqual(checked(), keys.slice(0, 3), 'Shift-click adds the range from the anchor');
  doc.body.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await settle(window);
  assert.deepEqual(checked(), []);
  assert.equal(doc.querySelector('.runs-all-wrap').hidden, true);
  modClick(keys[3], { shiftKey: true });
  await settle(window);
  assert.deepEqual(checked(), [keys[3]], 'Esc dropped the anchor: a Shift-click toggles one row');
});

test('A11: a touch long-press starts selecting that run and swallows the click that follows', async () => {
  const { window, doc, recv } = await boot();
  recv({ type: 'hello', runs: [live('r1'), live('r2')] });
  go(window, 'runs'); await settle(window);
  const k = doc.querySelector('#runs-list .runs-item[data-level="top"]').dataset.rowKey;
  const rowOf = () => doc.querySelector(`#runs-list .runs-item[data-row-key="${k}"]`);
  rowOf().querySelector('a.runs-row').dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
  await new Promise((r) => setTimeout(r, 550)); await settle(window);
  assert.ok(rowOf().classList.contains('is-checked'));
  assert.ok(doc.getElementById('runs-list').classList.contains('is-selecting'));
  const notCancelled = rowOf().querySelector('a.runs-row').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(notCancelled, false, 'the click after the press is swallowed');
  await settle(window);
  assert.equal(window.location.hash, '#runs');
  assert.ok(rowOf().classList.contains('is-checked'), 'and does not toggle it back');
});

test('View › Show › Archived reads the server count before its feed loads; a 0 count is dimmed', async () => {
  const { window, doc } = await boot();
  let archivedFetches = 0;
  const inner = window.fetch;
  const wrapped = (u, init) => {
    if (String(u).endsWith('/api/counts')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ pipelines: 2, projects: 1, workspaces: 0,
      archivedPipelines: 12, schedules: { scheduled: 0, missed: 0, recurring: 0, unread: 0 } }) });
    if (String(u).includes('/api/history?archived=1')) archivedFetches += 1;
    return inner(u, init);
  };
  window.fetch = wrapped; globalThis.fetch = wrapped;
  go(window, 'runs'); await settle(window);
  click(window, doc.getElementById('runs-view-btn'));
  const row = (label) => [...doc.querySelectorAll('.wfv-menu .wfv-menu-item[role="menuitemradio"]')].find((n) => n.querySelector('.wfv-menu-l').textContent === label);
  assert.equal(row('Archived').querySelector('.wfv-menu-hint').textContent, '12');
  assert.equal(archivedFetches, 0, 'the count needs no archived feed');
  assert.ok(row('Needs you').querySelector('.wfv-menu-hint').classList.contains('is-zero'));
  assert.ok(doc.querySelector('.wfv-menu').classList.contains('wfv-view-menu'));
  assert.equal(doc.querySelector('.wfv-menu .wfv-seg').previousElementSibling.textContent, 'Group by');
});

test('A11: the row ⋯ menu offers Select, which enters selection with that row', async () => {
  const { window, doc, recv } = await boot();
  recv({ type: 'hello', runs: [live('r1'), live('r2')] });
  go(window, 'runs'); await settle(window);
  const item = itemOf(doc, '[data-run-id="r1"]');
  click(window, item.querySelector(':scope > .runs-row-tail .runs-more'));
  const sel = [...doc.querySelectorAll('.wfv-menu [role^="menuitem"]')].find((n) => n.querySelector('.wfv-menu-l').textContent === 'Select');
  assert.ok(sel, 'the ⋯ menu lists Select');
  click(window, sel);
  await settle(window);
  assert.ok(itemOf(doc, '[data-run-id="r1"]').classList.contains('is-checked'));
  assert.equal(doc.getElementById('runs-bulk').hidden, false);
});

test('⌘A / Ctrl+A after a click on the pane\'s blank area: focus stays in the list pane and every row is ticked', async () => {
  const { window, doc, recv } = await boot();
  recv({ type: 'hello', runs: [live('r1'), live('r2')] });
  go(window, 'runs'); await settle(window);
  const pane = doc.getElementById('runs-list-pane');
  pane.focus();                                   // what a click on the header or below the last row does
  assert.equal(doc.activeElement, pane, 'the pane takes focus, not the page');
  doc.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }));
  await settle(window);
  const top = doc.querySelectorAll('#runs-list .runs-item[data-level="top"]');
  assert.ok(top.length > 0);
  assert.equal(doc.querySelectorAll('#runs-list .runs-item[data-level="top"].is-checked').length, top.length);
});

test('group Stop: one confirm that says it cannot be undone; the body names the feature group', async () => {
  const { window, doc, recv, posts, confirmWith } = await boot({ runGroups: [FEATURE_GROUP],
    bulk: () => ({ ok: true, action: 'stop', done: [{ id: 'p-live', title: 'S1' }], cancelled: [{ id: 't2' }, { id: 't3' }], skipped: [] }) });
  recv({ type: 'hello', runs: [live('r-live', { pipelineId: 'p-live' })] });
  go(window, 'runs'); await settle(window);
  const box = groupItem(doc, `chain:${FEATURE_GROUP.id}`).querySelector(':scope > .runs-pick .runs-check');
  tick(window, box);
  await settle(window);
  assert.equal(doc.querySelector('#runs-bulk [data-bulk="stop"] .runs-bulk-c').textContent, '3', 'the running slice and its 2 waiting slices');
  click(window, doc.querySelector('#runs-bulk [data-bulk="stop"]'));
  await settle(window);
  const modal = doc.getElementById('confirm-modal');
  assert.match(modal.textContent, /Stop 3 runs\?/, 'the same count as the bar');
  assert.match(modal.textContent, /2 waiting runs are cancelled: Run tags, Cost report\./);
  assert.match(modal.textContent, /cannot be undone/);
  await confirmWith(true);
  assert.deepEqual(posts.at(-1), { action: 'stop', targets: [], groups: [{ id: FEATURE_GROUP.id, kind: 'feature', title: FEATURE_GROUP.title }] });
  assert.equal(doc.getElementById('runs-bulk').hidden, true, 'the selection clears after the action');
});

test('Archive skips a live run and names it; Undo restores the archived ones', async () => {
  const { window, doc, recv, posts } = await boot({ bulk: (body) => (body.action === 'archive'
    ? { ok: true, action: 'archive', done: [{ id: 'aaaa0001', title: 'Merged thing' }], cancelled: [], skipped: [{ id: 'r1', title: 'r1', reason: 'still running' }] }
    : { ok: true, action: 'restore', done: [{ id: 'aaaa0001' }], cancelled: [], skipped: [] }) });
  recv({ type: 'hello', runs: [live('r1')] });
  go(window, 'runs'); await settle(window);
  for (const sel of ['[data-run-id="r1"]', '[data-pipeline-id="aaaa0001"]']) {
    tick(window, itemOf(doc, sel).querySelector('.runs-check'));
    await settle(window);
  }
  assert.equal(doc.querySelector('#runs-bulk [data-bulk="archive"] .runs-bulk-c').textContent, '1');
  assert.equal(doc.querySelector('#runs-bulk [data-bulk="archive"]').title, 'Skipped 1 still running: r1.');
  click(window, doc.querySelector('#runs-bulk [data-bulk="archive"]'));
  await settle(window, 8);
  assert.equal(doc.getElementById('confirm-modal').classList.contains('hidden'), true, 'Archive asks no confirm');
  const toast = doc.querySelector('#toasts .toast');
  assert.equal(toast.querySelector('.tt').textContent, 'Archived 1 run');
  assert.match(toast.querySelector('.td').textContent, /r1 \(still running\)/);
  click(window, toast.querySelector('.toast-act'));
  await settle(window, 8);
  assert.deepEqual(posts.at(-1), { action: 'restore', targets: [{ pipelineId: 'aaaa0001' }], groups: [] });
});

test('an interrupted run that could resume: its ⋯ menu archives (never stops) after a confirm that says it can\'t resume', async () => {
  const parked = { id: 'dddd0004', projectKey: KEY, projectName: 'proj', projectDir: PROJECT, title: 'Parked thing', status: 'interrupted',
    resumable: true, startedAt: '2026-09-29T10:00:00Z', mtime: 4 };
  const { window, doc, posts, confirmWith } = await boot({ history: [...HIST, parked],
    bulk: () => ({ ok: true, action: 'archive', done: [{ id: 'dddd0004', title: 'Parked thing' }], cancelled: [], skipped: [] }) });
  go(window, 'runs'); await settle(window);
  const menu = () => {
    click(window, itemOf(doc, '[data-pipeline-id="dddd0004"]').querySelector(':scope > .runs-row-tail .runs-more'));
    return Object.fromEntries([...doc.querySelectorAll('.wfv-menu [role^="menuitem"]')].map((n) => [n.querySelector('.wfv-menu-l').textContent, n]));
  };
  let items = menu();
  assert.equal(items.Stop.getAttribute('aria-disabled') === 'true' || items.Stop.disabled === true, true, 'Stop stays disabled');
  assert.equal(items.Archive.getAttribute('aria-disabled') === 'true' || items.Archive.disabled === true, false);
  click(window, items.Archive);
  await settle(window);
  const modal = doc.getElementById('confirm-modal');
  assert.equal(modal.classList.contains('hidden'), false, 'Archive asks first');
  assert.match(modal.textContent, /Archive 1 run\?/);
  assert.match(modal.textContent, /1 interrupted run can't be resumed afterwards: Parked thing\./);
  await confirmWith(false);
  assert.equal(posts.length, 0, 'cancel posts nothing');
  items = menu();
  click(window, items.Archive);
  await settle(window);
  await confirmWith(true);
  assert.deepEqual(posts.at(-1).action, 'archive');
  assert.match(JSON.stringify(posts.at(-1).targets), /dddd0004/);
});

test('an archived live interrupted run leaves Running: in the acting tab, and in another tab from the broadcast', async () => {
  const parked = { id: 'dddd0004', projectKey: KEY, projectName: 'proj', projectDir: PROJECT, title: 'Parked thing', status: 'interrupted',
    resumable: true, startedAt: '2026-09-29T10:00:00Z', mtime: 4 };
  let rows = [...HIST, parked];
  const card = live('r-park', { pipelineId: 'dddd0004', title: 'Parked thing', status: 'interrupted' });
  // The acting tab: the ⋯ menu's Archive drops the live card as soon as the bulk answer names its pipeline.
  // It finished live (an agent died mid-run), so it lingers in Running until acknowledged.
  const storage = { 'worca-cc.lingerRuns': JSON.stringify(['r-park']) };
  const a = await boot({ history: () => rows, storage,
    bulk: () => { rows = [...HIST]; return { ok: true, action: 'archive', done: [{ id: 'dddd0004', title: 'Parked thing' }], cancelled: [], skipped: [] }; } });
  a.recv({ type: 'hello', runs: [card] });
  go(a.window, 'runs'); await settle(a.window);
  assert.ok(rowEl(a.doc, '[data-run-id="r-park"]'), 'the interrupted run is listed live');
  click(a.window, itemOf(a.doc, '[data-run-id="r-park"]').querySelector(':scope > .runs-row-tail .runs-more'));
  click(a.window, [...a.doc.querySelectorAll('.wfv-menu [role^="menuitem"]')].find((n) => n.querySelector('.wfv-menu-l').textContent === 'Archive'));
  await settle(a.window);
  await a.confirmWith(true);
  assert.equal(a.posts.at(-1).action, 'archive');
  assert.equal(rowEl(a.doc, '[data-run-id="r-park"]'), null, 'no ghost card in Running');
  assert.equal(a.doc.querySelector('#runs-list [data-pipeline-id="dddd0004"]'), null, 'nor a History row');
  // Another open tab: it learns from the pipelines-changed frame, which names the runs the server evicted.
  rows = [...HIST, parked];
  const b = await boot({ history: () => rows, storage });
  b.recv({ type: 'hello', runs: [card] });
  go(b.window, 'runs'); await settle(b.window);
  assert.ok(rowEl(b.doc, '[data-run-id="r-park"]'));
  rows = [...HIST];
  b.recv({ type: 'pipelines-changed', action: 'bulk-archive', removedRunIds: ['r-park'] });
  await settle(b.window, 8);
  assert.equal(rowEl(b.doc, '[data-run-id="r-park"]'), null, 'the other tab drops it too');
});

test('Delete (Advanced): one confirm naming what goes and what stays', async () => {
  const { window, doc, posts, confirmWith } = await boot();
  go(window, 'runs'); await settle(window);
  tick(window, itemOf(doc, '[data-pipeline-id="aaaa0002"]').querySelector('.runs-check'));
  await settle(window);
  click(window, doc.querySelector('#runs-bulk [data-bulk="delete"]'));
  await settle(window);
  const modal = doc.getElementById('confirm-modal');
  assert.match(modal.textContent, /Delete 1 run permanently\?/);
  assert.match(modal.textContent, /Keeps remote branches, pull requests and their cost in Statistics/);
  await confirmWith(false);
  assert.equal(posts.length, 0, 'cancel posts nothing');
});

test('a plain Run-after chain lists its failed member with "!" and its merged member as Merged (runChains member shape)', async () => {
  // runChains members carry state done|current|waiting|failed and prUrl, never status / pr (memberRun maps them).
  const chains = [{ id: 'p:aaaa0001', title: 'Chain', members: [
    { pipelineId: 'aaaa0001', ticketId: null, title: 'Merged thing', state: 'done', prUrl: 'https://example.test/7', historyKey: KEY, projectKey: KEY },
    { pipelineId: 'bbbb0002', ticketId: null, title: 'Broke', state: 'failed', prUrl: null, historyKey: KEY, projectKey: KEY },
    { pipelineId: null, ticketId: 't3', title: 'Next', state: 'waiting' }] }];
  const { window, doc } = await boot({ chains });
  go(window, 'runs'); await settle(window);
  const g = groupItem(doc, 'chain:p:aaaa0001');
  const exp = g.querySelector(':scope > .runs-row-tail .runs-expand');
  if (exp.getAttribute('aria-expanded') !== 'true') { click(window, exp); await settle(window); }   // a failed group starts closed
  const member = (pid) => doc.querySelector(`#runs-list .runs-members .runs-row[data-pipeline-id="${pid}"]`).closest('.runs-item');
  assert.equal(member('bbbb0002').querySelector('.status-dot').dataset.state, 'failed');
  assert.ok(member('bbbb0002').querySelector('.status-dot svg.status-sym'));
  assert.equal(member('aaaa0001').querySelector('.runs-pr-word').textContent, 'Merged', 'the History row\'s PR state, not "Ready"');
});

test('Add to group / Remove from group repaint the group with its new count and bar; the picker draws the symbol', async () => {
  // A user group of 2: aaaa0001 (HIST, done) and the live run r1 (working) reads "1/2".
  const mb = (position, pipelineId, status) => ({ position, title: pipelineId, pipelineId, ticketId: null, status, pr: null, ticket: null, adhoc: true });
  const runGroups = [{ id: 'grp_000000000001', kind: 'user', title: 'Billing', projectKey: null,
    members: [mb(1, 'aaaa0001', 'done'), mb(2, 'pw000001', 'running')] }];
  const { window, doc, recv, groupPosts } = await boot({ runGroups,
    onGroupCall: ({ method, url, body }) => {
      if (method === 'POST') runGroups[0].members.push(mb(3, body.pipelineId, 'running'));
      else runGroups[0].members = runGroups[0].members.filter((m) => !url.endsWith(`/${m.pipelineId}`));
    } });
  recv({ type: 'hello', runs: [live('r1', { pipelineId: 'pw000001' }), live('r2', { pipelineId: 'pw000002' }),
    live('r3', { pipelineId: 'pw000003', pendingQuestion: { id: 'q', kind: 'plan' } })] });
  go(window, 'runs'); await settle(window);
  const groupRowEl = () => groupItem(doc, 'chain:grp_000000000001');
  const width = () => groupRowEl().querySelector(':scope > a.runs-row > .runs-row-prog > i').style.width;
  assert.equal(groupRowEl().querySelector('.runs-count').textContent, '1/2');
  const before = width();
  // ⋯ on r2 → Add to group… → the picker lists Billing with its dot; pick it.
  click(window, itemOf(doc, '[data-run-id="r2"]').querySelector(':scope > .runs-row-tail .runs-more'));
  click(window, [...doc.querySelectorAll('.wfv-menu [role^="menuitem"]')].find((n) => n.textContent.includes('Add to group')));
  await settle(window);
  const picker = doc.querySelector('.group-picker');
  assert.ok(picker.querySelector('.gp-row[data-group-id="grp_000000000001"] .status-dot'));
  click(window, picker.querySelector('.gp-row[data-group-id="grp_000000000001"]'));
  await settle(window, 8);
  assert.deepEqual(groupPosts.at(-1), { method: 'POST', url: '/api/run-groups/grp_000000000001/members', body: { pipelineId: 'pw000002' } });
  assert.equal(groupRowEl().querySelector('.runs-count').textContent, '1/3');
  assert.notEqual(width(), before, 'the group bar fraction changed');
  // ⋯ on the expanded ad-hoc member → Remove from group (an unfinished group is open by default, D29).
  const exp = groupRowEl().querySelector(':scope > .runs-row-tail .runs-expand');
  if (exp.getAttribute('aria-expanded') !== 'true') { click(window, exp); await settle(window); }
  const member = groupRowEl().querySelector('.runs-members .runs-row[data-pipeline-id="pw000002"]').closest('.runs-item');
  assert.equal(member.querySelector('.runs-indep'), null, '#955: a one-line member drops Independent');
  assert.doesNotMatch(member.querySelector('.runs-row-title').textContent, /^\d+ · /, 'an ad hoc member has no position');
  click(window, member.querySelector(':scope > .runs-row-tail .runs-more'));
  click(window, [...doc.querySelectorAll('.wfv-menu [role^="menuitem"]')].find((n) => n.textContent.includes('Remove from group')));
  await settle(window, 8);
  assert.equal(groupPosts.at(-1).method, 'DELETE');
  assert.equal(groupRowEl().querySelector('.runs-count').textContent, '1/2');
});

test('a waiting row\'s ⋯ offers Start now and Cancel, and each calls the schedule route', async () => {
  const soon = new Date(Date.now() + 3600_000).toISOString();
  const { window, doc, schedCalls } = await boot({ tickets: [{ id: 't_1', scheduleId: null, title: 'Upgrade', status: 'scheduled', runAt: soon }] });
  go(window, 'runs'); await settle(window);
  const items = () => [...doc.querySelectorAll('.wfv-menu [role^="menuitem"]')];
  const pick = async (label) => {
    click(window, groupItem(doc, 'sched:t_1').querySelector(':scope > .runs-row-tail .runs-more'));
    assert.deepEqual(items().map((n) => n.textContent.trim()), ['Start now', 'Cancel'], 'no Stop / Archive / Delete on a waiting run');
    click(window, items().find((n) => n.textContent.trim() === label));
    await settle(window, 8);
  };
  await pick('Start now');
  await pick('Cancel');
  assert.deepEqual(schedCalls, [{ method: 'POST', url: '/api/schedules/t_1/run-now' }, { method: 'DELETE', url: '/api/schedules/t_1' }]);
});

test('rows and expanded members draw Needs you / Failed with the ? / ! symbol in the booted list', async () => {
  // A failed run comes from History: the first hello acknowledges terminal live runs, so a live 'error' run never lists.
  const { window, doc, recv } = await boot({ history: [...HIST, { ...HIST[1], id: 'aaaa0003', title: 'Broke', status: 'error', mtime: 4 }] });
  recv({ type: 'hello', runs: [live('r3', { pendingQuestion: { id: 'q', kind: 'plan' } })] });
  go(window, 'runs'); await settle(window);
  for (const [sel, state, label] of [['[data-run-id="r3"]', 'needs-you', 'Needs you'], ['[data-pipeline-id="aaaa0003"]', 'failed', 'Failed']]) {
    const dot = itemOf(doc, sel).querySelector(':scope > .runs-pick .status-dot');
    assert.equal(dot.dataset.state, state);
    assert.ok(dot.querySelector('svg.status-sym'), `${state} is a symbol, not a plain dot`);
    assert.equal(dot.getAttribute('aria-label'), label);
  }
});

test('Esc with a run open clears the selection only: the detail stays and the hash does not change', async () => {
  const { window, doc, recv } = await boot();
  recv({ type: 'hello', runs: [live('r1'), live('r2')] });
  go(window, 'running/r1'); await settle(window);
  assert.ok(doc.querySelector('.run-shell.detail-open'), 'precondition: the run detail is open');
  // Slide layout: there the Running Escape arm sets the hash to #runs, so this test fails without the new selection
  // guard. In jsdom's default split layout the arm never changes the hash.
  doc.getElementById('runs-shell').dataset.layout = 'slide';
  tick(window, itemOf(doc, '[data-run-id="r2"]').querySelector('.runs-check'));
  await settle(window);
  doc.body.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await settle(window);
  assert.equal(doc.querySelectorAll('#runs-list .is-checked').length, 0);
  assert.equal(doc.getElementById('runs-bulk').hidden, true);
  assert.equal(window.location.hash, '#running/r1');
  assert.ok(doc.querySelector('.run-shell.detail-open'), 'the detail did not close');
});

// "2 need you" counts the usage-limit pause: the list's needsYou() (runs-list.mjs) and the badge's runsNeedsCount()
// treat any paused live run as needing you, although run-model.mjs gives it state 'paused' (grey dot), not 'needs-you'.
// Never count the badge by runModel().state === 'needs-you': that would read 1 here.
// A9 (UI/UX review 2026-10-19): the view jumped to another group page ~1.5 s after a run finished. Played back: the
// finish sequence on an open run page never routes to #feature/… on its own.
test('A9: a run that finishes and then joins a feature group never moves the open page to #feature/…', async () => {
  const groups = [];
  let hist = [];
  const { window, recv } = await boot({ runGroups: groups, history: () => hist });
  const hashes = [];
  window.addEventListener('hashchange', () => hashes.push(window.location.hash));
  for (const m of ['pushState', 'replaceState']) {
    const orig = window.history[m].bind(window.history);
    window.history[m] = (st, t, url) => { if (url != null) hashes.push(String(url)); return orig(st, t, url); };
  }
  recv({ type: 'hello', runs: [live('r1', { pipelineId: 'p-a9' })] });
  go(window, 'running/r1'); await settle(window);
  hist = [{ id: 'p-a9', projectKey: KEY, projectName: 'proj', projectDir: PROJECT, title: 'r1', status: 'done', startedAt: '2026-10-19T09:00:00Z', mtime: 9 }];
  recv({ type: 'state', runId: 'r1', status: 'done' });
  recv({ type: 'done', runId: 'r1', status: 'done' });
  recv({ type: 'pipelines-changed' });
  await settle(window, 8);
  groups.push({ ...FEATURE_GROUP, members: [{ ...FEATURE_GROUP.members[0], pipelineId: 'p-a9', status: 'done' }, ...FEATURE_GROUP.members.slice(1)] });
  recv({ type: 'pipelines-changed' });
  await new Promise((res) => setTimeout(res, 2000));
  await settle(window, 8);
  assert.deepEqual(hashes.filter((h) => /#feature\//.test(h)), [], 'no #feature/ hash on its own');
  assert.match(window.location.hash, /^#history\//, 'the finished run lands on its saved page');
});

test('A9: a question alert for a feature group member opens the group page (recorded behaviour, review A9)', async () => {
  class N {
    constructor(title, opts = {}) { this.title = title; this.tag = opts.tag; N.shown.push(this); }
    close() {}
  }
  N.shown = []; N.permission = 'granted'; N.requestPermission = () => Promise.resolve('granted');
  const { window, recv } = await boot({ runGroups: [FEATURE_GROUP], history: [], storage: { 'worca-cc.alerts.notify': '1' },
    setup: (w) => { w.Notification = N; } });
  recv({ type: 'hello', runs: [live('r-live', { pipelineId: 'p-live' })] });
  go(window, 'runs'); await settle(window);
  recv({ type: 'question', runId: 'r-live', question: { id: 'q1', kind: 'clarify', questions: [] } });
  await settle(window);
  assert.equal(N.shown.length, 1, 'one alert');
  N.shown[0].onclick({ preventDefault() {} });
  await settle(window);
  assert.equal(window.location.hash, `#feature/${FEATURE_GROUP.id}`, 'its target is the group row\'s');
});

test('badge: 2 runs need you → sidebar "2" alone (QA 6: no "?") and title "(2) Worca"; none → "Worca"', async () => {
  // applyBadge writes the title only with the badge setting on; it follows notify, which defaults to off
  // (readAlertSettings, ui/public/alerts.mjs), and boot() clears localStorage.
  const { window, doc, recv } = await boot({ storage: { 'worca-cc.alerts.badge': '1' } });
  recv({ type: 'hello', runs: [live('a', { pendingQuestion: { id: 'q', kind: 'plan' } }), live('b', { status: 'paused', pauseReason: 'usage_limit' }), live('c')] });
  await settle(window);
  const nc = doc.getElementById('nav-needs-count');
  assert.equal(nc.hidden, false);
  assert.equal(nc.querySelector('svg'), null, 'QA 6: the amber number alone');
  assert.equal(nc.querySelector('.nav-count-n').textContent, '2');
  assert.equal(nc.getAttribute('role'), 'img', 'A10: the count names itself');
  assert.equal(nc.getAttribute('aria-label'), '2 need you');
  assert.equal(window.document.title, '(2) Worca');
  recv({ type: 'done', runId: 'b', status: 'stopped' });
  await settle(window);
  assert.equal(nc.getAttribute('aria-label'), '1 needs you');
  recv({ type: 'done', runId: 'a', status: 'stopped' });
  await settle(window);
  assert.equal(window.document.title, 'Worca');
  assert.equal(nc.hidden, true);
});

test('QA 2: the Runs list has one resize handle; a stored width comes back clamped to the window', async () => {
  const { window, doc } = await boot();
  go(window, 'runs'); await settle(window);
  assert.equal(doc.querySelectorAll('#runs-shell .runs-resize[role="separator"]').length, 1);
  const again = await boot({ storage: { 'worca-cc.runs.listWidth': '400' } });
  go(again.window, 'runs'); await settle(again.window);
  const shell = again.doc.getElementById('runs-shell');
  assert.equal(shell.style.getPropertyValue('--runs-list-w'), '400px', 'jsdom\'s 1024 px window allows up to 512');
  assert.equal(shell.querySelector('.runs-resize').getAttribute('aria-valuemax'), '512');
});

test('D31: a PR with failing checks lists in Needs you with "Checks failing" until a live fix run makes it Fixing', async () => {
  const pr = { url: 'https://github.com/o/r/pull/781', number: 781, state: 'OPEN', checks: { state: 'failing', total: 12, failed: 3, pending: 0 } };
  const { window, doc, recv } = await boot({ history: [{ ...HIST[0], id: 'aaaa0005', title: 'Red CI', pr }] });
  go(window, 'runs'); await settle(window);
  const item = () => itemOf(doc, '[data-pipeline-id="aaaa0005"]');
  assert.equal(item().closest('.runs-sec').dataset.section, 'needs');
  const dot = item().querySelector(':scope > .runs-pick .status-dot[data-state="needs-you"]');
  assert.ok(dot && !dot.querySelector('svg.status-sym'), 'QA 6: a PR-driven Needs you is a plain amber dot');
  assert.equal(dot.getAttribute('aria-label'), 'Needs you');
  const chip = () => item().querySelector('.runs-pr');
  assert.equal(chip().querySelector('.runs-pr-word').textContent, 'Checks failing');
  assert.equal(chip().title, '3 of 12 checks failed · PR #781');
  assert.equal(doc.querySelector('#nav-needs-count .nav-count-n').textContent, '1');
  recv({ type: 'pr-watch-changed', projectKey: KEY, pipelineId: 'aaaa0005', memberKey: null, fixing: true });
  await settle(window);
  assert.equal(chip().querySelector('.runs-pr-word').textContent, 'Fixing');
  assert.notEqual(item().closest('.runs-sec').dataset.section, 'needs');
  assert.equal(doc.getElementById('nav-needs-count').hidden, true);
});

test('§2.4: a row shows its cost on hover, a group its total; an engine without costs reads "Cost unknown"', async () => {
  const { window, doc, recv } = await boot({ runGroups: [FEATURE_GROUP],
    history: [{ ...HIST[0], totalCostUsd: 1.23 }, { ...HIST[1], runEngine: 'copilot', totalCostUsd: 0 }] });
  recv({ type: 'hello', runs: [live('r-live', { pipelineId: 'p-live' })] });
  go(window, 'runs'); await settle(window);
  assert.equal(rowEl(doc, '[data-pipeline-id="aaaa0001"]').title, 'Cost $1.23');
  assert.equal(rowEl(doc, '[data-pipeline-id="aaaa0002"]').title, 'Cost unknown');
  assert.equal(groupItem(doc, `chain:${FEATURE_GROUP.id}`).querySelector(':scope > a.runs-row').title, 'Group total $4.56');
});

// ── Run labels (slice 1) ───────────────────────

const LABELLED = (labels, extra = {}) => ({ id: 'llll0001', projectKey: KEY, projectName: 'proj', projectDir: PROJECT, title: 'Labelled thing',
  status: 'done', startedAt: '2026-09-29T07:00:00Z', mtime: 1, labels, ...extra });
const labelsHello = (recv, on = true) => recv({ type: 'hello', flags: on ? { runLabels: true } : {}, runs: [] });

test('run labels: a row with 4 labels shows 2 chips and +2; flag off, no chip at all', async () => {
  for (const on of [true, false]) {
    const { window, doc, recv } = await boot({ history: [...HIST, LABELLED(['hotfix', 'needs demo', 'spike', 'release'])] });
    labelsHello(recv, on);
    go(window, 'runs'); await settle(window);
    if (!on) { assert.equal(doc.querySelectorAll('#runs-list .label-chip').length, 0, 'flag off: no chip'); window.close(); continue; }
    const row = rowEl(doc, '[data-pipeline-id="llll0001"]');
    assert.equal(row.querySelectorAll('.runs-row-labels .label-chip').length, 2);
    assert.equal(row.querySelector('.label-more').textContent, '+2');
    assert.equal(row.querySelector('.runs-row-title').nextElementSibling.className, 'runs-row-labels', 'the chips sit after the title');
    window.close();
  }
});

test('run labels: the bar\'s Label picker shows a dash for a label some runs carry; ticking it posts every selected id once', async () => {
  const history = [LABELLED(['hotfix']), LABELLED(['hotfix'], { id: 'llll0002', title: 'Second' }), LABELLED([], { id: 'llll0003', title: 'Third' })];
  const { window, doc, recv, labelPosts } = await boot({ history, labels: [{ label: 'hotfix', count: 2 }] });
  labelsHello(recv);
  go(window, 'runs'); await settle(window);
  for (const id of ['llll0001', 'llll0002', 'llll0003']) { tick(window, itemOf(doc, `[data-pipeline-id="${id}"]`).querySelector('.runs-check')); await settle(window); }
  const btn = doc.querySelector('#runs-bulk [data-bulk="label"]');
  assert.equal(btn.disabled, false);
  click(window, btn); await settle(window, 8);
  const box = doc.querySelector('.label-picker .lp-row[data-label="hotfix"] .lp-check');
  assert.equal(box.indeterminate, true, 'some of the selected runs have it');
  box.checked = true;
  box.dispatchEvent(new window.Event('change', { bubbles: true }));
  await settle(window, 8);
  assert.equal(labelPosts.length, 1);
  assert.deepEqual({ ...labelPosts[0], pipelineIds: [...labelPosts[0].pipelineIds].sort() }, { pipelineIds: ['llll0001', 'llll0002', 'llll0003'], add: ['hotfix'] });
  assert.equal(doc.querySelectorAll('.label-picker').length, 1, 'the picker stays open across toggles');
});

test('run labels: search offers "Runs labelled hotfix" (and label:hotfix); it keeps matching rows; its chip × clears it; no Label button', async () => {
  for (const q of ['hotfix', 'label:hotfix']) {
    const history = [...HIST, LABELLED(['hotfix'])];
    const { window, doc, recv } = await boot({ history, labels: [{ label: 'hotfix', count: 1 }] });
    labelsHello(recv);
    go(window, 'runs'); await settle(window);
    assert.equal(doc.getElementById('runs-label-btn'), null, 'the head has no Label button');
    assert.equal(doc.querySelectorAll('#runs-list a.runs-row').length, 3);
    go(window, 'projects'); await settle(window);
    const input = doc.getElementById('tsearch-input');
    input.focus();
    input.value = q; input.dispatchEvent(new window.Event('input', { bubbles: true }));
    const opt = [...doc.querySelectorAll('#tsearch-pop [role="option"]')]
      .find((o) => o.querySelector('.tsearch-title')?.textContent === 'Runs labelled hotfix');
    assert.ok(opt, `"${q}" offers the label filter`);
    click(window, opt); await settle(window, 8);
    assert.equal(window.location.hash, '#runs', q);
    assert.deepEqual([...doc.querySelectorAll('#runs-list a.runs-row')].map((a) => a.dataset.pipelineId), ['llll0001'], q);
    const filter = doc.getElementById('runs-label-filter');
    assert.equal(filter.hidden, false);
    assert.equal(filter.querySelectorAll('.label-chip').length, 1);
    click(window, filter.querySelector('.label-x')); await settle(window, 8);
    assert.equal(filter.hidden, true);
    assert.equal(doc.querySelectorAll('#runs-list a.runs-row').length, 3);
  }
});

test('run labels: "Runs labelled hotfix" opens the filtered list, not the run the pane remembers', async () => {
  const { window, doc, recv } = await boot({ history: [...HIST, LABELLED(['hotfix'])], labels: [{ label: 'hotfix', count: 1 }] });
  labelsHello(recv);
  go(window, `history/${KEY}/aaaa0001`); await settle(window, 8);   // the pane now remembers a run outside the filter
  go(window, 'settings'); await settle(window);
  const input = doc.getElementById('tsearch-input');
  input.focus();
  input.value = 'hotfix'; input.dispatchEvent(new window.Event('input', { bubbles: true }));
  const opt = [...doc.querySelectorAll('#tsearch-pop [role="option"]')]
    .find((o) => o.querySelector('.tsearch-title')?.textContent === 'Runs labelled hotfix');
  click(window, opt); await settle(window, 8);
  assert.equal(window.location.hash, '#runs');
  assert.equal(doc.getElementById('hist-shell').classList.contains('detail-open'), false, 'not the remembered run');
  assert.equal(doc.getElementById('runs-empty').hidden, false, 'the list and the empty pane');
  assert.deepEqual([...doc.querySelectorAll('#runs-list a.runs-row')].map((a) => a.dataset.pipelineId), ['llll0001']);
});

test('openRunsSelected (Statistics › Cost "Tag N runs"): routes to #runs with the listed runs ticked; the rest are reported', async () => {
  const { window, doc } = await boot();
  window.__np.openRunsSelected(['aaaa0001', 'aaaa0002', 'zzzz9999']);
  await settle(window, 8);
  assert.equal(window.location.hash, '#runs');
  assert.equal(doc.getElementById('runs-bulk-n').textContent, '2 selected');
  assert.equal(doc.querySelector('#toasts .toast .tt').textContent, 'Selected 2 of 3 runs');
});

// Honest status (run 2 of 4): a finished member still in the live map, its stored PR and cost, the pending chip.
const FAILING = { url: 'https://github.com/acme/web/pull/821', number: 821, state: 'OPEN', mergeable: 'MERGEABLE',
  checks: { state: 'failing', total: 12, failed: 3, pending: 0 } };
const ROLLOUT = { id: 'feat_000000000002', kind: 'feature', title: 'Complete Design Language Rollout', projectKey: null,
  cost: { usd: 313.7, byPipeline: { 'p-roll1': 135.95, 'p-roll2': 141.19, 'p-roll3': 36.56 } }, members: [
    { position: 1, title: 'Tokens', pipelineId: 'p-roll1', ticketId: null, status: 'done', pr: FAILING, ticket: null, adhoc: false, after: null },
    { position: 2, title: 'Buttons', pipelineId: 'p-roll2', ticketId: null, status: 'done', pr: null, ticket: null, adhoc: false, after: 1 },
    { position: 3, title: 'Forms', pipelineId: 'p-roll3', ticketId: null, status: 'running', pr: null, ticket: null, adhoc: false, after: 2 }] };
const rollHist = (id, extra = {}) => ({ id, projectKey: KEY, projectName: 'proj', projectDir: PROJECT, title: id, status: 'done',
  startedAt: '2026-10-20T09:00:00Z', mtime: 1, ...extra });

test('D1/D2: a finished member still live, with no History PR yet, shows its group member\'s stored PR everywhere', async () => {
  const { window, doc, recv } = await boot({ runGroups: [ROLLOUT],
    history: [rollHist('p-roll1', { totalCostUsd: 135.95 }), rollHist('p-roll2', { totalCostUsd: 141.19 })] });
  recv({ type: 'hello', runs: [live('r-roll1', { pipelineId: 'p-roll1', status: 'done' }), live('r-roll3', { pipelineId: 'p-roll3' })] });
  go(window, 'runs'); await settle(window);
  const g = groupItem(doc, `chain:${ROLLOUT.id}`);
  assert.equal(g.closest('.runs-sec').dataset.section, 'needs');
  assert.equal(g.querySelector(':scope > a.runs-row .runs-row-sub').textContent, 'Run 1 needs you · Checks failing');
  assert.equal(doc.querySelector('#runs-list .runs-sec-needs .runs-count').textContent, '1');
  const m1 = g.querySelector('.runs-members a.runs-row[data-pipeline-id="p-roll1"]');
  assert.equal(m1.dataset.state, 'needs-you');
  assert.equal(m1.querySelector('.runs-pr-word').textContent, 'Checks failing');
  assert.equal(m1.dataset.line, 'Checks failing · PR #821', 'the run page\'s line (rdModel) is the same');
  assert.equal(m1.querySelector('.runs-row-sub').textContent, 'In review', 'a PR-raised member: the chip says what is wrong, the line says In review (D31, listLine)');
  go(window, `feature/${ROLLOUT.id}`); await settle(window, 8);
  const mm = doc.querySelector('.run-member[data-key="p-roll1"]');
  assert.equal(mm.dataset.state, 'needs-you');
  assert.equal(mm.querySelector('.runs-pr-word').textContent, 'Checks failing');
  go(window, `history/${KEY}/p-roll1`); await settle(window, 8);
  // Run 3 (D10): the run page's PR bar carries "PR #821", so its status line drops the second mention.
  assert.equal(doc.querySelector('#hist-detail .hd-glance .run-status').dataset.text, 'Needs you · Checks failing',
    'the run page reads what the list reads, without a second PR mention');
});

test('D5: a finished member still in the live map at $0 shows its stored cost in the list and on the feature page', async () => {
  const { window, doc, recv } = await boot({ runGroups: [ROLLOUT],
    history: [rollHist('p-roll1', { totalCostUsd: 135.95 }), rollHist('p-roll2', { totalCostUsd: 141.19 })] });
  recv({ type: 'hello', runs: [live('r-roll1', { pipelineId: 'p-roll1', status: 'done' }), live('r-roll2', { pipelineId: 'p-roll2', status: 'done' })] });
  go(window, 'runs'); await settle(window);
  const g = groupItem(doc, `chain:${ROLLOUT.id}`);
  assert.equal(g.querySelector('.runs-members a.runs-row[data-pipeline-id="p-roll1"]').title, 'Cost $135.95');
  assert.equal(g.querySelector(':scope > a.runs-row').title, 'Group total $313.70');
  go(window, `feature/${ROLLOUT.id}`); await settle(window, 8);
  const cost = (pid) => doc.querySelector(`.run-member[data-key="${pid}"] .run-member-cost`).textContent;
  assert.deepEqual([cost('p-roll1'), cost('p-roll2')], ['$135.95', '$141.19']);
});

test('D5: a single finished run still live at $0 and a feature\'s planning run show their stored cost', async () => {
  const grp = { ...ROLLOUT, planning: { pipelineId: 'p-plan', title: 'Planning', status: 'done' },
    cost: { usd: 9, byPipeline: { 'p-plan': 4.5, 'p-roll1': 2, 'p-roll2': 2.5 } }, members: ROLLOUT.members.slice(0, 2).map((m) => ({ ...m, pr: null })) };
  const { window, doc, recv } = await boot({ runGroups: [grp],
    history: [rollHist('p-solo', { totalCostUsd: 12.34 }), rollHist('p-plan', { totalCostUsd: 4.5 }), rollHist('p-roll1'), rollHist('p-roll2')] });
  recv({ type: 'hello', runs: [live('r-solo', { pipelineId: 'p-solo' }), live('r-plan', { pipelineId: 'p-plan', status: 'done' })] });
  recv({ type: 'done', runId: 'r-solo', status: 'done' });   // a run that ends live lingers until opened, at cost 0
  go(window, 'runs'); await settle(window);
  assert.equal(rowEl(doc, '[data-run-id="r-solo"]').title, 'Cost $12.34');
  go(window, `feature/${grp.id}`); await settle(window, 8);
  assert.equal(doc.querySelector('.run-member[data-key="planning"] .run-member-cost').textContent, '$4.50');
});

test('D4: a deep-linked feature page draws no PR chip until the PR state is known', async () => {
  const open = { url: 'https://github.com/acme/web/pull/822', number: 822, state: 'OPEN' };   // stored, no verdict
  const grp = { ...ROLLOUT, members: [{ ...ROLLOUT.members[0], pr: open }, ROLLOUT.members[1]] };
  const { window, doc, recv, prToken } = await boot({ runGroups: [grp], history: [rollHist('p-roll1')] });   // History has no `pr` yet
  recv({ type: 'hello', runs: [] });                          // the boot's History load (phase 1; phase 2 not answered)
  go(window, `feature/${grp.id}`); await settle(window, 8);
  const row = doc.querySelector('.run-member[data-key="p-roll1"]');
  assert.equal(row.querySelector('.runs-pr'), null, 'no green "Ready" before the state arrives');
  assert.equal(row.dataset.state, 'in-review');
  recv({ type: 'history-pr', token: prToken(), done: true, items: [{ projectKey: KEY, id: 'p-roll1',
    pr: { ...open, checks: { state: 'passing', total: 12, failed: 0, pending: 0 }, mergeable: 'MERGEABLE' } }] });
  await settle(window, 8);
  const after = doc.querySelector('.run-member[data-key="p-roll1"]');
  assert.equal(after.querySelectorAll('.runs-pr').length, 1, 'exactly one chip once the verdict lands');
  assert.equal(after.querySelector('.runs-pr-word').textContent, 'Ready');
});

test('D10/D11: a ticket queued after a feature slice sits in Waiting and names the group and the run', async () => {
  const tickets = [{ id: 't-docs', title: 'Nightly docs refresh', status: 'scheduled', runAt: '9999-12-31T00:00:00.000Z',
    createdAt: '2026-10-20T10:00:00Z', projectDir: PROJECT, after: { kind: 'pipeline', id: 'p-roll3', title: 'Forms', pipelineId: 'p-roll3' } }];
  const { window, doc, recv } = await boot({ runGroups: [ROLLOUT], tickets,
    history: [rollHist('p-roll1', { totalCostUsd: 135.95 }), rollHist('p-roll2', { totalCostUsd: 141.19 })] });
  recv({ type: 'hello', runs: [live('r-roll3', { pipelineId: 'p-roll3' })] });
  go(window, 'runs'); await settle(window, 8);
  assert.deepEqual([...doc.querySelectorAll('#runs-list .runs-sec')].map((s) => s.dataset.section), ['needs', 'waiting']);
  const row = groupItem(doc, 'sched:t-docs');
  assert.equal(row.closest('.runs-sec').dataset.section, 'waiting');
  assert.equal(row.querySelector('.runs-row-sub').textContent, 'Waiting · starts after Complete Design Language Rollout · run 3');
});

// ── Run 3: the Runs navigation — every row opens its own page in the pane (D1-D5) ──
test('run 3: a feature row opens the feature page in the pane; the list stays; a member opens beside it', async () => {
  const { window, doc, recv } = await boot({ runGroups: [FEATURE_GROUP], history: [] });
  recv({ type: 'hello', runs: [live('r-live', { pipelineId: 'p-live' })] });   // member 1 (p-live) is the running one
  go(window, 'runs'); await settle(window);
  const row = () => groupItem(doc, `chain:${FEATURE_GROUP.id}`).querySelector(':scope > a.runs-row');
  click(window, row()); await settle(window);
  assert.equal(window.location.hash, `#feature/${FEATURE_GROUP.id}`);
  assert.equal(doc.querySelector('[data-view="runs"]').classList.contains('hidden'), false, 'the list stays');
  const pane = doc.querySelector('#runs-pane');
  assert.equal(pane.dataset.kind, 'group');
  assert.ok(pane.querySelector('#group-detail .gpage'), 'the group page renders inside #runs-pane');
  assert.ok(row().classList.contains('selected'));
  assert.equal(row().getAttribute('aria-current'), 'true');
  assert.equal(doc.querySelectorAll('#runs-list .runs-row.selected').length, 1);
  // member 1 is live: its title in the runs table links #running/r-live; opening it turns the group row member-open
  const member = pane.querySelector('#group-detail .run-member-title');
  assert.ok(member.getAttribute('href'), 'the live member row links its run');
  go(window, member.getAttribute('href').slice(1)); await settle(window);
  assert.equal(pane.dataset.kind, 'live');
  assert.equal(row().classList.contains('selected'), false);
  assert.ok(row().classList.contains('member-open'));
  assert.equal(row().getAttribute('aria-current'), 'location');
  const memberRow = doc.querySelector(`#runs-list [data-row-key="chain:${FEATURE_GROUP.id}"] .runs-members a.runs-row[data-run-id="r-live"]`);
  assert.ok(memberRow && memberRow.classList.contains('selected'), 'the member row is .selected');
});

test('run 3: ⌄ only toggles; a chain row links its #group page', async () => {
  const { window, doc, recv } = await boot({ chains: CHAIN2(), history: [] });
  recv({ type: 'hello', runs: [live('r1', { pipelineId: 'pchain01' })] });
  go(window, 'runs'); await settle(window);
  const it = groupItem(doc, 'chain:p:pchain01');
  assert.equal(it.querySelector(':scope > a.runs-row').getAttribute('href'), `#group/${encodeURIComponent('p:pchain01')}`);
  const before = window.location.hash;
  click(window, it.querySelector('.runs-expand')); await settle(window);
  assert.equal(window.location.hash, before);
});

test('run 3: #runs reopens the group page the pane showed last', async () => {
  const { window, doc } = await boot({ runGroups: [FEATURE_GROUP], history: [] });
  go(window, `feature/${FEATURE_GROUP.id}`); await settle(window);
  assert.match(String(window.localStorage.getItem('worca-cc.runs.last')), /feature\//);
  go(window, 'schedules'); await settle(window);
  go(window, 'runs'); await settle(window);
  assert.equal(window.location.hash, `#feature/${FEATURE_GROUP.id}`);
  assert.ok(doc.querySelector('#group-detail .gpage'));
});

test('run 3: a gone group clears the memory and #runs reopens nothing stale', async () => {
  const { window, doc } = await boot({ runGroups: [], history: [], storage: { 'worca-cc.runs.last': JSON.stringify({ group: 'feature/feat_gone' }) } });
  go(window, 'feature/feat_gone'); await settle(window);
  assert.match(doc.querySelector('#group-detail').textContent, /no longer exists/);
  assert.ok(!String(window.localStorage.getItem('worca-cc.runs.last') || '').includes('feat_gone'));
  go(window, 'schedules'); await settle(window);
  go(window, 'runs'); await settle(window);
  assert.ok(!window.location.hash.includes('feat_gone'));
});

test('run 3: all four deep links render inside #runs-pane with Runs visible', async () => {
  // each hash needs its data seeded: the feature, a chain, a History row and a live run
  const cases = [[`feature/${FEATURE_GROUP.id}`, 'group'], ['group/p%3Apchain01', 'group'], [`history/${KEY}/aaaa0001`, 'hist'], ['running/r1', 'live']];
  for (const [hash, kind] of cases) {
    const { window, doc, recv } = await boot({ runGroups: [FEATURE_GROUP], chains: CHAIN2(), history: HIST });
    recv({ type: 'hello', runs: [live('r1', { pipelineId: 'pchain01' })] });
    go(window, hash); await settle(window, 8);
    assert.equal(doc.querySelector('[data-view="runs"]').classList.contains('hidden'), false, hash);
    const pane = doc.querySelector('#runs-pane');
    assert.equal(pane.dataset.kind, kind, hash);
    assert.ok(pane.querySelector({ group: '#group-detail .gpage', hist: '#hist-detail .hd', live: '#run-detail .rd' }[kind]), `${hash} renders inside #runs-pane`);
    assert.ok(doc.querySelectorAll('#runs-list .runs-row.selected').length <= 1, hash);
    window.close();
  }
});

test('run 3: on a phone (slide layout) the group pane is full screen with Back, in its page, gone and error states', async () => {
  const fail = (window) => {
    const f = window.fetch;
    window.fetch = globalThis.fetch = (u, init) => (String(u).endsWith('/api/run-groups')
      ? Promise.resolve({ ok: false, status: 500, json: async () => ({}) }) : f(u, init));
  };
  for (const [id, prep, text] of [[FEATURE_GROUP.id, null, null], ['feat_unlisted', null, /no longer exists/], [FEATURE_GROUP.id, fail, /Could not load/]]) {
    const { window, doc, recv } = await boot({ runGroups: [FEATURE_GROUP], history: [] });
    if (prep) { prep(window); recv({ type: 'run-groups-changed' }); await settle(window); }
    go(window, 'runs'); await settle(window);
    doc.getElementById('runs-shell').dataset.layout = 'slide';
    go(window, `feature/${id}`); await settle(window, 6);
    assert.equal(doc.getElementById('runs-list-pane').hasAttribute('inert'), true, `${id}: the list is inert`);
    const back = doc.querySelector('#group-detail .gpage-back');
    assert.ok(back, `${id}: the group pane carries Back`);
    assert.equal(doc.activeElement, back, `${id}: focus lands on Back`);
    if (text) assert.match(doc.querySelector('#group-detail').textContent, text);
    back.click(); await settle(window, 6);
    assert.equal(window.location.hash, '#runs', `${id}: Back returns to the list`);
    window.close();
  }
});
test('slice 2: side by side (split) the group Back shows the list, with the group pane closed', async () => {
  const { window, doc } = await boot({ runGroups: [FEATURE_GROUP], history: [] });
  go(window, 'runs'); await settle(window);
  doc.getElementById('runs-shell').dataset.layout = 'split';
  go(window, `feature/${FEATURE_GROUP.id}`); await settle(window, 6);
  const shell = doc.getElementById('group-shell');
  assert.ok(shell.classList.contains('detail-open'));
  doc.querySelector('#group-detail .gpage-back').click(); await settle(window, 6);
  assert.equal(window.location.hash, '#runs');
  assert.equal(shell.classList.contains('detail-open'), false, 'the group page closed');
  window.dispatchEvent(new window.Event('hashchange')); await settle(window, 6);
  assert.equal(shell.classList.contains('detail-open'), false, 'and is not reopened by the D6 restore');
  window.close();
});

// Dividers (running rows lost their line?): jsdom drops `border-bottom:1px solid var(--line)` from getComputedStyle,
// so the cascade's inputs are checked instead. Every style.css rule that declares a border (top-level or inside any
// @media, so the 375px rules count too) is matched against the rendered row with el.matches().
const STYLE_CSS = readFileSync(join(__dir, '..', 'ui', 'public', 'style.css'), 'utf8');
const BORDER_DECL = /(^|[;{\s])border(-bottom|-top)?(-(color|width|style))?\s*:/;
function borderRules(doc) {
  const st = doc.createElement('style');
  st.textContent = STYLE_CSS;
  doc.head.append(st);
  const out = [];
  const walk = (list) => {
    for (const r of list) {
      if (r.selectorText) { if (BORDER_DECL.test(r.style.cssText)) out.push(r); }
      else if (r.cssRules) walk(r.cssRules);   // @media / @supports bodies; @keyframes children have no selectorText
    }
  };
  walk(st.sheet.cssRules);
  return out;
}
const borderHits = (rules, el) => rules.filter((r) => { try { return el.matches(r.selectorText); } catch { return false; } })
  .map((r) => r.selectorText);
const DIVIDER = '.runs-item';   // style.css: .runs-item{…border-bottom:1px solid var(--line);}
const CHAINS_2 = () => ['pchain01', 'pchain02'].map((pid, i) => ({ id: `p:${pid}`, title: `Chain ${i + 1}`, members: [
  { pipelineId: pid, ticketId: null, state: 'current', title: `Chain ${i + 1} root`, projectDir: PROJECT, after: null },
  { pipelineId: null, ticketId: `tick${i}`, state: 'waiting', title: `Chain ${i + 1} next`, projectDir: PROJECT, after: 1 }] }));

test('dividers: two running runs and two running groups each keep one --line divider, in both views', async () => {
  for (const groupBy of ['none', 'project']) {
    const { window, doc, recv } = await boot({ chains: CHAINS_2(), storage: VIEW({ groupBy }) });
    recv({ type: 'hello', runs: [live('r1', { pipelineId: 'pchain01' }), live('r2', { pipelineId: 'pchain02' }), live('r3'), live('r4')] });
    go(window, 'runs'); await settle(window);
    const rules = borderRules(doc);
    const base = rules.find((r) => r.selectorText === DIVIDER);
    assert.ok(base && /border-bottom:\s*1px solid var\(--line\)/.test(base.style.cssText), 'the one divider rule is intact');
    const groups = ['chain:p:pchain01', 'chain:p:pchain02'].map((k) => groupItem(doc, k));
    const runsTop = ['r3', 'r4'].map((id) => itemOf(doc, `[data-run-id="${id}"]`));
    for (const [what, items] of [['running group', groups], ['running run', runsTop]]) {
      for (const it of items) {
        assert.ok(it, `${what} is drawn (${groupBy})`);
        assert.equal(it.dataset.level, 'top');
        // A plain row: not Needs you, not selected, not a group whose run is open (the three designed exceptions).
        assert.ok(!it.classList.contains('is-needs'), `${what} is not a Needs-you row`);
        assert.equal(it.querySelector(':scope > a.runs-row.selected, :scope > a.runs-row.member-open'), null, `${what} is not highlighted`);
        // Only the divider rule: nothing hides it (transparent / 0), recolours it, or adds a second (top) border.
        assert.deepEqual(borderHits(rules, it), [DIVIDER], `${what} ${it.dataset.rowKey} keeps exactly one divider (${groupBy})`);
      }
    }
    // Running groups open by default; their members still draw none (the members rule is untouched).
    for (const g of groups) {
      assert.equal(g.querySelector(':scope > .runs-row-tail .runs-expand').getAttribute('aria-expanded'), 'true');
      for (const m of g.querySelectorAll(':scope > .runs-members > .runs-item')) {
        assert.ok(borderHits(rules, m).includes('.runs-members > .runs-item'), 'a member row draws no divider');
      }
      assert.deepEqual(borderHits(rules, g.querySelector(':scope > .runs-members')), [], 'the members list adds no line');
    }
    window.close();
  }
});

test('dividers: a highlighted row (selected, Needs you, collapsed group with its run open) still drops its own', async () => {
  const { window, doc, recv } = await boot({ chains: CHAINS_2(), history: [] });
  recv({ type: 'hello', runs: [live('r1', { pipelineId: 'pchain01' }), live('r3')] });
  go(window, 'runs'); await settle(window);
  const rules = borderRules(doc);
  // Probes carry the real classes, appended and removed in one go (as tools/verify-runs-list-cdp.mjs does).
  const row = itemOf(doc, '[data-run-id="r3"]');
  const probe = (cls, inner) => { const p = row.cloneNode(false); if (cls) p.classList.add(cls); p.innerHTML = inner; row.after(p); return p; };
  const sel = probe('', '<a class="runs-row selected"></a>');
  const needs = probe('is-needs', '<a class="runs-row"></a>');
  const openShut = probe('', '<a class="runs-row member-open"></a>');
  const openExpanded = probe('', '<a class="runs-row member-open"></a><div class="runs-members"></div>');
  assert.ok(borderHits(rules, sel).includes('.runs-item:has(> a.runs-row.selected)'));
  assert.ok(borderHits(rules, needs).includes('.runs-item.is-needs'));
  assert.ok(borderHits(rules, openShut).includes('.runs-item:has(> a.runs-row.member-open):not(:has(> .runs-members))'));
  assert.deepEqual(borderHits(rules, openExpanded), [DIVIDER], 'an expanded group whose run is open keeps its divider');
  for (const p of [sel, needs, openShut, openExpanded]) p.remove();
  window.close();
});

// ── The list keys (list-keys.mjs, issue #948): one Tab stop, a moving focus, letter keys on the row or the selection ──
const stops = (doc) => [...doc.querySelectorAll('#runs-list a.runs-row, #runs-list button.runs-sec-head')].filter((n) => n.tabIndex === 0);
const press = (window, node, key, o = {}) => {
  const ev = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...o });
  node.dispatchEvent(ev);
  return ev;
};
const rows = (doc) => [...doc.querySelectorAll('#runs-list a.runs-row')];
function oneStop(doc, why) {
  assert.equal(stops(doc).length, 1, `one Tab stop ${why}`);
  for (const b of doc.querySelectorAll('#runs-list .runs-more, #runs-list .runs-expand, #runs-list .runs-check')) assert.equal(b.tabIndex, -1, `${b.className} ${why}`);
}
const MORE = { id: 'aaaa0003', projectKey: KEY, projectName: 'proj', projectDir: PROJECT, title: 'Third thing', status: 'done',
  startedAt: '2026-09-29T07:00:00Z', mtime: 1 };

test('list keys: one Tab stop on every paint (boot, unfold, Show, ⇧↓, a live row), and it follows the focus', async () => {
  const { window, doc, recv } = await boot({ runGroups: [FEATURE_GROUP] });
  recv({ type: 'hello', runs: [live('r-live', { pipelineId: 'p-live' })] });
  go(window, 'runs'); await settle(window);
  oneStop(doc, 'after boot');
  const g = () => groupItem(doc, `chain:${FEATURE_GROUP.id}`).querySelector(':scope > a.runs-row');
  g().focus();
  press(window, g(), 'ArrowLeft'); await settle(window);
  press(window, g(), 'ArrowRight'); await settle(window);
  oneStop(doc, 'after the group unfolds');
  await pickView(window, doc, 'Archived');
  oneStop(doc, 'under Show = Archived');
  await pickView(window, doc, 'All');
  oneStop(doc, 'back on All');
  rows(doc)[0].focus();
  press(window, rows(doc)[0], 'ArrowDown', { shiftKey: true }); await settle(window);
  oneStop(doc, 'after ⇧↓');
  const second = rows(doc)[1];
  second.focus();
  const key = second.dataset.rowKey;
  recv({ type: 'run-created', runId: 'r-new', title: 'New one', projectDir: PROJECT, status: 'running', kind: 'run', startedAt: '10:01:00' });
  await settle(window);
  assert.ok(rowEl(doc, '[data-run-id="r-new"]'), 'the live row is listed');
  oneStop(doc, 'after a live row');
  assert.equal(stops(doc)[0].dataset.rowKey, key, 'the stop stays on the focused row');
});

test('list keys: j moves to the next row and Enter opens it', async () => {
  const { window, doc } = await boot();
  go(window, 'runs'); await settle(window);
  const [first, second] = rows(doc);
  first.focus();
  press(window, first, 'j');
  assert.equal(doc.activeElement, second);
  press(window, second, 'Enter'); await settle(window);
  assert.equal(window.location.hash, second.getAttribute('href'));
});

test('list keys: E archives an idle finished row with Undo; on a working row it posts nothing', async () => {
  const { window, doc, recv, posts } = await boot({ bulk: () => ({ ok: true, action: 'archive', done: [{ id: 'aaaa0001', title: 'Merged thing' }], cancelled: [], skipped: [] }) });
  recv({ type: 'hello', runs: [live('r1')] });
  go(window, 'runs'); await settle(window);
  const working = rowEl(doc, '[data-run-id="r1"]');
  working.focus();
  press(window, working, 'e'); await settle(window, 8);
  assert.equal(posts.length, 0, 'a running row has nothing to archive');
  const done = rowEl(doc, '[data-pipeline-id="aaaa0001"]');
  done.focus();
  press(window, done, 'e'); await settle(window, 8);
  assert.equal(posts.at(-1).action, 'archive');
  assert.match(JSON.stringify(posts.at(-1).targets), /aaaa0001/);
  const toast = doc.querySelector('#toasts .toast');
  assert.equal(toast.querySelector('.tt').textContent, 'Archived 1 run');
  assert.equal(toast.querySelector('.toast-act').textContent, 'Undo');
});

test('list keys: in Show = Archived, E restores and the ⋯ reads Restore with hint E', async () => {
  const { window, doc, posts } = await boot({ storage: VIEW({ show: 'archived' }),
    bulk: () => ({ ok: true, action: 'restore', done: [{ id: 'cccc0009', title: 'Archived thing' }], cancelled: [], skipped: [] }) });
  go(window, 'runs'); await settle(window, 8);
  const row = () => rowEl(doc, '[data-pipeline-id="cccc0009"]');
  click(window, row().closest('.runs-item').querySelector(':scope > .runs-row-tail .runs-more'));
  const restore = [...doc.querySelectorAll('.wfv-menu [role^="menuitem"]')].find((n) => n.querySelector('.wfv-menu-l').textContent === 'Restore');
  assert.ok(restore, 'the archived row offers Restore');
  assert.equal(restore.querySelector('.wfv-menu-hint').textContent, 'E');
  press(window, doc.querySelector('.wfv-menu [role^="menuitem"]'), 'Escape');
  row().focus();
  press(window, row(), 'e'); await settle(window, 8);
  assert.equal(posts.at(-1).action, 'restore');
  assert.equal(doc.querySelector('#toasts .toast .tt').textContent, 'Restored 1 run');
});

test('list keys: ⌫ opens the Delete confirm on Cancel from Advanced; at Simple it does nothing', async () => {
  const { applyLevel } = await import('../ui/public/ui-level.mjs');
  const { window, doc, confirmWith } = await boot();
  go(window, 'runs'); await settle(window);
  const row = rowEl(doc, '[data-pipeline-id="aaaa0002"]');
  applyLevel('simple', doc);
  row.focus();
  press(window, row, 'Backspace'); await settle(window);
  assert.equal(doc.getElementById('confirm-modal').classList.contains('hidden'), true, 'Simple has no Delete');
  applyLevel('expert', doc);
  press(window, row, 'Backspace'); await settle(window);
  assert.equal(doc.getElementById('confirm-modal').classList.contains('hidden'), false);
  assert.match(doc.getElementById('confirm-modal').textContent, /Delete 1 run permanently\?/);
  assert.equal(doc.activeElement.id, 'confirm-cancel');
  await confirmWith(false);
});

test('list keys: the row ⋯ shows each item\'s key on a Mac', async () => {
  const { window, doc } = await boot({ setup: (w) => Object.defineProperty(w.navigator, 'platform', { value: 'MacIntel', configurable: true }) });
  go(window, 'runs'); await settle(window);
  click(window, itemOf(doc, '[data-pipeline-id="aaaa0001"]').querySelector(':scope > .runs-row-tail .runs-more'));
  const hints = [...doc.querySelectorAll('.wfv-menu .wfv-menu-hint')].map((h) => h.textContent);
  for (const h of ['Space', 'S', 'E', '⌫']) assert.ok(hints.includes(h), `hint ${h} in ${hints.join(' ')}`);
});

test('list keys: ? opens one Keyboard shortcuts sheet; Esc closes it and keeps the selection; View › Keyboard shortcuts too', async () => {
  const { window, doc } = await boot();
  go(window, 'runs'); await settle(window);
  const first = rows(doc)[0];
  first.focus();
  press(window, first, ' '); await settle(window);
  assert.equal(doc.querySelectorAll('#runs-list .runs-item.is-checked').length, 1);
  press(window, doc.activeElement, '?', { shiftKey: true });
  assert.equal(doc.querySelectorAll('.keys-modal').length, 1);
  press(window, doc.activeElement, 'Escape'); await settle(window);
  assert.equal(doc.querySelectorAll('.keys-modal').length, 0);
  assert.equal(doc.querySelectorAll('#runs-list .runs-item.is-checked').length, 1, 'Esc closed the sheet, not the selection');
  await pickView(window, doc, 'Keyboard shortcuts');
  assert.equal(doc.querySelectorAll('.keys-modal').length, 1);
  click(window, doc.querySelector('.keys-modal .keys-close'));
  assert.equal(doc.activeElement, doc.getElementById('runs-view-btn'));
});

test('list keys: ? opens nothing while typing or over a row menu; on the Chat page it opens the Chat sheet, not the Runs one', async () => {
  const { window, doc } = await boot();
  go(window, 'runs'); await settle(window);
  const input = doc.getElementById('tsearch-input');
  input.focus();
  press(window, input, '?', { shiftKey: true });
  assert.equal(doc.querySelectorAll('.keys-modal').length, 0, 'typing ? in the search');
  click(window, itemOf(doc, '[data-pipeline-id="aaaa0001"]').querySelector(':scope > .runs-row-tail .runs-more'));
  press(window, doc.activeElement, '?', { shiftKey: true });
  assert.equal(doc.querySelectorAll('.keys-modal').length, 0, 'over the row ⋯ menu');
  press(window, doc.activeElement, 'Escape');
  go(window, 'chat/new'); await settle(window);
  press(window, doc.body, '?', { shiftKey: true });
  const heads = [...doc.querySelectorAll('.keys-modal h3.keys-h')].map((n) => n.textContent);
  assert.ok(heads.includes('Chat page') && !heads.includes('Runs list'), 'on the Chat page');
});

test('list keys: Enter on a focused ⋯ keeps the button\'s own Enter (no open, no hash change)', async () => {
  const { window, doc } = await boot();
  go(window, 'runs'); await settle(window);
  const before = window.location.hash;
  const more = itemOf(doc, '[data-pipeline-id="aaaa0001"]').querySelector(':scope > .runs-row-tail .runs-more');
  more.focus();
  const ev = press(window, more, 'Enter');
  assert.equal(ev.defaultPrevented, false, 'the list keys leave Enter to the button');
  click(window, more);   // what the browser's native Enter on a button does
  assert.equal(doc.querySelectorAll('.wfv-menu').length, 1);
  assert.equal(window.location.hash, before);
});

test('list keys: with a selection, E on the View button or the bar\'s Archive posts nothing', async () => {
  const { window, doc, posts } = await boot();
  go(window, 'runs'); await settle(window);
  tick(window, itemOf(doc, '[data-pipeline-id="aaaa0001"]').querySelector('.runs-check'));
  await settle(window);
  for (const b of [doc.getElementById('runs-view-btn'), doc.querySelector('#runs-bulk [data-bulk="archive"]')]) {
    b.focus();
    press(window, b, 'e'); await settle(window, 8);
  }
  assert.equal(posts.length, 0);
});

test('list keys: E on the second of 3 finished rows leaves the focus on the row that was third', async () => {
  let hist = [...HIST, MORE];
  let late = false;   // after the archive, History answers a beat later, as it does over the network
  const { window, doc, posts } = await boot({ history: () => (late ? new Promise((r) => setTimeout(() => r(hist), 30)) : hist), bulk: (body) => {
    const id = body.targets[0].pipelineId;
    hist = hist.filter((p) => p.id !== id);
    late = true;
    return { ok: true, action: 'archive', done: [{ id, title: id }], cancelled: [], skipped: [] };
  } });
  go(window, 'runs'); await settle(window);
  const [, second, third] = rows(doc);
  const thirdKey = third.dataset.rowKey;
  second.focus();
  press(window, second, 'e'); await settle(window, 8);
  assert.equal(doc.activeElement, second, 'the row keeps the focus until History drops it');
  await new Promise((r) => setTimeout(r, 60)); await settle(window);
  assert.equal(posts.length, 1);
  assert.equal(doc.querySelector(`#runs-list a.runs-row[data-row-key="${second.dataset.rowKey}"]`), null, 'the repaint dropped it');
  assert.equal(doc.activeElement.dataset.rowKey, thirdKey);
});

test('list keys: → / ← fold a group row; j skips a folded group\'s members and enters an open one', async () => {
  const { window, doc, recv } = await boot({ runGroups: [FEATURE_GROUP] });
  recv({ type: 'hello', runs: [live('r-live', { pipelineId: 'p-live' })] });
  go(window, 'runs'); await settle(window);
  const gi = () => groupItem(doc, `chain:${FEATURE_GROUP.id}`);
  const g = () => gi().querySelector(':scope > a.runs-row');
  const tog = () => gi().querySelector(':scope > .runs-row-tail .runs-expand');
  g().focus();
  press(window, g(), 'ArrowLeft'); await settle(window);
  assert.equal(tog().getAttribute('aria-expanded'), 'false');
  assert.equal(doc.activeElement, g(), 'the repaint keeps the group row focused');
  const after = rows(doc)[rows(doc).indexOf(g()) + 1];
  assert.equal(after.closest('.runs-item').dataset.level, 'top');
  press(window, g(), 'j');
  assert.equal(doc.activeElement, after, 'j skips the folded members');
  g().focus();
  press(window, g(), 'ArrowRight'); await settle(window);
  assert.equal(tog().getAttribute('aria-expanded'), 'true');
  press(window, g(), 'j');
  assert.equal(doc.activeElement, gi().querySelector('.runs-members a.runs-row'), 'j enters the open group');
});

test('list keys: ⇧↓ from the first row selects two rows and shows the bar', async () => {
  const third = { ...HIST[1], id: 'aaaa0003', title: 'Third thing', startedAt: '2026-09-29T07:00:00Z', mtime: 1 };
  const { window, doc } = await boot({ history: [...HIST, third] });
  go(window, 'runs'); await settle(window);
  const first = rows(doc)[0];
  first.focus();
  press(window, first, 'ArrowDown', { shiftKey: true }); await settle(window);
  assert.equal(doc.querySelectorAll('#runs-list .runs-item.is-checked').length, 2);
  assert.equal(doc.getElementById('runs-bulk').hidden, false);
  // The rebuild's own refocus of the old row must not win: the first press already moves the focus.
  assert.equal(doc.activeElement, rows(doc)[1], 'the first ⇧↓ moves the focus to the second row');
  press(window, doc.activeElement, 'ArrowDown', { shiftKey: true }); await settle(window);
  assert.equal(doc.querySelectorAll('#runs-list .runs-item.is-checked').length, 3, 'a second ⇧↓ extends to three rows');
  assert.equal(doc.activeElement, rows(doc)[2]);
  press(window, doc.activeElement, 'ArrowUp', { shiftKey: true }); await settle(window);
  assert.equal(doc.activeElement, rows(doc)[1], '⇧↑ steps the focus back one row');
});
