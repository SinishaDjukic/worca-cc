// test/ui-workspace-source-branches.test.mjs — per-project source-branch dropdowns
// in the New-pipeline workspace mode (render + HEAD default + submit map).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const WORKSPACES = [
  { id: 'wks-alpha-00000001', name: 'Alpha WS', description: '# x',
    projectPaths: ['/a/svc-iam', '/a/svc-ui'], projectKeys: ['svc-iam-aaaa1111', 'svc-ui-bbbb2222'],
    exists: [true, true], createdAt: 'x', updatedAt: 'x' },
];
const PROJECTS = [{ name: 'svc-iam', path: '/a/svc-iam', exists: true }, { name: 'svc-ui', path: '/a/svc-ui', exists: true }];
const BRANCHES = {
  '/a/svc-iam': { branches: ['main', 'develop'], current: 'develop' },
  '/a/svc-ui': { branches: ['main', 'release'], current: 'main' },
};

async function boot({ posted } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
  window.fetch = (url, opts) => {
    const u = String(url);
    if (u.includes('/api/projects')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: PROJECTS }) });
    if (u.includes('/api/workspaces')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ workspaces: WORKSPACES }) });
    if (u.includes('/api/branches')) {
      const dir = decodeURIComponent(new URL(u, 'http://x').searchParams.get('projectDir') || '');
      return Promise.resolve({ ok: true, status: 200, json: async () => (BRANCHES[dir] || { branches: [], current: '' }) });
    }
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
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  return window;
}
const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true }));
const selectWorkspace = async (window, id) => {
  const doc = window.document;
  click(window, doc.querySelector('#target-seg button[data-target="workspace"]'));
  await new Promise((r) => setTimeout(r, 0));
  const sel = doc.querySelector('#workspaceSelect');
  sel.value = id; sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
};

test('workspace mode hides the single source dropdown and shows one per member', async () => {
  const window = await boot();
  const doc = window.document;
  await selectWorkspace(window, 'wks-alpha-00000001');
  assert.equal(doc.querySelector('#sourceBranchWrap').classList.contains('hidden'), true, 'single dropdown hidden');
  assert.equal(doc.querySelector('#ws-source-branches').classList.contains('hidden'), false, 'per-project list shown');
  const selects = [...doc.querySelectorAll('#ws-source-branches select.ws-src-select')];
  assert.equal(selects.length, 2, 'one dropdown per member');
  const names = [...doc.querySelectorAll('#ws-source-branches .ws-src-name')].map((n) => n.textContent);
  assert.deepEqual(names, ['svc-iam', 'svc-ui']);
});

test('each dropdown is keyed by projectKey and defaults to that project\'s current branch (HEAD)', async () => {
  const window = await boot();
  const doc = window.document;
  await selectWorkspace(window, 'wks-alpha-00000001');
  const selects = [...doc.querySelectorAll('#ws-source-branches select.ws-src-select')];
  assert.equal(selects[0].dataset.projectKey, 'svc-iam-aaaa1111');
  assert.equal(selects[1].dataset.projectKey, 'svc-ui-bbbb2222');
  // HEAD pre-selected (svc-iam → develop, svc-ui → main).
  assert.equal(selects[0].value, 'develop');
  assert.equal(selects[1].value, 'main');
  // The list also offers an explicit "auto" placeholder (empty value) first.
  assert.equal(selects[0].options[0].value, '');
});

test('switching back to project mode restores the single dropdown and clears per-project list', async () => {
  const window = await boot();
  const doc = window.document;
  await selectWorkspace(window, 'wks-alpha-00000001');
  click(window, doc.querySelector('#target-seg button[data-target="project"]'));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(doc.querySelector('#sourceBranchWrap').classList.contains('hidden'), false);
  assert.equal(doc.querySelector('#ws-source-branches').classList.contains('hidden'), true);
  assert.equal(doc.querySelectorAll('#ws-source-branches select').length, 0);
});

test('submit sends sourceBranchByKey keyed by projectKey; omits empties; no scalar sourceBranch', async () => {
  const posted = [];
  const window = await boot({ posted });
  const doc = window.document;
  await selectWorkspace(window, 'wks-alpha-00000001');

  const selects = [...doc.querySelectorAll('#ws-source-branches select.ws-src-select')];
  // svc-iam: choose an explicit branch; svc-ui: leave on the "auto" placeholder (value '').
  selects[0].value = 'main'; selects[0].dispatchEvent(new window.Event('change', { bubbles: true }));
  selects[1].value = ''; selects[1].dispatchEvent(new window.Event('change', { bubbles: true }));

  doc.querySelector('#prompt').value = 'do work';
  doc.querySelector('#run-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(posted.length, 1);
  const body = posted[0];
  assert.equal(body.workspaceId, 'wks-alpha-00000001');
  assert.deepEqual(body.sourceBranchByKey, { 'svc-iam-aaaa1111': 'main' }, 'only the chosen, non-empty entry is sent');
  assert.equal('sourceBranch' in body, false, 'no scalar sourceBranch in workspace mode');
  assert.equal('projectDir' in body, false);
});

test('submit with all dropdowns on auto sends no sourceBranchByKey', async () => {
  const posted = [];
  const window = await boot({ posted });
  const doc = window.document;
  await selectWorkspace(window, 'wks-alpha-00000001');
  // svc-iam defaults to HEAD 'develop', svc-ui to 'main' — reset both to the empty "auto".
  for (const s of doc.querySelectorAll('#ws-source-branches select.ws-src-select')) {
    s.value = ''; s.dispatchEvent(new window.Event('change', { bubbles: true }));
  }
  doc.querySelector('#prompt').value = 'do work';
  doc.querySelector('#run-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal('sourceBranchByKey' in posted[0], false, 'omit the map entirely when nothing chosen');
});
