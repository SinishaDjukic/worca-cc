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
  const item = [...doc.querySelectorAll('.wfv-menu [role^="menuitem"]')].find((n) => n.querySelector('.wfv-menu-l').textContent === label);
  assert.ok(item, `the View menu lists ${label}`);
  click(window, item);
  await settle(window);
}

// `setup(window)` runs before app.js loads: a stub its module-load wiring must see goes there.
// `runGroups` answers GET /api/run-groups with the array's current contents; `onGroupCall` sees each POST / DELETE on
// /api/run-groups* (logged in `groupPosts`); `bulk(body)` answers POST /api/runs/bulk (bodies logged in `posts`).
async function boot({ url = 'http://localhost:4317/', storage = {}, projects = [{ name: 'proj', path: PROJECT, exists: true }], history = HIST, archived = [ARCH], chains = [],
  runGroups = [], onGroupCall = () => {}, bulk = () => ({ ok: true, done: [], cancelled: [], skipped: [] }), setup, tickets = [] } = {}) {
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
  const ok =(body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
  window.fetch = (u, init = {}) => {
    const s = String(u);
    const method = (init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : null;
    if (s.endsWith('/api/runs/bulk') && method === 'POST') { posts.push(body); return ok(bulk(body)); }
    if (s.includes('/api/run-groups') && method !== 'GET') { groupPosts.push({ method, url: s, body }); onGroupCall({ method, url: s, body }); return ok({ ok: true }); }
    if (s.endsWith('/api/run-groups')) return ok({ groups: runGroups });
    if (s.includes('/api/projects')) return ok({ projects });
    // `history` may be a function: a test that reloads History can answer differently each time.
    if (s.includes('/api/history?archived=1')) return ok({ pipelines: archived, ghAvailable: true });
    if (s.endsWith('/api/history')) return ok({ pipelines: typeof history === 'function' ? history() : history, ghAvailable: true });
    // The detail itself only: a looser match would answer its /log, /diff and /comments with a state body.
    if (/\/api\/history\/[^/]+\/aaaa000[12]$/.test(s)) return ok({ state: { title: 'Merged thing', status: 'done', steps: [], stepper: null } });
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
  return { window, doc: window.document, recv, posts, groupPosts, schedCalls, confirmWith };
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
      const items = [...doc.querySelectorAll('.wfv-menu [role="menuitemradio"]')].map((n) => [n.querySelector('.wfv-menu-l').textContent, n.querySelector('.wfv-menu-hint')?.textContent || '']);
      assert.deepEqual(items.slice(0, 5), [['All', '3'], ['Needs you', '0'], ['Running', '1'], ['Finished', '2'], ['Archived', '']]);
      click(window, doc.querySelector('.wfv-menu [role="menuitemradio"]'));   // All again: closes it
      await settle(window);
      await pickView(window, doc, 'Finished');
      assert.deepEqual(titles().sort(), ['Merged thing', 'Stopped thing']);
      assert.equal(chip.hidden, false);
      assert.equal(chip.querySelector('.runs-view-chip-t').textContent, 'Finished · 2 of 3 runs');
      await pickView(window, doc, 'Running');
      assert.deepEqual(titles(), ['r-live']);
      assert.deepEqual(JSON.parse(window.localStorage.getItem('worca-cc.runs.view')), { show: 'running', groupBy: 'none', person: '' });
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
      assert.deepEqual(JSON.parse(window.localStorage.getItem('worca-cc.runs.view')), { show: 'running', groupBy: 'project', person: '' });
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
  assert.equal(member.querySelector('.runs-indep').textContent, 'Independent');
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
test('badge: 2 runs need you → sidebar "?" + "2" and title "(2) ? Worca"; none → "Worca"', async () => {
  // applyBadge writes the title only with the badge setting on; it follows notify, which defaults to off
  // (readAlertSettings, ui/public/alerts.mjs), and boot() clears localStorage.
  const { window, doc, recv } = await boot({ storage: { 'worca-cc.alerts.badge': '1' } });
  recv({ type: 'hello', runs: [live('a', { pendingQuestion: { id: 'q', kind: 'plan' } }), live('b', { status: 'paused', pauseReason: 'usage_limit' }), live('c')] });
  await settle(window);
  const nc = doc.getElementById('nav-needs-count');
  assert.equal(nc.hidden, false);
  assert.ok(nc.querySelector('.status-dot[data-state="needs-you"] svg.status-sym'));
  assert.equal(nc.querySelector('.nav-count-n').textContent, '2');
  assert.equal(window.document.title, '(2) ? Worca');
  recv({ type: 'done', runId: 'a', status: 'stopped' });
  recv({ type: 'done', runId: 'b', status: 'stopped' });
  await settle(window);
  assert.equal(window.document.title, 'Worca');
  assert.equal(nc.hidden, true);
});

test('D31: a PR with failing checks lists in Needs you with "Checks failing" until a live fix run makes it Fixing', async () => {
  const pr = { url: 'https://github.com/o/r/pull/781', number: 781, state: 'OPEN', checks: { state: 'failing', total: 12, failed: 3, pending: 0 } };
  const { window, doc, recv } = await boot({ history: [{ ...HIST[0], id: 'aaaa0005', title: 'Red CI', pr }] });
  go(window, 'runs'); await settle(window);
  const item = () => itemOf(doc, '[data-pipeline-id="aaaa0005"]');
  assert.equal(item().closest('.runs-sec').dataset.section, 'needs');
  assert.ok(item().querySelector(':scope > .runs-pick .status-dot[data-state="needs-you"] svg.status-sym'));
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
