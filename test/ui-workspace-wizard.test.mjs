// test/ui-workspace-wizard.test.mjs — jsdom boot tests for the one-step creation wizard:
// gating, the scan POST, the hand-off to the run's row on Runs, error handling
// (409 stays), leave-reset, JSON safety (.textContent only), and the retired steps.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';
import { pressEscape } from './helpers/popups.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const PROJECTS = [
  { name: 'svc-iam', path: '/a/svc-iam', exists: true },
  { name: 'svc-ui', path: '/a/svc-ui', exists: true },
  { name: 'svc-pay', path: '/a/svc-pay', exists: true },
  { name: 'gone', path: '/a/gone', exists: false },
];

class WSStub {
  constructor() { this.readyState = 1; this.sent = []; this._listeners = {}; WSStub.last = this; }
  send(s) { this.sent.push(typeof s === 'string' ? JSON.parse(s) : s); }
  close() {}
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  _open() { (this._listeners.open || []).forEach((fn) => fn({})); }
  deliver(obj) { (this._listeners.message || []).forEach((fn) => fn({ data: JSON.stringify(obj) })); }
}

async function boot({ fetchHandler } = {}) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = WSStub;
  window.confirm = () => true;
  const calls = [];
  window.fetch = (url, opts) => {
    const u = String(url);
    calls.push({ u, opts: opts || {} });
    if (fetchHandler) { const r = fetchHandler(u, opts || {}); if (r) return r; }
    if (u.includes('/api/projects')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: PROJECTS }) });
    if (u.includes('/api/workspaces/metrics-scan')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ members: [] }) });
    if (u.includes('/api/workspaces')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ workspaces: [] }) });
    if (u.includes('/api/branches')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ branches: [], current: '' }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  if (WSStub.last) WSStub.last._open();
  return { window, ws: () => WSStub.last, calls };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true }));
const goCreate = (window) => { window.location.hash = 'workspace-create'; window.dispatchEvent(new window.Event('hashchange')); };
const viewShown = (doc, v) => !doc.querySelector(`.view[data-view="${v}"]`).classList.contains('hidden');
function pick(window, paths) {
  for (const v of paths) {
    const cb = [...window.document.querySelectorAll('#wiz-projects .wiz-proj-cb')].find((c) => c.value === v);
    cb.checked = true; cb.dispatchEvent(new window.Event('change', { bubbles: true }));
  }
}
const scanOk = (posts) => (u, opts) => {
  if (u.endsWith('/api/workspaces/scan') && opts.method === 'POST') {
    posts.push(JSON.parse(opts.body));
    return Promise.resolve({ ok: true, status: 200, json: async () => ({
      runId: 'run-scan-1', workspaceId: 'wks-my-ws-0000abcd', title: 'Workspace scan: My WS',
      projectDir: '/a/svc-iam', projectNames: ['svc-iam', 'svc-ui'],
    }) });
  }
  return null;
};

test('project gating: Scan needs 2+ existing projects ticked; Select all ticks every usable project (never a missing one), tracks partial state, and is disabled below two usable', async () => {
  await checkRows([
    { name: 'gating: Scan is disabled until 2+ existing projects are ticked', run: async () => {
      const { window } = await boot();
      goCreate(window);
      await tick();
      const doc = window.document;
      const start = doc.querySelector('#wiz-start-scan');
      assert.equal([...doc.querySelectorAll('#wiz-projects .wiz-proj-cb')].find((c) => c.value === '/a/gone').disabled, true);
      assert.equal(start.disabled, true);
      pick(window, ['/a/svc-iam']);
      assert.equal(start.disabled, true);
      pick(window, ['/a/svc-ui']);
      assert.equal(start.disabled, false);
    } },
    { name: 'Select all toggles every usable project (never a missing one) and tracks partial state', run: async () => {
      const { window } = await boot();
      goCreate(window);
      await new Promise((r) => setTimeout(r, 0));
      const doc = window.document;
      const all = doc.querySelector('#wiz-select-all');
      assert.ok(all, 'select-all checkbox rendered');
      assert.ok(!doc.querySelector('#wiz-projects').contains(all), 'kept outside the project list');
      const cbs = () => [...doc.querySelectorAll('#wiz-projects .wiz-proj-cb')];
      const byVal = (v) => cbs().find((c) => c.value === v);
      const start = doc.querySelector('#wiz-start-scan');
      assert.equal(all.disabled, false, 'enabled with usable projects');
      assert.equal(all.checked, false, 'unchecked with nothing selected');
      assert.equal(all.indeterminate, false);

      all.checked = true; all.dispatchEvent(new window.Event('change', { bubbles: true }));
      for (const v of ['/a/svc-iam', '/a/svc-ui', '/a/svc-pay']) assert.equal(byVal(v).checked, true, `${v} selected`);
      assert.equal(byVal('/a/gone').checked, false, 'missing project never selected');
      assert.equal(start.disabled, false, 'start enabled after select all');

      const cb = byVal('/a/svc-ui');
      cb.checked = false; cb.dispatchEvent(new window.Event('change', { bubbles: true }));
      assert.equal(all.checked, false, 'partial selection unchecks select-all');
      assert.equal(all.indeterminate, true, 'partial selection is indeterminate');

      cb.checked = true; cb.dispatchEvent(new window.Event('change', { bubbles: true }));
      assert.equal(all.checked, true, 'selecting the last one checks select-all');
      assert.equal(all.indeterminate, false);

      all.checked = false; all.dispatchEvent(new window.Event('change', { bubbles: true }));
      assert.ok(cbs().every((c) => !c.checked), 'deselect all clears every row');
      assert.equal(start.disabled, true, 'start disabled after deselect all');
      assert.equal(all.indeterminate, false);

      all.click();
      assert.equal(all.checked, true, 'a real click selects all');
      assert.equal(cbs().filter((c) => c.checked).length, 3);
    } },
    { name: 'Select all is disabled when fewer than two projects are usable', run: async () => {
      const { window } = await boot({
        fetchHandler: (u) => u.includes('/api/projects')
          ? Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [PROJECTS[0], PROJECTS[3]] }) }) : null,
      });
      goCreate(window);
      await new Promise((r) => setTimeout(r, 0));
      assert.equal(window.document.querySelector('#wiz-select-all').disabled, true);
    } },
  ]);
});

test('Scan POSTs {projectPaths,name} and hands off to the run on Runs', async () => {
  const posts = [];
  const { window } = await boot({ fetchHandler: scanOk(posts) });
  goCreate(window);
  await tick();
  const doc = window.document;
  doc.querySelector('#wiz-name').value = 'My WS';
  pick(window, ['/a/svc-iam', '/a/svc-ui']);
  click(window, doc.querySelector('#wiz-start-scan'));
  await tick(); await tick();
  assert.deepEqual(posts.map(({ projectPaths, name }) => ({ projectPaths, name })), [{ projectPaths: ['/a/svc-iam', '/a/svc-ui'], name: 'My WS' }]);
  assert.ok(posts[0].models && posts[0].models.agentModel, 'the Models column rides along');
  assert.ok(viewShown(doc, 'runs'), 'on Runs');
  assert.ok(!viewShown(doc, 'workspace-create'), 'the wizard is left');
  assert.ok(doc.querySelector('#runs-list [data-run-id="run-scan-1"]'), 'the scan run has a row');
});

test('no name: no POST, the name field gets focus', async () => {
  const posts = [];
  const { window } = await boot({ fetchHandler: scanOk(posts) });
  goCreate(window);
  await tick();
  const doc = window.document;
  pick(window, ['/a/svc-iam', '/a/svc-ui']);
  click(window, doc.querySelector('#wiz-start-scan'));
  await tick();
  assert.equal(posts.length, 0);
  assert.equal(doc.activeElement, doc.querySelector('#wiz-name'));
});

test('a refused scan (409) stays in the wizard with the error as TEXT and Scan re-enabled; a claude-signed-out refusal shows one red line linking Connect Claude Code', async () => {
  await checkRows([
    { name: 'a refused scan (409) stays in the wizard with the error as TEXT and Scan re-enabled', run: async () => {
      const evil = 'a workspace named "<img src=x onerror=alert(1)>" already exists';
      const { window } = await boot({
        fetchHandler: (u, opts) => (u.endsWith('/api/workspaces/scan') && opts.method === 'POST'
          ? Promise.resolve({ ok: false, status: 409, json: async () => ({ error: evil }) }) : null),
      });
      goCreate(window);
      await tick();
      const doc = window.document;
      doc.querySelector('#wiz-name').value = 'X';
      pick(window, ['/a/svc-iam', '/a/svc-ui']);
      click(window, doc.querySelector('#wiz-start-scan'));
      await tick(); await tick();
      assert.ok(viewShown(doc, 'workspace-create'));
      assert.equal(doc.querySelector('#wiz-step1-hint').textContent, `Scan error: ${evil}`);
      assert.equal(doc.querySelector('#wiz-step1-hint img'), null, 'never parsed as HTML');
      assert.equal(doc.querySelector('#wiz-start-scan').disabled, false);
    } },
    { name: 'a signed-out Claude refusal (409 claude-signed-out) shows one red line whose link opens Connect Claude Code', run: async () => {
      const { window } = await boot({
        fetchHandler: (u, opts) => (u.endsWith('/api/workspaces/scan') && opts.method === 'POST'
          ? Promise.resolve({ ok: false, status: 409, json: async () => ({ code: 'claude-signed-out', error: "Claude Code isn't signed in. Run `claude` in a terminal and type /login, then try again." }) }) : null),
      });
      goCreate(window);
      await tick();
      const doc = window.document;
      doc.querySelector('#wiz-name').value = 'A';
      pick(window, ['/a/svc-iam', '/a/svc-ui']);
      click(window, doc.querySelector('#wiz-start-scan'));
      await tick(); await tick();
      assert.ok(viewShown(doc, 'workspace-create'), 'stays in the wizard');
      const hint = doc.querySelector('#wiz-step1-hint');
      assert.equal(hint.textContent, "Claude Code isn't signed in. Sign in…");
      assert.ok(hint.classList.contains('err'), 'red');
      assert.doesNotMatch(hint.textContent, /Scan error/);
      assert.equal(doc.querySelector('#wiz-start-scan').disabled, false, 'Scan re-enabled');
      const setup = doc.getElementById('claude-setup-modal');
      assert.equal(setup.classList.contains('hidden'), true);
      click(window, hint.querySelector('a'));
      assert.equal(setup.classList.contains('hidden'), false, 'Sign in… opens the dialog');
    } },
    { name: 'a refusal that lands after the wizard was left and re-entered writes nothing into the new wizard', run: async () => {
      let refuse;
      const answer = new Promise((r) => { refuse = () => r({ ok: false, status: 409, json: async () => ({ error: 'late refusal' }) }); });
      const { window, calls } = await boot({
        fetchHandler: (u, opts) => (u.endsWith('/api/workspaces/scan') && opts.method === 'POST' ? answer : null),
      });
      goCreate(window);
      await tick();
      const doc = window.document;
      doc.querySelector('#wiz-name').value = 'X';
      pick(window, ['/a/svc-iam', '/a/svc-ui']);
      click(window, doc.querySelector('#wiz-start-scan'));
      for (let i = 0; i < 6; i += 1) await tick();
      assert.ok(calls.some((c) => c.u.endsWith('/api/workspaces/scan')), 'the scan request is out');
      window.location.hash = 'new';
      window.dispatchEvent(new window.Event('hashchange'));
      await tick();
      goCreate(window);
      await tick();
      const hint = doc.querySelector('#wiz-step1-hint');
      const fresh = hint.textContent;
      refuse();
      for (let i = 0; i < 6; i += 1) await tick();
      assert.equal(hint.textContent, fresh);
      assert.equal(hint.classList.contains('err'), false);
    } },
  ]);
});

// D13: a scan that saves a workspace in the background rebuilds the New Pipeline picker on ANY
// view, and a still-selected workspace keeps its member branch picks.
const ALPHA = { id: 'wks-alpha-00000001', name: 'Alpha WS', description: '', projectPaths: ['/a/svc-iam', '/a/svc-ui'],
  projectKeys: ['svc-iam-aaaa1111', 'svc-ui-bbbb2222'], exists: [true, true] };
const BETA = { id: 'wks-beta-00000002', name: 'Beta WS', description: '', projectPaths: ['/a/svc-pay', '/a/svc-ui'],
  projectKeys: ['svc-pay-cccc3333', 'svc-ui-bbbb2222'], exists: [true, true] };
const withWorkspaces = (list) => (u) => {
  if (/\/api\/workspaces$/.test(u)) return Promise.resolve({ ok: true, status: 200, json: async () => ({ workspaces: list.slice() }) });
  if (u.includes('/api/branches')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ branches: ['main', 'feature'], current: 'main' }) });
  return null;
};

test('workspaces-changed and a background scan save rebuild the New Pipeline workspace picker on any view, keeping the selected workspace\'s branch picks', async () => {
  await checkRows([
    { name: 'workspaces-changed refreshes the workspace list cache (the New Pipeline picker)', run: async () => {
      const { window, ws, calls } = await boot();
      await tick();
      const before = calls.filter((c) => c.u.endsWith('/api/workspaces')).length;
      ws().deliver({ type: 'workspaces-changed', action: 'scan-created' });
      await tick(); await tick();
      assert.ok(calls.filter((c) => c.u.endsWith('/api/workspaces')).length > before, 'GET /api/workspaces refetched');
    } },
    { name: 'a background scan save rebuilds the New Pipeline picker on any view; the selected workspace keeps its branch picks', run: async () => {
      const list = [ALPHA];
      const { window, ws } = await boot({ fetchHandler: withWorkspaces(list) });
      const doc = window.document;
      window.location.hash = 'new'; window.dispatchEvent(new window.Event('hashchange'));
      await tick();
      click(window, doc.querySelector('#target-seg button[data-target="workspace"]'));
      await tick(); await tick();
      const sel = doc.querySelector('#workspaceSelect');
      sel.value = ALPHA.id; sel.dispatchEvent(new window.Event('change', { bubbles: true }));
      for (let i = 0; i < 4; i++) await tick();
      const branchSel = doc.querySelector('#ws-source-branches select.ws-src-select');
      assert.ok(branchSel, 'member branch pickers rendered');
      branchSel.value = 'feature';
      // The scan hand-off parks the user on Running; the scan then saves Beta.
      window.location.hash = 'running'; window.dispatchEvent(new window.Event('hashchange'));
      await tick();
      list.push(BETA);
      ws().deliver({ type: 'workspaces-changed', action: 'scan-created' });
      for (let i = 0; i < 4; i++) await tick();
      assert.deepEqual([...sel.options].map((o) => o.value).filter(Boolean), [ALPHA.id, BETA.id], 'the picker offers the new workspace');
      assert.equal(sel.value, ALPHA.id, 'the selection stays');
      assert.equal(doc.querySelector('#ws-source-branches select.ws-src-select'), branchSel, 'member rows not rebuilt');
      assert.equal(branchSel.value, 'feature', 'the branch pick survives');
    } },
  ]);
});

const WS_SETTINGS = {
  workspaceScan: { scanModel: 'claude-opus-5-5', scanEffort: 'high', agentModel: 'fable', agentEffort: 'max' },
  workspaceScanDefault: { scanModel: 'claude-sonnet-5', scanEffort: 'medium', agentModel: 'sonnet', agentEffort: 'medium' },
};
const CATALOG = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['medium', 'high', 'xhigh', 'max'] },
  { id: 'claude-sonnet-5', label: 'Sonnet 5', efforts: ['medium', 'high', 'xhigh', 'max'] },
];
const withModels = (posts, settings = WS_SETTINGS) => (u, opts) => {
  if (u.includes('/api/settings')) return Promise.resolve({ ok: true, status: 200, json: async () => settings });
  if (u.includes('/api/config')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: CATALOG, efforts: ['medium', 'high', 'xhigh', 'max'] }) });
  return scanOk(posts)(u, opts);
};

test('no stored pick: Sonnet 5 · medium and Sonnet · medium; Scan sends the column\'s pick', async () => {
  const posts = [];
  const { window } = await boot({ fetchHandler: withModels(posts, { workspaceScan: null, workspaceScanDefault: WS_SETTINGS.workspaceScanDefault }) });
  goCreate(window);
  await tick(); await tick(); await tick();
  const doc = window.document;
  assert.deepEqual(['wiz-scan-model', 'wiz-scan-effort', 'wiz-agent-model', 'wiz-agent-effort'].map((id) => doc.querySelector(`#${id}`).value),
    ['claude-sonnet-5', 'medium', 'sonnet', 'medium']);
  doc.querySelector('#wiz-agent-model').value = 'opus';
  doc.querySelector('#wiz-name').value = 'My WS';
  pick(window, ['/a/svc-iam', '/a/svc-ui']);
  click(window, doc.querySelector('#wiz-start-scan'));
  await tick(); await tick();
  assert.deepEqual(posts.at(-1).models, { scanModel: 'claude-sonnet-5', scanEffort: 'medium', agentModel: 'opus', agentEffort: 'medium' });
});

test('a stored scan model that left the catalog starts the column on the default scan model (never a pick the server refuses)', async () => {
  const posts = [];
  const stale = { ...WS_SETTINGS, workspaceScan: { ...WS_SETTINGS.workspaceScan, scanModel: 'gone-model' } };
  const { window } = await boot({ fetchHandler: withModels(posts, stale) });
  goCreate(window);
  await tick(); await tick(); await tick();
  const doc = window.document;
  assert.equal(doc.querySelector('#wiz-scan-model').value, 'claude-sonnet-5');
  assert.equal(doc.querySelector('#wiz-scan-effort').value, 'medium');
  assert.equal(doc.querySelector('#wiz-agent-model').value, 'fable', 'the project-agent half of the stored pick stays');
  doc.querySelector('#wiz-name').value = 'Stale';
  pick(window, ['/a/svc-iam', '/a/svc-ui']);
  click(window, doc.querySelector('#wiz-start-scan'));
  await tick(); await tick();
  assert.equal(posts.at(-1).models.scanModel, 'claude-sonnet-5');
});

test('Scan waits for the Models column: a click before it has painted still sends the full pick', async () => {
  const posts = [];
  let release;
  const gate = new Promise((res) => { release = res; });
  const models = withModels(posts);
  const { window } = await boot({
    fetchHandler: (u, opts) => (u.includes('/api/settings')
      ? gate.then(() => ({ ok: true, status: 200, json: async () => WS_SETTINGS }))
      : models(u, opts)),
  });
  goCreate(window);
  await tick();
  const doc = window.document;
  doc.querySelector('#wiz-name').value = 'Early';
  pick(window, ['/a/svc-iam', '/a/svc-ui']);
  click(window, doc.querySelector('#wiz-start-scan'));
  await tick(); await tick();
  assert.equal(posts.length, 0, 'nothing is sent while the Models column is still empty');
  release();
  for (let i = 0; i < 6; i++) await tick();
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].models, WS_SETTINGS.workspaceScan, 'the pick Settings holds, not four empty strings');
});

// Workspace size (D24): the note under the project list and the 2–40 gate on Scan.
const MANY = Array.from({ length: 45 }, (_, i) => {
  const name = `svc-${String(i + 1).padStart(2, '0')}`;
  return { name, path: `/m/${name}`, exists: true };
});
const withMany = (posts = []) => (u, opts) => (u.includes('/api/projects')
  ? Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: MANY }) })
  : scanOk(posts)(u, opts));
/** Tick exactly the first n rows, firing `change` only where a box flips. */
function tickFirst(window, n) {
  [...window.document.querySelectorAll('#wiz-projects .wiz-proj-cb')].forEach((cb, i) => {
    if (cb.checked === (i < n)) return;
    cb.checked = i < n;
    cb.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
}
const sizeLevel = (doc) => {
  const note = doc.querySelector('#wiz-size-note');
  return note.hidden ? 'none' : note.dataset.level;
};

test('size limits: no note up to 10, warnings above 10 and 20, Scan blocked above 40 — including after Select all; a forced startWizardScan posts nothing', async () => {
  await checkRows([
    { name: 'size note: none up to 10, "a bit big" above 10, a stronger warning above 20, Scan blocked above 40', run: async () => {
      const { window } = await boot({ fetchHandler: withMany() });
      goCreate(window);
      await tick();
      const doc = window.document;
      const note = doc.querySelector('#wiz-size-note');
      const start = doc.querySelector('#wiz-start-scan');
      tickFirst(window, 10);
      assert.equal(sizeLevel(doc), 'none');
      tickFirst(window, 11);
      assert.equal(sizeLevel(doc), 'big');
      assert.match(note.textContent, /A bit big \(11 projects\)/);
      tickFirst(window, 20);
      assert.equal(sizeLevel(doc), 'big');
      tickFirst(window, 21);
      assert.equal(sizeLevel(doc), 'very-big');
      assert.match(note.textContent, /Big workspace \(21 projects\)/);
      tickFirst(window, 40);
      assert.equal(sizeLevel(doc), 'very-big');
      assert.equal(start.disabled, false, '40 may be scanned');
      tickFirst(window, 41);
      assert.equal(sizeLevel(doc), 'over');
      assert.match(note.textContent, /41 selected/);
      assert.match(note.textContent, /up to 40 projects/);
      assert.equal(start.disabled, true, '41 may not');
      tickFirst(window, 2);
      assert.equal(sizeLevel(doc), 'none');
      assert.equal(note.textContent, '');
      assert.equal(start.disabled, false);
    } },
    { name: 'Select all past 40 ticks everything, blocks Scan and says so; a forced startWizardScan posts nothing', run: async () => {
      const posts = [];
      const { window } = await boot({ fetchHandler: withMany(posts) });
      goCreate(window);
      await tick();
      const doc = window.document;
      doc.querySelector('#wiz-name').value = 'Everything';
      doc.querySelector('#wiz-select-all').click();
      assert.equal(doc.querySelectorAll('#wiz-projects .wiz-proj-cb:checked').length, 45);
      assert.equal(doc.querySelector('#wiz-start-scan').disabled, true);
      assert.equal(sizeLevel(doc), 'over');
      await window.__ws.startWizardScan();
      assert.equal(posts.length, 0, 'startWizardScan refuses 41+ on its own');
      tickFirst(window, 40);
      assert.equal(doc.querySelector('#wiz-start-scan').disabled, false, 'back in range');
    } },
  ]);
});

// P5: registered Folder projects can be workspace members (U8), so the wizard offers them next to Git ones.
const KINDS = [{ name: 'api', path: '/p/api', exists: true, key: 'k1', vcs: 'git' }, { name: 'notes', path: '/p/notes', exists: true, key: 'k2', vcs: 'none' }];
const withKinds = (u) => (u.includes('/api/projects') ? Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: KINDS }) }) : null);

test('the create wizard lists Folder projects next to Git ones, each with its kind chip, and both can be picked', async () => {
  const { window } = await boot({ fetchHandler: withKinds });
  goCreate(window);
  await tick();
  const doc = window.document;
  const rows = [...doc.querySelectorAll('#wiz-projects .wiz-proj')];
  assert.deepEqual(rows.map((r) => [r.querySelector('.opt-name').textContent, r.querySelector('.kind-chip').textContent]), [['api', 'Git'], ['notes', 'Folder']]);
  assert.ok(rows.every((r) => !r.querySelector('.wiz-proj-cb').disabled));
  pick(window, ['/p/api', '/p/notes']);
  assert.equal(doc.querySelector('#wiz-start-scan').disabled, false, 'a Git and a Folder project make a workspace');
});

// The wizard's Escape arm runs in the capture phase and stands down while a pop-up is up
// (modal-guard dialogOpen), so that pop-up alone takes the Escape.
test('Escape over a pop-up on the wizard closes only that pop-up and the wizard stays; with nothing on top, Escape leaves it', async () => {
  await checkRows([
    { name: 'the folder browser', run: async () => {
      const { window } = await boot({ fetchHandler: (u) => (u.includes('/api/fs/dirs')
        ? Promise.resolve({ ok: true, status: 200, json: async () => ({ path: '/home/me', parent: '/home', home: '/home/me', dirs: [] }) }) : null) });
      goCreate(window);
      await tick();
      const doc = window.document;
      void window.__projects.openFolderBrowser('', () => {});
      await tick(); await tick();
      const browser = doc.getElementById('folder-browser');
      assert.equal(browser.classList.contains('hidden'), false);
      pressEscape(window);
      assert.equal(browser.classList.contains('hidden'), true, 'the pop-up on top took the Escape');
      assert.equal(window.location.hash, '#workspace-create', 'the wizard stays');
      pressEscape(window);
      assert.equal(window.location.hash, '#new', 'nothing on top: Escape leaves the wizard');
    } },
    { name: 'Connect Claude Code, opened by "Sign in…" after a signed-out refusal', run: async () => {
      const { window } = await boot({
        fetchHandler: (u, opts) => (u.endsWith('/api/workspaces/scan') && opts.method === 'POST'
          ? Promise.resolve({ ok: false, status: 409, json: async () => ({ code: 'claude-signed-out', error: 'signed out' }) }) : null),
      });
      goCreate(window);
      await tick();
      const doc = window.document;
      doc.querySelector('#wiz-name').value = 'A';
      pick(window, ['/a/svc-iam', '/a/svc-ui']);
      click(window, doc.querySelector('#wiz-start-scan'));
      await tick(); await tick();
      click(window, doc.querySelector('#wiz-step1-hint a'));
      const setup = doc.getElementById('claude-setup-modal');
      assert.equal(setup.classList.contains('hidden'), false, 'Sign in… opens it');
      pressEscape(window);
      assert.equal(setup.classList.contains('hidden'), true, 'the pop-up took the Escape');
      assert.equal(window.location.hash, '#workspace-create', 'the wizard stays');
    } },
  ]);
});

const settle = async () => { for (let i = 0; i < 6; i += 1) await tick(); };
const json = (body, status = 200) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
const FOUND = [
  { path: '/a/svc-iam', name: 'svc-iam', key: 'svc-iam-0000aaaa', status: 'registered', problem: null, liftedFrom: [] },
  { path: '/x/api', name: 'api', key: 'api-0000bbbb', status: 'new', problem: null, liftedFrom: [] },
  { path: '/x/mono', name: 'mono', key: 'mono-0000cccc', status: 'new', problem: null, liftedFrom: ['/x/mono/packages/web'] },
  { path: '/x/docs', name: 'docs', key: '', status: 'problem', problem: 'Not in a git repository', liftedFrom: [] },
];
// The import routes, recording each request body in `sent`: Add… (pick-folder), the candidates,
// the bulk registration, the scan, and a one-folder listing for Worca's folder browser.
function importRoutes({ pick = { status: 'picked', path: '/x/acme.code-workspace', paths: ['/x/acme.code-workspace'] },
  found = FOUND, workspaceName = null, importStatus = 200, bulk = null, sent = {} } = {}) {
  const log = (k, opts) => (sent[k] ||= []).push(JSON.parse(opts.body || '{}'));
  return (u, opts) => {
    if (u.endsWith('/api/fs/pick-folder')) { log('pick', opts); return json(pick); }
    if (u.endsWith('/api/workspaces/import-candidates')) {
      log('import', opts);
      return importStatus === 200 ? json({ candidates: found, workspaceName, truncated: false }) : json({ error: 'give at least one path (paths or text)' }, importStatus);
    }
    if (u.endsWith('/api/projects/bulk')) { log('bulk', opts); return json(bulk); }
    if (u.endsWith('/api/workspaces/scan') && opts.method === 'POST') {
      log('scan', opts);
      return json({ runId: 'run-scan-1', workspaceId: 'wks-acme-0000abcd', title: 'Workspace scan: Acme', projectDir: '/a/svc-iam', projectNames: [] });
    }
    if (u.includes('/api/fs/dirs')) return json({ path: '/x', parent: '/', home: '/x', dirs: [{ name: 'api', path: '/x/api' }] });
    return null;
  };
}
const importBox = (doc, path) => [...doc.querySelectorAll('#wiz-import-list .wiz-import-cb')].find((c) => c.value === path);
const projectBox = (doc, path) => [...doc.querySelectorAll('#wiz-projects .wiz-proj-cb')].find((c) => c.value === path);
const untick = (window, cb) => { cb.checked = false; cb.dispatchEvent(new window.Event('change', { bubbles: true })); };
const tickBox = (window, cb) => { cb.checked = true; cb.dispatchEvent(new window.Event('change', { bubbles: true })); };
const addPasted = async (window, text) => {
  window.document.querySelector('#wiz-import-paste').value = text;
  click(window, window.document.querySelector('#wiz-import-paste-add'));
  await settle();
};
// The wizard with its import answer held until release(): what the user does while it runs.
async function bootHeldImport(body) {
  let release;
  const answer = new Promise((r) => { release = () => r({ ok: true, status: 200, json: async () => body }); });
  const rest = importRoutes();
  const { window } = await boot({ fetchHandler: (u, opts) => (u.endsWith('/api/workspaces/import-candidates') ? answer : rest(u, opts)) });
  goCreate(window);
  await tick();
  return { window, doc: window.document, release: () => release() };
}

test('Add… asks for folders and .code-workspace files, then lists what it found: new and registered rows ticked, a problem row with its reason, the file name as the workspace name', async () => {
  const sent = {};
  const { window } = await boot({ fetchHandler: importRoutes({ workspaceName: 'acme', sent }) });
  goCreate(window);
  await tick();
  const doc = window.document;
  click(window, doc.querySelector('#wiz-import-add'));
  await settle();
  assert.deepEqual(sent.pick, [{ purpose: 'repos', multiple: true }]);
  assert.deepEqual(sent.import, [{ paths: ['/x/acme.code-workspace'], text: '', depth: 1 }]);
  const rows = [...doc.querySelectorAll('#wiz-import-list .wiz-import-row')];
  assert.deepEqual(rows.map((r) => r.dataset.status), ['registered', 'new', 'new', 'problem']);
  assert.equal(importBox(doc, '/x/api').checked, true);
  assert.equal(importBox(doc, '/a/svc-iam').checked, true);
  assert.equal(projectBox(doc, '/a/svc-iam').checked, true, 'a registered row ticks its project in the list above');
  assert.equal(importBox(doc, '/x/docs').disabled, true);
  assert.equal(importBox(doc, '/x/docs').checked, false);
  assert.match(rows[3].textContent, /Not in a git repository/);
  assert.match(rows[2].textContent, /Repository top folder of \/x\/mono\/packages\/web/);
  assert.equal(doc.querySelector('#wiz-name').value, 'acme');
  assert.match(doc.querySelector('#wiz-import-hint').textContent, /Found 2 new, 1 already a project, 1 that can't join\./);
  assert.equal(doc.querySelector('#wiz-start-scan').disabled, false, 'three ticked');
  untick(window, importBox(doc, '/a/svc-iam'));
  assert.equal(projectBox(doc, '/a/svc-iam').checked, false, 'one pick, two lists');
});

test('Scan registers the ticked new rows (POST /api/projects/bulk), then scans every ticked path', async () => {
  const sent = {};
  const bulk = { projects: [...PROJECTS, { name: 'api', path: '/x/api', exists: true }],
    results: [{ index: 0, status: 'added', key: 'api-0000bbbb', name: 'api', path: '/x/api' }] };
  const { window, calls } = await boot({ fetchHandler: importRoutes({ bulk, sent, workspaceName: 'from-file' }) });
  goCreate(window);
  await tick();
  const doc = window.document;
  doc.querySelector('#wiz-name').value = 'Acme';
  click(window, doc.querySelector('#wiz-import-add'));
  await settle();
  assert.equal(doc.querySelector('#wiz-name').value, 'Acme', "a typed name is never replaced by the file's name");
  untick(window, importBox(doc, '/x/mono'));
  click(window, doc.querySelector('#wiz-start-scan'));
  await settle();
  assert.deepEqual(sent.bulk, [{ projects: [{ name: 'api', path: '/x/api' }] }]);
  assert.deepEqual(sent.scan.map((s) => s.projectPaths), [['/a/svc-iam', '/x/api']]);
  const order = calls.map((c) => c.u).filter((u) => u.endsWith('/api/projects/bulk') || u.endsWith('/api/workspaces/scan'));
  assert.deepEqual(order.map((u) => u.slice(u.indexOf('/api/'))), ['/api/projects/bulk', '/api/workspaces/scan']);
  assert.ok(viewShown(doc, 'runs'), 'the scan run took over');
});

test('a new row the server would not register stops the scan and names it; one registered meanwhile counts as registered', async () => {
  const run = async (results) => {
    const sent = {};
    const bulk = { projects: [...PROJECTS, { name: 'mono', path: '/x/mono', exists: true }], results };
    const { window } = await boot({ fetchHandler: importRoutes({ bulk, sent }) });
    goCreate(window);
    await tick();
    const doc = window.document;
    doc.querySelector('#wiz-name').value = 'Acme';
    click(window, doc.querySelector('#wiz-import-add'));
    await settle();
    click(window, doc.querySelector('#wiz-start-scan'));
    await settle();
    return { doc, sent };
  };
  const added = { index: 1, status: 'added', key: 'mono-0000cccc', name: 'mono', path: '/x/mono' };
  await checkRows([
    { name: 'a refused row: no scan, the reason as text, Scan enabled again', run: async () => {
      const { doc, sent } = await run([{ index: 0, status: 'skipped', name: 'api', path: '/x/api', reason: 'folder does not exist' }, added]);
      assert.equal(sent.scan, undefined, 'no scan request');
      const hint = doc.querySelector('#wiz-step1-hint');
      assert.ok(hint.classList.contains('err'));
      assert.match(hint.textContent, /\/x\/api \(folder does not exist\)/);
      assert.equal(importBox(doc, '/x/mono').closest('.wiz-import-row').dataset.status, 'registered');
      assert.equal(doc.querySelector('#wiz-start-scan').disabled, false);
    } },
    { name: 'already registered by someone else: the scan goes ahead with the row', run: async () => {
      const { sent } = await run([{ index: 0, status: 'skipped', name: 'api', path: '/x/api', reason: 'this project path is already registered' }, added]);
      assert.deepEqual(sent.scan.map((s) => s.projectPaths), [['/a/svc-iam', '/x/api', '/x/mono']]);
    } },
    { name: 'a 200 with no per-row results registered nothing: no scan', run: async () => {
      const { doc, sent } = await run(undefined);
      assert.equal(sent.scan, undefined, 'no scan request');
      assert.match(doc.querySelector('#wiz-step1-hint').textContent, /projects not added: HTTP 200/);
    } },
  ]);
});

test('Scan stays off while it registers the new rows, and scans what was ticked when it was pressed', async () => {
  const sent = {};
  let releaseBulk;
  const bulkAnswer = new Promise((r) => { releaseBulk = r; });
  const answers = [[FOUND[1]], [{ path: '/x/late', name: 'late', key: 'late-0000dddd', status: 'new', problem: null, liftedFrom: [] }]];
  const rest = importRoutes({ sent });
  const { window } = await boot({ fetchHandler: (u, opts) => {
    if (u.endsWith('/api/workspaces/import-candidates')) return json({ candidates: answers.shift() || [], workspaceName: null, truncated: false });
    if (u.endsWith('/api/projects/bulk')) { (sent.bulk ||= []).push(JSON.parse(opts.body)); return bulkAnswer; }
    return rest(u, opts);
  } });
  goCreate(window);
  await tick();
  const doc = window.document;
  doc.querySelector('#wiz-name').value = 'Acme';
  pick(window, ['/a/svc-iam']);
  await addPasted(window, '/x/api');
  const start = doc.querySelector('#wiz-start-scan');
  click(window, start);
  await settle();
  pick(window, ['/a/svc-ui']);
  assert.equal(start.disabled, true, 'a tick while the rows register leaves Scan off');
  await addPasted(window, '/x/late');
  assert.ok(importBox(doc, '/x/late'), 'the late answer is listed');
  releaseBulk({ ok: true, status: 200, json: async () => ({ projects: [...PROJECTS, { name: 'api', path: '/x/api', exists: true }],
    results: [{ index: 0, status: 'added', key: 'api-0000bbbb', name: 'api', path: '/x/api' }] }) });
  await settle();
  assert.deepEqual(sent.bulk, [{ projects: [{ name: 'api', path: '/x/api' }] }]);
  assert.deepEqual(sent.scan.map((s) => s.projectPaths), [['/a/svc-iam', '/x/api']], 'neither the later tick nor the unregistered late row joins');
});

test('the paste box sends its text (Add paths or Ctrl+Enter) with the depth pick; it clears on success and keeps the text on a refusal', async () => {
  const open = async (opts) => {
    const { window } = await boot({ fetchHandler: importRoutes(opts) });
    goCreate(window);
    await tick();
    return window;
  };
  await checkRows([
    { name: 'Add paths sends the text; the box clears', run: async () => {
      const sent = {};
      const doc = (await open({ sent })).document;
      doc.querySelector('#wiz-import-paste').value = '~/dev/api\n~/dev/web';
      click(doc.defaultView, doc.querySelector('#wiz-import-paste-add'));
      await settle();
      assert.deepEqual(sent.import, [{ paths: [], text: '~/dev/api\n~/dev/web', depth: 1 }]);
      assert.equal(doc.querySelector('#wiz-import-paste').value, '');
    } },
    { name: 'Look two levels deep sends depth 2; Ctrl+Enter adds', run: async () => {
      const sent = {};
      const window = await open({ sent });
      const doc = window.document;
      doc.querySelector('#wiz-import-deep').checked = true;
      const box = doc.querySelector('#wiz-import-paste');
      box.value = '/x';
      box.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
      await settle();
      assert.deepEqual(sent.import, [{ paths: [], text: '/x', depth: 2 }]);
    } },
    { name: 'a refused import keeps the text and shows the error', run: async () => {
      const doc = (await open({ importStatus: 400 })).document;
      doc.querySelector('#wiz-import-paste').value = 'relative';
      click(doc.defaultView, doc.querySelector('#wiz-import-paste-add'));
      await settle();
      assert.equal(doc.querySelector('#wiz-import-paste').value, 'relative');
      const hint = doc.querySelector('#wiz-import-hint');
      assert.ok(hint.classList.contains('err'));
      assert.match(hint.textContent, /at least one path/);
    } },
    { name: 'a line typed while the import runs stays in the box', run: async () => {
      const { window, doc, release } = await bootHeldImport({ candidates: [FOUND[1]], workspaceName: null, truncated: false });
      const box = doc.querySelector('#wiz-import-paste');
      box.value = '/x/api';
      click(window, doc.querySelector('#wiz-import-paste-add'));
      await settle();
      box.value = '/x/api\n/x/web';
      release();
      await settle();
      assert.ok(importBox(doc, '/x/api'), 'the answer was merged');
      assert.equal(box.value, '/x/api\n/x/web');
    } },
  ]);
});

test('new rows get unique project names: a taken name gets its parent folder in front', async () => {
  const sent = {};
  const found = [
    { path: '/org-a/api', name: 'api', key: 'k1', status: 'new', problem: null, liftedFrom: [] },
    { path: '/org-b/api', name: 'api', key: 'k2', status: 'new', problem: null, liftedFrom: [] },
    { path: '/z/svc-ui', name: 'svc-ui', key: 'k3', status: 'new', problem: null, liftedFrom: [] },
  ];
  const bulk = { projects: PROJECTS, results: found.map((f, index) => ({ index, status: 'added', name: '', path: f.path })) };
  const { window } = await boot({ fetchHandler: importRoutes({ found, bulk, sent }) });
  goCreate(window);
  await tick();
  const doc = window.document;
  doc.querySelector('#wiz-name').value = 'Names';
  click(window, doc.querySelector('#wiz-import-add'));
  await settle();
  click(window, doc.querySelector('#wiz-start-scan'));
  await settle();
  assert.deepEqual(sent.bulk[0].projects.map((p) => p.name), ['api', 'org-b-api', 'z-svc-ui']);
});

test('an import past the 40-project cap ticks the first 40 and says so', async () => {
  const found = Array.from({ length: 41 }, (_, i) => ({ path: `/big/r${i}`, name: `r${i}`, key: `r${i}-k`, status: 'new', problem: null, liftedFrom: [] }));
  const { window } = await boot({ fetchHandler: importRoutes({ found }) });
  goCreate(window);
  await tick();
  const doc = window.document;
  click(window, doc.querySelector('#wiz-import-add'));
  await settle();
  const boxes = [...doc.querySelectorAll('#wiz-import-list .wiz-import-cb')];
  assert.equal(boxes.filter((b) => b.checked).length, 40);
  assert.equal(boxes[40].checked, false);
  assert.match(doc.querySelector('#wiz-import-hint').textContent, /1 left unticked: a workspace holds up to 40 projects/);
  assert.equal(doc.querySelector('#wiz-start-scan').disabled, false);
});

test("no system dialog: Add… opens Worca's folder browser in multi-select, and its picks are imported", async () => {
  const sent = {};
  const { window } = await boot({ fetchHandler: importRoutes({ pick: { status: 'unsupported' }, sent }) });
  goCreate(window);
  await tick();
  const doc = window.document;
  click(window, doc.querySelector('#wiz-import-add'));
  await settle();
  const fb = doc.querySelector('#folder-browser');
  assert.ok(!fb.classList.contains('hidden'), 'the folder browser is open');
  assert.ok(fb.classList.contains('multi'), 'in multi-select');
  const cb = doc.querySelector('#folderList .folder-pick');
  cb.checked = true;
  cb.dispatchEvent(new window.Event('change', { bubbles: true }));
  click(window, doc.querySelector('#folderSelectMany'));
  await settle();
  assert.deepEqual(sent.import, [{ paths: ['/x/api'], text: '', depth: 1 }]);
});

test('leaving the wizard forgets the import: rows, ticks, paste text and the depth pick', async () => {
  const { window } = await boot({ fetchHandler: importRoutes() });
  goCreate(window);
  await tick();
  const doc = window.document;
  click(window, doc.querySelector('#wiz-import-add'));
  await settle();
  doc.querySelector('#wiz-import-paste').value = '/left/over';
  doc.querySelector('#wiz-import-deep').checked = true;
  window.location.hash = 'new';
  window.dispatchEvent(new window.Event('hashchange'));
  await tick();
  goCreate(window);
  await settle();
  assert.equal(doc.querySelectorAll('#wiz-import-list .wiz-import-row').length, 0);
  assert.equal(doc.querySelector('#wiz-import-list').hidden, true);
  assert.equal(doc.querySelector('#wiz-import-paste').value, '');
  assert.equal(doc.querySelector('#wiz-import-deep').checked, false);
  assert.equal(projectBox(doc, '/a/svc-iam').checked, false);
});

test('an import answer that lands after the wizard was left and re-entered adds nothing to the new wizard', async () => {
  const { window, doc, release } = await bootHeldImport({ candidates: [FOUND[1]], workspaceName: 'late', truncated: false });
  doc.querySelector('#wiz-import-paste').value = '/x/api';
  click(window, doc.querySelector('#wiz-import-paste-add'));
  await settle();
  window.location.hash = 'new';
  window.dispatchEvent(new window.Event('hashchange'));
  await tick();
  goCreate(window);
  await settle();
  assert.equal(doc.querySelector('#wiz-import-paste-add').disabled, false, 're-entry frees the buttons');
  release();
  await settle();
  assert.equal(doc.querySelectorAll('#wiz-import-list .wiz-import-row').length, 0);
  assert.equal(doc.querySelector('#wiz-name').value, '');
  assert.equal(doc.querySelector('#wiz-import-hint').textContent, '');
  assert.equal(doc.querySelector('#wiz-import-paste-add').disabled, false);
});

test('a later answer that names a listed repository another way adds no second row or tick, and the hint says it is listed already', async () => {
  const answers = [
    [{ path: '/x/api', name: 'api', key: 'api-0000bbbb', status: 'new', problem: null, liftedFrom: [] }],
    [{ path: '/link/api', name: 'api', key: 'api-0000bbbb', status: 'new', problem: null, liftedFrom: [] }],
  ];
  const rest = importRoutes();
  const { window } = await boot({ fetchHandler: (u, opts) => (u.endsWith('/api/workspaces/import-candidates')
    ? json({ candidates: answers.shift() || [], workspaceName: null, truncated: false })
    : rest(u, opts)) });
  goCreate(window);
  await tick();
  const doc = window.document;
  for (const text of ['/x/api', '/link/api']) {
    doc.querySelector('#wiz-import-paste').value = text;
    click(window, doc.querySelector('#wiz-import-paste-add'));
    await settle();
  }
  assert.deepEqual([...doc.querySelectorAll('#wiz-import-list .wiz-import-cb')].map((c) => c.value), ['/x/api']);
  assert.equal(doc.querySelector('#wiz-start-scan').disabled, true, 'one tick, not two');
  assert.equal(doc.querySelector('#wiz-import-hint').textContent, 'Found 1 already in the list.', 'the hint counts no row it did not add');
});

test("a re-import keeps the user's untick; a ticked row that comes back as a problem loses its tick and stays out of the scan", async () => {
  const sent = {};
  const api = { path: '/x/api', name: 'api', key: 'api-0000bbbb', status: 'new', problem: null, liftedFrom: [] };
  const answers = [[api], [api], [{ ...api, key: '', status: 'problem', problem: 'Has no commit yet' }]];
  const rest = importRoutes({ sent });
  const { window } = await boot({ fetchHandler: (u, opts) => (u.endsWith('/api/workspaces/import-candidates')
    ? json({ candidates: answers.shift() || [], workspaceName: null, truncated: false })
    : rest(u, opts)) });
  goCreate(window);
  await tick();
  const doc = window.document;
  await addPasted(window, '/x/api');
  assert.equal(importBox(doc, '/x/api').checked, true, 'a new row starts ticked');
  untick(window, importBox(doc, '/x/api'));
  await addPasted(window, '/x/api');
  assert.equal(importBox(doc, '/x/api').checked, false, 'the same row again keeps the untick');
  tickBox(window, importBox(doc, '/x/api'));
  pick(window, ['/a/svc-iam', '/a/svc-ui']);
  await addPasted(window, '/x/api');
  assert.equal(importBox(doc, '/x/api').disabled, true);
  assert.equal(importBox(doc, '/x/api').checked, false);
  doc.querySelector('#wiz-name').value = 'Acme';
  click(window, doc.querySelector('#wiz-start-scan'));
  await settle();
  assert.equal(sent.bulk, undefined, 'no new row to register');
  assert.deepEqual(sent.scan.map((s) => s.projectPaths), [['/a/svc-iam', '/a/svc-ui']]);
});

test("a disabled box never shows a tick: a problem row, even when the project row with its path is ticked, and a project the list still shows as missing; Add… does nothing while Worca's browser is open", async () => {
  const sent = {};
  const found = [
    { path: '/a/svc-ui', name: 'svc-ui', key: '', status: 'problem', problem: 'Has no commit yet', liftedFrom: [] },
    // Back on disk since the page read the project list: the import finds it registered.
    { path: '/a/gone', name: 'gone', key: 'gone-0000eeee', status: 'registered', problem: null, liftedFrom: [] },
  ];
  const { window } = await boot({ fetchHandler: importRoutes({ found, pick: { status: 'unsupported' }, sent }) });
  goCreate(window);
  await tick();
  const doc = window.document;
  doc.querySelector('#wiz-import-paste').value = '/a/svc-ui';
  click(window, doc.querySelector('#wiz-import-paste-add'));
  await settle();
  assert.equal(importBox(doc, '/a/gone').checked, true, 'the registered row is ticked');
  assert.equal(projectBox(doc, '/a/gone').checked, false, 'the missing project row stays clear: it could never be unticked');
  const cb = projectBox(doc, '/a/svc-ui');
  cb.checked = true;
  cb.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(importBox(doc, '/a/svc-ui').checked, false, 'the disabled box stays clear');
  click(window, doc.querySelector('#wiz-import-add'));
  await settle();
  assert.ok(!doc.querySelector('#folder-browser').classList.contains('hidden'), 'the browser is open');
  click(window, doc.querySelector('#wiz-import-add'));
  await settle();
  assert.equal(sent.pick.length, 1, 'no second dialog request while the browser is open');
});

test('Escape in the Connect Claude Code dialog closes the dialog, not the wizard', async () => {
  const rest = importRoutes();
  const { window } = await boot({ fetchHandler: (u, opts) => (u.endsWith('/api/workspaces/scan') && opts.method === 'POST'
    ? json({ code: 'claude-signed-out', error: 'signed out' }, 409) : rest(u, opts)) });
  goCreate(window);
  await tick();
  const doc = window.document;
  doc.querySelector('#wiz-name').value = 'Keep me';
  pick(window, ['/a/svc-iam', '/a/svc-ui']);
  click(window, doc.querySelector('#wiz-start-scan'));
  await settle();
  click(window, doc.querySelector('#wiz-step1-hint a'));          // Sign in… opens it the way a person does
  assert.ok(!doc.querySelector('#claude-setup-modal').classList.contains('hidden'), 'the dialog is open');
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await settle();
  assert.ok(doc.querySelector('#claude-setup-modal').classList.contains('hidden'), 'the dialog closed');
  assert.ok(viewShown(doc, 'workspace-create'), 'the wizard stayed');
  assert.equal(doc.querySelector('#wiz-name').value, 'Keep me');
});

test("Escape closes Worca's folder browser but leaves the wizard and its import list alone", async () => {
  const { window } = await boot({ fetchHandler: importRoutes({ pick: { status: 'unsupported' } }) });
  goCreate(window);
  await tick();
  const doc = window.document;
  doc.querySelector('#wiz-name').value = 'Keep me';
  click(window, doc.querySelector('#wiz-import-add'));
  await settle();
  assert.ok(!doc.querySelector('#folder-browser').classList.contains('hidden'), 'the browser is open');
  // cancelable: a real key event is; without it preventDefault() is a no-op in jsdom.
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await settle();
  assert.ok(doc.querySelector('#folder-browser').classList.contains('hidden'), 'the browser closed');
  assert.ok(viewShown(doc, 'workspace-create'), 'the wizard stayed');
  assert.equal(doc.querySelector('#wiz-name').value, 'Keep me');
});

test('E10: a registered import row whose project has team memory available carries the mark; a projects-changed frame adds it once the check answers', async () => {
  let offer = false;
  const rest = importRoutes();
  const { window } = await boot({ fetchHandler: (u, opts) => {
    if (u.endsWith('/api/projects') && (!opts || !opts.method || opts.method === 'GET')) {
      return json({ projects: [...PROJECTS, { name: 'svc-iam', path: '/a/svc-iam', exists: true, key: 'svc-iam-0000aaaa', ...(offer ? { teamMemoryOffer: true } : {}) }] });
    }
    return rest(u, opts);
  } });
  goCreate(window);
  await tick();
  const doc = window.document;
  click(window, doc.querySelector('#wiz-import-add'));
  await settle();
  const mark = (path) => importBox(doc, path).closest('.wiz-import-row').querySelector('.team-mem-mark');
  assert.equal(mark('/a/svc-iam'), null, 'not checked yet');
  offer = true;
  WSStub.last._listeners.message.forEach((fn) => fn({ data: JSON.stringify({ type: 'projects-changed', action: 'updated' }) }));
  await settle();
  assert.equal(mark('/a/svc-iam').textContent, 'team memory available');
  assert.equal(mark('/x/api'), null, 'a new row is not a project yet');
});
