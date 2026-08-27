// test/ui-target-selector.test.mjs — jsdom boot tests for the New-Pipeline
// target selector (Project vs Workspace): mutual exclusivity, incomplete-disabled
// options, member chips, and the mutually-exclusive submit body (§5.4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const WORKSPACES = [
  { id: 'wks-alpha-00000001', name: 'Alpha WS', description: '# x', projectPaths: ['/a/svc-iam', '/a/svc-ui'], projectKeys: ['k1', 'k2'], exists: [true, true], createdAt: 'x', updatedAt: 'x' },
  { id: 'wks-beta-00000002', name: 'Beta WS', description: '', projectPaths: ['/b/api', '/b/web'], projectKeys: ['k3', 'k4'], exists: [true, false], createdAt: 'x', updatedAt: 'x' },
];
const PROJECTS = [{ name: 'svc-iam', path: '/a/svc-iam', exists: true }, { name: 'svc-ui', path: '/a/svc-ui', exists: true }];

async function boot({ local, posted } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
  if (local) for (const [k, v] of Object.entries(local)) window.localStorage.setItem(k, v);
  window.fetch = (url, opts) => {
    const u = String(url);
    if (u.includes('/api/projects')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: PROJECTS }) });
    if (u.includes('/api/workspaces')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ workspaces: WORKSPACES }) });
    if (u.includes('/api/branches')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ branches: [], current: '' }) });
    if (u.endsWith('/api/run') && opts && opts.method === 'POST') {
      if (posted) posted.push(JSON.parse(opts.body));
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ runId: 'run-1' }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  return window;
}
const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true }));

test('default target is project: project pane shown, workspace pane hidden', async () => {
  const window = await boot();
  const doc = window.document;
  assert.equal(doc.querySelector('#target-project-pane').classList.contains('hidden'), false);
  assert.equal(doc.querySelector('#target-workspace-pane').classList.contains('hidden'), true);
});

test('switching to Workspace toggles panes (mutual exclusivity) + persists choice', async () => {
  const window = await boot();
  const doc = window.document;
  const wsBtn = doc.querySelector('#target-seg button[data-target="workspace"]');
  click(window, wsBtn);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(doc.querySelector('#target-project-pane').classList.contains('hidden'), true, 'project pane hidden');
  assert.equal(doc.querySelector('#target-workspace-pane').classList.contains('hidden'), false, 'workspace pane shown');
  assert.equal(doc.querySelector('input[name="target"][value="workspace"]').checked, true, 'hidden radio is the source of truth');
  assert.equal(window.localStorage.getItem('worca-cc.runTarget'), 'workspace');
});

test('workspace options skip incomplete workspaces as disabled "+ (incomplete)"', async () => {
  const window = await boot();
  const doc = window.document;
  click(window, doc.querySelector('#target-seg button[data-target="workspace"]'));
  await new Promise((r) => setTimeout(r, 0));
  const opts = [...doc.querySelectorAll('#workspaceSelect option')];
  const beta = opts.find((o) => o.value === 'wks-beta-00000002');
  assert.ok(beta, 'Beta option present');
  assert.equal(beta.disabled, true, 'incomplete workspace is disabled');
  assert.match(beta.textContent, /\(incomplete\)$/, 'incomplete label suffix');
  const alpha = opts.find((o) => o.value === 'wks-alpha-00000001');
  assert.equal(alpha.disabled, false, 'complete workspace is selectable');
});

test('selecting a workspace renders its member chips (missing flagged)', async () => {
  const window = await boot();
  const doc = window.document;
  click(window, doc.querySelector('#target-seg button[data-target="workspace"]'));
  await new Promise((r) => setTimeout(r, 0));
  const sel = doc.querySelector('#workspaceSelect');
  sel.value = 'wks-alpha-00000001';
  sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  const chips = [...doc.querySelectorAll('#ws-members .chip')];
  assert.equal(chips.length, 2);
  assert.equal(chips[0].textContent, 'svc-iam');
  assert.equal(chips[1].textContent, 'svc-ui');
});

test('workspace mode swaps the single source dropdown for per-project dropdowns', async () => {
  const window = await boot();
  const doc = window.document;
  click(window, doc.querySelector('#target-seg button[data-target="workspace"]'));
  await new Promise((r) => setTimeout(r, 0));
  // Select a complete workspace so its members render.
  const wsel = doc.querySelector('#workspaceSelect');
  wsel.value = 'wks-alpha-00000001';
  wsel.dispatchEvent(new window.Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  // Single dropdown hidden; per-project list shown with one select per member.
  assert.equal(doc.querySelector('#sourceBranchWrap').classList.contains('hidden'), true);
  assert.equal(doc.querySelector('#ws-source-branches').classList.contains('hidden'), false);
  assert.equal(doc.querySelectorAll('#ws-source-branches select.ws-src-select').length, 2);
  // The "Source branch" field/header itself is never hidden.
  assert.equal(doc.querySelector('#sourceBranchHint').closest('.field').classList.contains('hidden'), false);
});

test('submit in workspace mode sends {workspaceId} and NO projectDir; project mode is unchanged', async () => {
  const posted = [];
  const window = await boot({ posted });
  const doc = window.document;

  // Project mode (byte-identical): pick project + prompt + submit.
  const psel = doc.querySelector('#projectSelect');
  psel.value = '/a/svc-iam';
  psel.dispatchEvent(new window.Event('change', { bubbles: true }));
  doc.querySelector('#prompt').value = 'do a thing';
  doc.querySelector('#run-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(posted.length, 1);
  assert.equal(posted[0].projectDir, '/a/svc-iam');
  assert.equal('workspaceId' in posted[0], false, 'no workspaceId in project mode');

  // Workspace mode: switch, pick a (complete) workspace, submit.
  click(window, doc.querySelector('#target-seg button[data-target="workspace"]'));
  await new Promise((r) => setTimeout(r, 0));
  const wsel = doc.querySelector('#workspaceSelect');
  wsel.value = 'wks-alpha-00000001';
  wsel.dispatchEvent(new window.Event('change', { bubbles: true }));
  doc.querySelector('#prompt').value = 'do another thing';
  doc.querySelector('#run-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(posted.length, 2);
  assert.equal(posted[1].workspaceId, 'wks-alpha-00000001');
  assert.equal('projectDir' in posted[1], false, 'no projectDir in workspace mode');
});

test('stale remembered workspace id is cleared and falls back to project target', async () => {
  const window = await boot({ local: { 'worca-cc.runTarget': 'workspace', 'worca-cc.lastWorkspace': 'wks-gone-99999999' } });
  await new Promise((r) => setTimeout(r, 0));
  // The remembered id is not in the fetched list → cleared + fall back to project.
  assert.equal(window.localStorage.getItem('worca-cc.lastWorkspace'), null, 'stale id cleared');
  const doc = window.document;
  assert.equal(doc.querySelector('#target-project-pane').classList.contains('hidden'), false, 'fell back to project pane');
});
