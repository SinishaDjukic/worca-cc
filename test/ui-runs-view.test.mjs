// test/ui-runs-view.test.mjs — the Runs page: one compact list beside a content pane.
// boot() / settle() / go() follow test/ui-running-routing.test.mjs (no shared harness, by convention).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

const __dir = dirname(fileURLToPath(import.meta.url));
const htmlPath = join(__dir, '..', 'ui', 'public', 'index.html');
const appPath = join(__dir, '..', 'ui', 'public', 'app.js');
const PROJECT = '/tmp/proj';
const KEY = 'proj-0000abcd';
// A second project: with rows from one project the list has no project headers (#724).
const OTHER_DIR = '/tmp/other';
const OTHER_KEY = 'other-0000ef01';
// Finished minutes ago: Active's Recent lists only runs finished in the last 7 days (#724).
const RECENT = Date.now();
const HIST = [
  { id: 'aaaa0001', projectKey: KEY, projectName: 'proj', projectDir: PROJECT, title: 'Merged thing', status: 'done',
    startedAt: '2026-09-29T09:18:00Z', mtime: RECENT - 60_000, pr: { number: 7, state: 'MERGED', url: 'https://example.test/7' } },
  { id: 'aaaa0002', projectKey: KEY, projectName: 'proj', projectDir: PROJECT, title: 'Stopped thing', status: 'stopped',
    startedAt: '2026-09-29T08:00:00Z', mtime: RECENT - 120_000 },
];
const OTHER_HIST = { id: 'bbbb0001', projectKey: OTHER_KEY, projectName: 'other', projectDir: OTHER_DIR, title: 'Other thing',
  status: 'done', startedAt: '2026-09-29T07:00:00Z', mtime: RECENT - 180_000 };
const windows = [];
afterEach(() => { while (windows.length) windows.pop().close(); });

// An archived row as GET /api/history?archived=1 serves it: the row is flagged, the
// stamp rides along, and the branch/worktree behind it are gone.
const ARCH = { id: 'cccc0009', projectKey: KEY, projectName: 'proj', projectDir: PROJECT,
  title: 'Archived thing', status: 'done', startedAt: '2026-09-01T09:00:00Z', mtime: 1,
  archived: true, archivedAt: '2026-09-01T10:00:00Z' };

async function settle(window, n = 4) { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); }
function go(window, hash) { window.location.hash = hash; window.dispatchEvent(new window.Event('hashchange')); }
const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));
// Pick a View menu item (#740): open View, click the item; the pick closes the menu.
async function pickView(window, doc, sel) {
  click(window, doc.getElementById('runs-view-btn')); await settle(window);
  click(window, doc.querySelector(`#runs-view-menu ${sel}`)); await settle(window);
}
const checked = (doc, sel) => doc.querySelector(`#runs-view-menu ${sel}`).getAttribute('aria-checked');
const live = (runId, extra = {}) => ({ runId, title: runId, projectDir: PROJECT, status: 'running', kind: 'run',
  startedAt: '10:00:00', pendingQuestion: null, ...extra });

// `setup(window)` runs before app.js loads: a stub its module-load wiring must see goes there.
async function boot({ url = 'http://localhost:4317/', storage = {}, projects = [{ name: 'proj', path: PROJECT, exists: true }], history = HIST, archived = [ARCH], chains = [], setup } = {}) {
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
  const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
  window.fetch = (u) => {
    const s = String(u);
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
    if (s.endsWith('/api/schedules')) return ok({ schedules: [], tickets: [], counts: {}, chains });
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
  return { window, doc: window.document, recv };
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

test('a live run groups with its registered project even before History loads', async () => {
  const { window, doc, recv } = await boot({
    projects: [{ name: 'proj', path: PROJECT, exists: true, key: KEY }, { name: 'other', path: OTHER_DIR, exists: true, key: OTHER_KEY }], history: [],
  });
  recv({ type: 'hello', runs: [live('r1'), live('r2', { projectDir: OTHER_DIR })] });
  go(window, 'runs'); await settle(window);
  const group = doc.querySelector('#runs-list .runs-row[data-run-id="r1"]').closest('.runs-group');
  assert.equal(group.dataset.projectKey, KEY);
  assert.equal(group.dataset.groupKey, `running/${KEY}`, 'Active scopes the fold key to its section');
});

test('a finished run opens its saved page in the same pane and closes the live one', async () => {
  const { window, doc, recv } = await boot();
  recv({ type: 'hello', runs: [live('r1')] });
  go(window, 'running/r1'); await settle(window);
  const hrow = doc.querySelector(`#runs-list .runs-row[data-pipeline-id="aaaa0001"][data-project-key="${KEY}"]`);
  assert.ok(hrow);
  assert.equal(hrow.querySelector('.runs-row-sub').textContent.split(' · ')[0], 'Merged');
  click(window, hrow); await settle(window);
  assert.equal(window.location.hash, `#history/${KEY}/aaaa0001`);
  assert.ok(doc.getElementById('hist-shell').classList.contains('detail-open'));
  assert.equal(doc.getElementById('run-shell').classList.contains('detail-open'), false);
  assert.equal(doc.getElementById('run-detail').innerHTML, '', 'a detail -> detail hop swaps the pane at once');
  assert.equal(doc.getElementById('runs-pane').dataset.kind, 'hist');
  assert.ok(doc.querySelector(`#runs-list .runs-row[data-pipeline-id="aaaa0001"]`).classList.contains('selected'));
});

test('a live row listed before its pipeline id arrives picks the id up', async () => {
  const { window, doc, recv } = await boot();
  recv({ type: 'hello', runs: [live('r1')] });
  go(window, 'runs'); await settle(window);
  const row = () => doc.querySelector('#runs-list .runs-row[data-run-id="r1"][data-slot="group"]');
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
  click(window, doc.querySelector('#runs-list .runs-needs .runs-row[data-run-id="q1"]')); await settle(window);
  assert.equal(window.location.hash, '#running/q1');
  assert.equal(screen.dataset.mode, 'glance');
  assert.ok(scrolled > 0, 'scrolled to the question without waiting for a panel rebuild');
});

test('a History reload keeps each row’s last known PR until Phase 2 answers', async () => {
  let calls = 0;
  const history = () => (calls++ === 0 ? HIST : HIST.map(({ pr, ...rest }) => rest));   // reloads carry no pr, like the server
  const { window, doc, recv } = await boot({ history });
  go(window, 'runs'); await settle(window);
  const word = () => doc.querySelector(`#runs-list .runs-row[data-pipeline-id="aaaa0001"] .runs-row-sub`).textContent.split(' · ')[0];
  assert.equal(word(), 'Merged');
  recv({ type: 'pipelines-changed' });                  // app.js:1074 → loadHistoryView({ force: true })
  await settle(window, 8);
  assert.ok(calls >= 2, 'History was fetched again');
  assert.equal(word(), 'Merged', 'not "Finished" while the PR lookup runs');
});

test('list preferences — a folded group, View › Show, View › Group by — narrow the list and are remembered across reloads', async () => {
  // Each row boots its own page.
  await checkRows([
    { name: 'a folded project group stays folded across reloads', run: async () => {
      const two = { projects: [{ name: 'proj', path: PROJECT, exists: true }, { name: 'other', path: OTHER_DIR, exists: true }], history: [...HIST, OTHER_HIST] };
      const first = await boot(two);
      go(first.window, 'runs'); await settle(first.window);
      const head = first.doc.querySelector(`#runs-list .runs-group-head[data-group-key="recent/${KEY}"]`);
      click(first.window, head); await settle(first.window);
      const saved = first.window.localStorage.getItem('worca-cc.runs.collapsed');
      assert.deepEqual(JSON.parse(saved), [`recent/${KEY}`]);
      const second = await boot({ ...two, storage: { 'worca-cc.runs.collapsed': saved } });
      go(second.window, 'runs'); await settle(second.window);
      const head2 = second.doc.querySelector(`#runs-list .runs-group-head[data-group-key="recent/${KEY}"]`);
      assert.equal(head2.getAttribute('aria-expanded'), 'false');
      assert.equal(second.doc.querySelector(`#runs-list .runs-group[data-group-key="recent/${KEY}"] .runs-row`), null);
    } },
    { name: 'View › Show narrows the list and is remembered across reloads', run: async () => {
      const first = await boot();
      go(first.window, 'runs'); await settle(first.window);
      first.recv({ type: 'hello', runs: [live('r-live')] });
      await settle(first.window);
      const titles = (doc) => [...doc.querySelectorAll('#runs-list .runs-row-title')].map((n) => n.textContent);
      assert.deepEqual([...first.doc.querySelectorAll('#runs-view-menu [data-show]')].map((b) => b.dataset.show), ['active', 'finished', 'archived'], 'Show lists Active, Finished, Archived');
      assert.equal(checked(first.doc, '[data-show="active"]'), 'true');
      await pickView(first.window, first.doc, '[data-show="finished"]');
      assert.deepEqual(titles(first.doc), ['Merged thing', 'Stopped thing']);
      assert.equal(checked(first.doc, '[data-show="finished"]'), 'true');
      assert.equal(checked(first.doc, '[data-show="active"]'), 'false');
      const saved = first.window.localStorage.getItem('worca-cc.runs.filter');
      assert.equal(saved, 'finished');
      await pickView(first.window, first.doc, '[data-show="active"]');
      assert.deepEqual(titles(first.doc), ['r-live', 'Merged thing', 'Stopped thing'], 'Running, then Recent');
      const second = await boot({ storage: { 'worca-cc.runs.filter': saved } });
      go(second.window, 'runs'); await settle(second.window);
      assert.equal(checked(second.doc, '[data-show="finished"]'), 'true', 'the pick comes back');
      assert.deepEqual(titles(second.doc), ['Merged thing', 'Stopped thing'], 'and still filters');
      const legacy = await boot({ storage: { 'worca-cc.runs.filter': 'needs' } });
      go(legacy.window, 'runs'); await settle(legacy.window);
      assert.equal(checked(legacy.doc, '[data-show="active"]'), 'true', 'a stored Needs you filter boots on Active');
    } },
    { name: 'Show older opens Finished, and Finished is remembered', run: async () => {
      const old = { ...HIST[1], id: 'aaaa0003', title: 'Old thing', mtime: RECENT - 30 * 86400000 };
      const { window, doc } = await boot({ history: [HIST[0], old] });
      go(window, 'runs'); await settle(window);
      const titles = () => [...doc.querySelectorAll('#runs-list .runs-row-title')].map((n) => n.textContent);
      assert.deepEqual(titles(), ['Merged thing'], 'Active keeps the old run behind Show older');
      click(window, doc.querySelector('#runs-list .runs-show-older')); await settle(window);
      assert.equal(checked(doc, '[data-show="finished"]'), 'true');
      assert.equal(window.localStorage.getItem('worca-cc.runs.filter'), 'finished');
      assert.ok(titles().includes('Old thing'), 'Finished lists the older run');
    } },
    { name: 'View › Group by switches to date sections, closes on a pick or a click outside, and is remembered', run: async () => {
      const first = await boot();
      const { window, doc } = first;
      go(window, 'runs'); await settle(window);
      first.recv({ type: 'hello', runs: [live('r-live')] });
      await settle(window);
      const btn = doc.getElementById('runs-view-btn');
      const menu = doc.getElementById('runs-view-menu');
      assert.equal(menu.hidden, true);
      click(window, btn); await settle(window);
      assert.equal(menu.hidden, false);
      assert.equal(btn.getAttribute('aria-expanded'), 'true');
      assert.equal(doc.activeElement, menu.querySelector('[data-show="active"]'), 'focus lands on the first checked item');
      click(window, doc.body); await settle(window);
      assert.equal(menu.hidden, true, 'a click elsewhere closes it');
      await pickView(window, doc, '[data-group-by="date"]');
      assert.equal(menu.hidden, true, 'a pick closes it');
      assert.equal(menu.querySelector('[data-group-by="date"]').getAttribute('aria-checked'), 'true');
      const heads = () => [...doc.querySelectorAll('#runs-list .runs-group-name')].map((n) => n.textContent);
      assert.equal(heads()[0], 'Today', 'Recent buckets by date; the live run sits flat in Running');
      assert.ok(heads().every((h) => ['Upcoming', 'Today', 'Yesterday', 'Previous 7 days', 'Older'].includes(h)));
      assert.equal(window.localStorage.getItem('worca-cc.runs.groupBy'), 'date');
      const second = await boot({ storage: { 'worca-cc.runs.groupBy': 'date' } });
      go(second.window, 'runs'); await settle(second.window);
      assert.equal(second.doc.getElementById('runs-view-chip-label').textContent, 'Active · by date');
      assert.ok(second.doc.querySelector('#runs-list .runs-group[data-group-key^="recent/date:"]'), 'date buckets after a reload');
    } },
  ]);
});

// ── Archived Runs view (issue #575) ──────────────────────────────────────────

test('View › Show › Archived fetches the archived feed only when picked (and on the first paint when remembered) and lists its rows', async () => {
  // Each row boots its own page.
  await checkRows([
    { name: 'Show › Archived fetches the archived feed only when picked, and lists its rows', run: async () => {
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
      assert.ok(doc.querySelector('#runs-view-menu [data-show="archived"]').closest('.runs-head'), 'Archived sits in the Runs header View menu');
      await pickView(window, doc, '[data-show="archived"]');
      assert.equal(archivedFetches, 1, 'one archived fetch per activation');
      assert.equal(checked(doc, '[data-show="archived"]'), 'true');
      const titles = () => [...doc.querySelectorAll('#runs-list .runs-row-title')].map((n) => n.textContent);
      assert.deepEqual(titles(), ['Archived thing']);
      const row = doc.querySelector('#runs-list .runs-row[data-pipeline-id="cccc0009"]');
      assert.equal(row.querySelector('.runs-row-sub').textContent, 'Archived · Sep 1 · proj', 'the word says where the run lives; one project: its name ends the line');
      assert.equal(row.dataset.icon, 'done', 'the terminal icon stays');
      assert.equal(window.localStorage.getItem('worca-cc.runs.filter'), 'archived');
      await pickView(window, doc, '[data-show="active"]');
      assert.deepEqual(titles().sort(), ['Merged thing', 'Stopped thing'],
        'Active shows the active history only (the archived feed is a separate array)');
      assert.equal(archivedFetches, 1, 'switching back does not re-fetch');
      await pickView(window, doc, '[data-show="archived"]');
      assert.equal(archivedFetches, 2, 'each activation re-fetches (cheap, stays fresh)');
      await pickView(window, doc, '[data-show="archived"]');
      assert.equal(archivedFetches, 2, 'picking Archived while it is the pick does not re-fetch');
      await pickView(window, doc, '[data-show="finished"]');
      assert.equal(checked(doc, '[data-show="finished"]'), 'true');
      assert.equal(window.localStorage.getItem('worca-cc.runs.filter'), 'finished');
    } },
    { name: 'a remembered Archived filter fetches its feed on the first paint, chip hidden or not', run: async () => {
      const { window, doc } = await boot({ storage: { 'worca-cc.runs.filter': 'archived' } });
      let archivedFetches = 0;
      const inner = window.fetch;
      const wrapped = (u, init) => {
        if (String(u).includes('/api/history?archived=1')) archivedFetches += 1;
        return inner(u, init);
      };
      window.fetch = wrapped; globalThis.fetch = wrapped;
      go(window, 'runs'); await settle(window);
      assert.ok(archivedFetches >= 1, 'the feed loads without a menu pick');
      assert.equal(checked(doc, '[data-show="archived"]'), 'true');
      const titles = () => [...doc.querySelectorAll('#runs-list .runs-row-title')].map((n) => n.textContent);
      assert.deepEqual(titles(), ['Archived thing']);
    } },
  ]);
});

test('an archived run’s detail offers Restore, not Archive, and hides Resume and follow-up', async () => {
  const { window, doc } = await boot();
  go(window, 'runs'); await settle(window);
  await pickView(window, doc, '[data-show="archived"]');
  const posts = [];
  const inner = window.fetch;
  const wrapped = (u, init) => {
    if (String(u).includes('/restore')) posts.push({ url: String(u), method: (init && init.method) || 'GET' });
    return inner(u, init);
  };
  window.fetch = wrapped; globalThis.fetch = wrapped;
  click(window, doc.querySelector('#runs-list .runs-row[data-pipeline-id="cccc0009"]')); await settle(window);
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

test('docs/ui-levels.md rule 2: Show › Archived stays on screen below Advanced while it is the pick', async () => {
  const { window, doc } = await boot({ storage: { 'worca-cc.runs.filter': 'archived' } });
  go(window, 'runs'); await settle(window);
  const archItem = doc.querySelector('#runs-view-menu [data-show="archived"]');
  assert.equal(archItem.dataset.minLevel, 'advanced');
  assert.equal(archItem.dataset.levelKeep, '1',
    'kept visible: otherwise a Simple list shows only archived runs with no way out');
  await pickView(window, doc, '[data-show="active"]');
  assert.equal(archItem.dataset.levelKeep, undefined, 'once left, the item is Advanced-only again');
});

test('#740: a non-default view shows one chip; × resets to Active · by project and is remembered', async () => {
  const { window, doc } = await boot();
  go(window, 'runs'); await settle(window);
  const row = doc.getElementById('runs-view-chip-row');
  assert.equal(row.hidden, true, 'no chip for the default view');
  await pickView(window, doc, '[data-show="finished"]');
  await pickView(window, doc, '[data-group-by="date"]');
  assert.equal(row.hidden, false);
  assert.equal(doc.getElementById('runs-view-chip-label').textContent, 'Finished · by date');
  click(window, doc.getElementById('runs-view-chip-x')); await settle(window);
  assert.equal(row.hidden, true, '× hides the chip');
  assert.equal(checked(doc, '[data-show="active"]'), 'true');
  assert.equal(checked(doc, '[data-group-by="project"]'), 'true');
  assert.equal(window.localStorage.getItem('worca-cc.runs.filter'), 'active');
  assert.equal(window.localStorage.getItem('worca-cc.runs.groupBy'), 'project');
  assert.equal(doc.activeElement, doc.getElementById('runs-view-btn'), 'focus moves to View');
});

test('#740: the always-visible search filters the list and Escape clears it', async () => {
  const { window, doc } = await boot();
  go(window, 'runs'); await settle(window);
  const input = doc.getElementById('runs-search');
  assert.equal(input.placeholder, 'Search runs or tags (client:acme)');
  input.value = 'merged';
  input.dispatchEvent(new window.Event('input', { bubbles: true })); await settle(window);
  assert.deepEqual([...doc.querySelectorAll('#runs-list .runs-row-title')].map((n) => n.textContent), ['Merged thing']);
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await settle(window);
  assert.equal(input.value, '');
  assert.equal(doc.querySelectorAll('#runs-list .runs-row-title').length, 2);
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
  await pickView(window, doc, '[data-show="archived"]');
  assert.equal(archivedFetches, 1);
  // Restored elsewhere (another tab, the CLI): the broadcast drops it from the open view.
  archived = [];
  recv({ type: 'pipelines-changed' }); await settle(window);
  assert.equal(archivedFetches, 2, 'the change refetches the loaded feed');
  assert.equal(doc.querySelector('#runs-list .runs-row[data-pipeline-id="cccc0009"]'), null, 'the restored row is gone');
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
  await pickView(window, doc, '[data-show="archived"]');
  click(window, doc.querySelector('#runs-list .runs-row[data-pipeline-id="cccc0009"]')); await settle(window);
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

test('a "Run after" chain is one row with a thin line; its toggle opens the members and keeps focus', async () => {
  const chains = [{ id: 'p:pchain01', title: 'Chain root', members: [
    { pipelineId: 'pchain01', ticketId: null, state: 'current', title: 'Chain root', projectDir: PROJECT },
    { pipelineId: null, ticketId: 'tick0002', state: 'waiting', title: 'Chain next', projectDir: PROJECT },
  ] }];
  const { window, doc, recv } = await boot({ chains, history: [] });
  recv({ type: 'hello', runs: [live('r1', { pipelineId: 'pchain01' })] });
  go(window, 'runs'); await settle(window);
  const host = doc.getElementById('runs-list');
  assert.equal(host.querySelectorAll('.runs-chain').length, 1, 'the live member is replaced by ONE chain row');
  assert.equal(host.querySelectorAll('.runs-row[data-run-id="r1"]').length, 1);
  assert.ok(host.querySelector('.runs-chain .runs-row-prog'), 'the overall thin line');
  assert.match(host.querySelector('.runs-chain .runs-row-sub').textContent, /^Run 1 of 2/);
  const tog = () => host.querySelector('.runs-chain-toggle');
  assert.equal(tog().getAttribute('aria-expanded'), 'false');
  tog().focus();
  click(window, tog());
  await settle(window);
  assert.equal(tog().getAttribute('aria-expanded'), 'true');
  assert.equal(host.querySelectorAll('.runs-chain-member').length, 2);
  assert.equal(doc.activeElement, tog(), 'focus returns to the rebuilt toggle');
});

test('D17: a feature chain is one open row titled by the feature, members "1 · Store tags", the row and a waiting slice open the feature page', async () => {
  const chains = [{ id: 'p:pslice01', title: 'Tags · 1/3: Store tags', members: [
    { pipelineId: 'pslice01', ticketId: null, state: 'current', title: 'Tags · 1/3: Store tags', projectDir: PROJECT },
    { pipelineId: null, ticketId: 'tslice02', state: 'waiting', title: 'Tags · 2/3: Run tags', projectDir: PROJECT },
    { pipelineId: null, ticketId: 'tslice03', state: 'waiting', title: 'Tags · 3/3: Cost report', projectDir: PROJECT },
  ], feature: { id: 'feat_1', title: 'Tags', slices: [
    { index: 1, title: 'Store tags', ticketId: null, pipelineId: 'pslice01' },
    { index: 2, title: 'Run tags', ticketId: 'tslice02', pipelineId: null },
    { index: 3, title: 'Cost report', ticketId: 'tslice03', pipelineId: null } ] } }];
  const { window, doc, recv } = await boot({ chains, history: [] });
  recv({ type: 'hello', flags: { shapeFirst: true }, runs: [live('r1', { pipelineId: 'pslice01' })] });
  go(window, 'runs'); await settle(window);
  const host = doc.getElementById('runs-list');
  assert.equal(host.querySelectorAll('.runs-chain').length, 1);
  assert.equal(host.querySelector('.runs-chain .runs-row').getAttribute('href'), '#feature/feat_1');
  assert.match(host.querySelector('.runs-chain .runs-row-sub').textContent, /^Slice 1 of 3/);
  const tog = () => host.querySelector('.runs-chain-toggle');
  assert.equal(tog().getAttribute('aria-expanded'), 'true', 'open by default');
  const links = [...host.querySelectorAll('.runs-chain-link')];
  assert.deepEqual(links.map((a) => a.textContent), ['Open feature →', '1 · Store tags', '2 · Run tags', '3 · Cost report']);
  assert.deepEqual(links.map((a) => a.getAttribute('href')), ['#feature/feat_1', '#running/r1', '#feature/feat_1', '#feature/feat_1']);
  // A plain click on the row itself opens and closes the group (no chevron to find) and stays on the page.
  const hashBefore = window.location.hash;
  click(window, host.querySelector('.runs-chain .runs-row-title'));
  await settle(window);
  assert.equal(tog().getAttribute('aria-expanded'), 'false', 'a row click closes it');
  assert.equal(window.location.hash, hashBefore, 'a row click does not navigate');
  click(window, host.querySelector('.runs-chain .runs-row-title'));
  await settle(window);
  assert.equal(tog().getAttribute('aria-expanded'), 'true', 'and opens it again');
  click(window, tog());
  await settle(window);
  assert.equal(tog().getAttribute('aria-expanded'), 'false', 'a person\'s toggle wins');
  recv({ type: 'state', runId: 'r1', status: 'running' });
  await settle(window);
  assert.equal(tog().getAttribute('aria-expanded'), 'false', 'and holds across repaints');
  // A slice waiting for a person: amber "Needs you" on the feature row.
  recv({ type: 'question', runId: 'r1', question: { id: 'q1', kind: 'clarify', questions: [] } });
  await settle(window);
  assert.match(host.querySelector('.runs-chain .runs-row-sub').textContent, /^Slice 1 of 3 · Needs you/);
  click(window, tog());
  await settle(window);
  const member1 = host.querySelectorAll('.runs-chain-member:not(.runs-chain-open-feature)')[0];
  assert.ok(member1.classList.contains('is-needs'), 'the asking slice is amber');
  assert.ok(!member1.classList.contains('is-live'), 'and does not pulse');
});

test('a state frame and a schedules-changed frame keep the chain toggle focused, and a repaint without a text change keeps the thin line element', async () => {
  const chains = [{ id: 'p:pchain01', title: 'Chain root', members: [
    { pipelineId: 'pchain01', ticketId: null, state: 'current', title: 'Chain root', projectDir: PROJECT },
    { pipelineId: null, ticketId: 'tick0002', state: 'waiting', title: 'Chain next', projectDir: PROJECT },
  ] }];
  const { window, doc, recv } = await boot({ chains, history: [] });
  recv({ type: 'hello', runs: [live('r1', { pipelineId: 'pchain01' })] });
  go(window, 'runs'); await settle(window);
  const host = doc.getElementById('runs-list');
  const tog = () => host.querySelector('.runs-chain-toggle');
  const fill = () => host.querySelector('.runs-chain .runs-row-prog > i');
  const before = fill();
  tog().focus();
  recv({ type: 'state', runId: 'r1', id: 'pchain01', status: 'running', steps: [], subAgents: [], totalCostUsd: 1 });
  await settle(window);
  assert.equal(doc.activeElement, tog(), 'focus survives a state frame');
  assert.strictEqual(fill(), before, 'the thin line element is reused when the row text did not change');
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

test('a plain live run with a staged manifest paints the thin line and the P5 stage text in the list', async () => {
  const { window, doc, recv } = await boot({ history: [] });
  recv({ type: 'hello', runs: [live('r1', { pipelineId: 'p1' })] });
  recv({ type: 'state', runId: 'r1', id: 'p1', status: 'running', stepper: STAGED(), steps: STAGED_STEPS(),
    active: [{ nodeId: 'n_impl', executionId: 'x:n_impl:1' }], subAgents: [], totalCostUsd: 0 });
  go(window, 'runs'); await settle(window);
  const row = doc.querySelector('#runs-list .runs-row[data-run-id="r1"]');
  assert.ok(row.querySelector('.runs-row-prog > i'), 'the thin line');
  assert.match(row.querySelector('.runs-row-sub').textContent, /Build · Implementer/);
});

test('a ticket-born live chain member (server pipelineId null) shows its tone in the chain row, and a question turns it amber', async () => {
  const chains = [{ id: 't:tick0001', title: 'Born from a ticket', members: [
    { pipelineId: null, ticketId: 'tick0001', state: 'current', title: 'Born from a ticket', projectDir: PROJECT },
    { pipelineId: null, ticketId: 'tick0002', state: 'waiting', title: 'Next', projectDir: PROJECT },
  ] }];
  const { window, doc, recv } = await boot({ chains, history: [] });
  recv({ type: 'hello', runs: [live('tick0001', { pipelineId: 'pfirst01' })] });
  recv({ type: 'state', runId: 'tick0001', id: 'pfirst01', status: 'running', stepper: STAGED(), steps: STAGED_STEPS(),
    active: [{ nodeId: 'n_impl', executionId: 'x:n_impl:1' }], subAgents: [], totalCostUsd: 0 });
  go(window, 'runs'); await settle(window);
  const host = doc.getElementById('runs-list');
  const bar = () => host.querySelector('.runs-chain .runs-row-prog');
  assert.ok(bar(), 'the chain row carries the overall line');
  assert.notEqual(bar().dataset.tone, 'amber');
  recv({ type: 'question', runId: 'tick0001', kind: 'questions', questions: [{ id: 'q1', question: 'Which one?' }] });
  await settle(window);
  assert.equal(bar().dataset.tone, 'amber');
});

test('chain freshness: no chains at first, then a schedules-changed frame folds the member into a chain row', async () => {
  const chains = [];
  const { window, doc, recv } = await boot({ chains, history: [] });
  recv({ type: 'hello', runs: [live('r1', { pipelineId: 'pchain01' })] });
  go(window, 'runs'); await settle(window);
  const host = doc.getElementById('runs-list');
  assert.equal(host.querySelectorAll('.runs-chain').length, 0);
  chains.push({ id: 'p:pchain01', title: 'Chain root', members: [
    { pipelineId: 'pchain01', ticketId: null, state: 'current', title: 'Chain root', projectDir: PROJECT },
    { pipelineId: null, ticketId: 'tick0002', state: 'waiting', title: 'Chain next', projectDir: PROJECT },
  ] });
  recv({ type: 'schedules-changed' });
  await settle(window);
  assert.equal(host.querySelectorAll('.runs-chain').length, 1);
});
