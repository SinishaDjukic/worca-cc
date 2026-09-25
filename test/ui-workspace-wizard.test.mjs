// test/ui-workspace-wizard.test.mjs — jsdom boot tests for the one-step creation wizard:
// gating, the scan POST, the hand-off to the run's card on Running, error handling
// (409 stays), leave-reset, JSON safety (.textContent only), and the retired steps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

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
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
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

test('gating: Scan is disabled until 2+ existing projects are ticked', async () => {
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
});

test('Select all toggles every usable project (never a missing one) and tracks partial state', async () => {
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
});

test('Select all is disabled when fewer than two projects are usable', async () => {
  const { window } = await boot({
    fetchHandler: (u) => u.includes('/api/projects')
      ? Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [PROJECTS[0], PROJECTS[3]] }) }) : null,
  });
  goCreate(window);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(window.document.querySelector('#wiz-select-all').disabled, true);
});

test('Scan POSTs {projectPaths,name} and hands off to the run card on Running', async () => {
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
  assert.ok(viewShown(doc, 'running'), 'on Running');
  assert.ok(!viewShown(doc, 'workspace-create'), 'the wizard is left');
  assert.ok(doc.querySelector('#run-list [data-run-id="run-scan-1"]'), 'the scan run has a card');
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

test('a refused scan (409) stays in the wizard with the error as TEXT and Scan re-enabled', async () => {
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
});

test('leaving and re-entering the wizard starts clean', async () => {
  const { window } = await boot();
  goCreate(window);
  await tick();
  const doc = window.document;
  doc.querySelector('#wiz-name').value = 'Keep?';
  pick(window, ['/a/svc-iam', '/a/svc-ui']);
  window.location.hash = 'workspaces'; window.dispatchEvent(new window.Event('hashchange'));
  await tick();
  goCreate(window);
  await tick();
  assert.equal(doc.querySelector('#wiz-name').value, '');
  assert.equal(doc.querySelectorAll('#wiz-projects .wiz-proj-cb:checked').length, 0);
});

test('the retired scan steps and the scan-* socket family are gone', async () => {
  const html = readFileSync(htmlPath, 'utf8');
  for (const id of ['wiz-step-2', 'wiz-step-3', 'wiz-save', 'wiz-desc', 'wiz-abort', 'wiz-track'])
    assert.ok(!html.includes(`id="${id}"`), `#${id} removed`);
  const js = readFileSync(appPath, 'utf8');
  assert.ok(!js.includes("'scan-progress'"), 'no scan-* router branch');
  assert.ok(!js.includes('onScanEvent'), 'no scan event handler');
});

test('workspaces-changed refreshes the workspace list cache (the New Pipeline picker)', async () => {
  const { window, ws, calls } = await boot();
  await tick();
  const before = calls.filter((c) => c.u.endsWith('/api/workspaces')).length;
  ws().deliver({ type: 'workspaces-changed', action: 'scan-created' });
  await tick(); await tick();
  assert.ok(calls.filter((c) => c.u.endsWith('/api/workspaces')).length > before, 'GET /api/workspaces refetched');
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

test('a background scan save rebuilds the New Pipeline picker on any view; the selected workspace keeps its branch picks', async () => {
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

test('the Models column sits right of the projects and starts from Settings › General › Workspaces', async () => {
  const { window } = await boot({ fetchHandler: withModels([]) });
  goCreate(window);
  await tick(); await tick(); await tick();
  const doc = window.document;
  const col = doc.querySelector('#wiz-step-1 .wiz-models');
  assert.ok(col, 'a Models column');
  assert.ok(!doc.querySelector('#wiz-step-1 .wiz-main').contains(col), 'beside the name/projects column, not inside it');
  for (const id of ['wiz-scan-model', 'wiz-scan-effort', 'wiz-agent-model', 'wiz-agent-effort']) assert.ok(col.querySelector(`#${id}`), id);
  assert.equal(doc.querySelector('#wiz-scan-model').value, 'claude-opus-5-5');
  assert.equal(doc.querySelector('#wiz-scan-effort').value, 'high');
  assert.deepEqual([...doc.querySelector('#wiz-agent-model').options].map((o) => o.value), ['sonnet', 'opus', 'fable']);
  assert.equal(doc.querySelector('#wiz-agent-model').value, 'fable');
  assert.equal(doc.querySelector('#wiz-agent-effort').value, 'max');
});

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

test('size note: none up to 10, "a bit big" above 10, a stronger warning above 20, Scan blocked above 40', async () => {
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
  assert.match(note.textContent, /A bit big — 11 projects/);
  tickFirst(window, 20);
  assert.equal(sizeLevel(doc), 'big');
  tickFirst(window, 21);
  assert.equal(sizeLevel(doc), 'very-big');
  assert.match(note.textContent, /Big workspace — 21 projects/);
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
});

test('Select all past 40 ticks everything, blocks Scan and says so; a forced startWizardScan posts nothing', async () => {
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
});

test('the Projects label says 2 to 40, and re-entering the wizard clears the note', async () => {
  const { window } = await boot({ fetchHandler: withMany() });
  goCreate(window);
  await tick();
  const doc = window.document;
  assert.match(doc.querySelector('#wiz-step-1 .wiz-proj-head .opt').textContent, /select 2 to 40/);
  tickFirst(window, 25);
  assert.equal(sizeLevel(doc), 'very-big');
  window.location.hash = 'workspaces'; window.dispatchEvent(new window.Event('hashchange'));
  await tick();
  goCreate(window);
  await tick();
  assert.equal(sizeLevel(doc), 'none');
});
