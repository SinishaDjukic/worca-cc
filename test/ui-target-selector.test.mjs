// test/ui-target-selector.test.mjs — jsdom boot tests for the New-Pipeline
// target selector (Project vs Workspace): mutual exclusivity, incomplete-disabled
// options, member chips, and the mutually-exclusive submit body (§5.4).
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

const WORKSPACES = [
  { id: 'wks-alpha-00000001', name: 'Alpha WS', description: '# x', projectPaths: ['/a/svc-iam', '/a/svc-ui'], projectKeys: ['k1', 'k2'], exists: [true, true], createdAt: 'x', updatedAt: 'x' },
  { id: 'wks-beta-00000002', name: 'Beta WS', description: '', projectPaths: ['/b/api', '/b/web'], projectKeys: ['k3', 'k4'], exists: [true, false], createdAt: 'x', updatedAt: 'x' },
  // P5: a Git member and a Folder member (annotated vcs, aligned with projectPaths).
  { id: 'wks-gamma-00000003', name: 'Gamma WS', description: '', projectPaths: ['/g/api', '/g/notes'], projectKeys: ['k5', 'k6'],
    exists: [true, true], vcs: ['git', 'none'], createdAt: 'x', updatedAt: 'x' },
  // P5: every member a Folder project.
  { id: 'wks-folders-00000004', name: 'Folders WS', description: '', projectPaths: ['/f/notes', '/f/docs'], projectKeys: ['k7', 'k8'],
    exists: [true, true], vcs: ['none', 'none'], createdAt: 'x', updatedAt: 'x' },
];
const PROJECTS = [{ name: 'svc-iam', path: '/a/svc-iam', exists: true }, { name: 'svc-ui', path: '/a/svc-ui', exists: true }];

async function boot({ local, posted, calls, branches = [], answer = null } = {}) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
  if (local) for (const [k, v] of Object.entries(local)) window.localStorage.setItem(k, v);
  window.fetch = (url, opts) => {
    const u = String(url);
    if (calls) calls.push(u);
    if (u.includes('/api/projects')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: PROJECTS }) });
    if (u.includes('/api/workspaces')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ workspaces: WORKSPACES }) });
    if (u.includes('/api/branches')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ branches, current: branches[0] || '' }) });
    if (u.endsWith('/api/run') && opts && opts.method === 'POST') {
      if (posted) posted.push(JSON.parse(opts.body));
      if (answer) return Promise.resolve({ ok: answer.status < 400, status: answer.status, json: async () => answer.body });
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

test('selecting a workspace renders its member chips (missing flagged) and swaps the single source dropdown for per-project dropdowns', async () => {
  const window = await boot();
  const doc = window.document;
  click(window, doc.querySelector('#target-seg button[data-target="workspace"]'));
  await new Promise((r) => setTimeout(r, 0));
  // Select a complete workspace so its members render.
  const wsel = doc.querySelector('#workspaceSelect');
  wsel.value = 'wks-alpha-00000001';
  wsel.dispatchEvent(new window.Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  await checkRows([
    { name: 'selecting a workspace renders its member chips (missing flagged)', run: async () => {
      const chips = [...doc.querySelectorAll('#ws-members .chip')];
      assert.equal(chips.length, 2);
      assert.equal(chips[0].textContent, 'svc-iam');
      assert.equal(chips[1].textContent, 'svc-ui');
    } },
    { name: 'workspace mode swaps the single source dropdown for per-project dropdowns', run: async () => {
      // Single project row hidden; one table row per member shown instead (design v3).
      assert.equal(doc.querySelector('#bt-project-row').hidden, true);
      assert.equal(doc.querySelector('#ws-source-branches').classList.contains('hidden'), false);
      assert.equal(doc.querySelectorAll('#ws-source-branches select.ws-src-select').length, 2);
      // The "Source branch" field/header itself is never hidden.
      assert.equal(doc.querySelector('#sourceBranch').closest('.field').classList.contains('hidden'), false);
    } },
  ]);
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

test('a Folder member of the picked workspace gets a row with its chip and "on a copy", and no source-branch picker', async () => {
  const posted = [];
  const calls = [];
  const window = await boot({ posted, calls, branches: ['main'] });
  const doc = window.document;
  const tick = () => new Promise((r) => setTimeout(r, 0));
  click(window, doc.querySelector('#target-seg button[data-target="workspace"]'));
  await tick();
  const wsel = doc.querySelector('#workspaceSelect');
  wsel.value = 'wks-gamma-00000003';
  wsel.dispatchEvent(new window.Event('change', { bubbles: true }));
  for (let i = 0; i < 4; i++) await tick();
  const rows = [...doc.querySelectorAll('#ws-source-branches .ws-src-row')];
  assert.deepEqual(rows.map((r) => r.dataset.projectKey), ['k5', 'k6']);
  assert.ok(rows[0].querySelector('select.ws-src-select'));
  assert.equal(rows[0].querySelector('.kind-chip'), null, 'a Git member row is unchanged');
  assert.equal(rows[1].querySelector('select'), null);
  assert.equal(rows[1].querySelector('.kind-chip').textContent, 'Folder');
  assert.equal(rows[1].querySelector('.bt-outcome').textContent, 'on a copy');
  // No branch list or sync read ever names the Folder member; the Git member still reads its branches.
  const reads = calls.filter((u) => u.startsWith('/api/branches') || u.startsWith('/api/sync'));
  assert.deepEqual(reads.filter((u) => u.includes(encodeURIComponent('/g/notes'))), []);
  assert.ok(reads.some((u) => u.startsWith('/api/branches') && u.includes(encodeURIComponent('/g/api'))));
  rows[0].querySelector('select').value = 'main';
  doc.querySelector('#prompt').value = 'do it';
  doc.querySelector('#run-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await tick();
  assert.equal(posted.at(-1).workspaceId, 'wks-gamma-00000003');
  assert.deepEqual(posted.at(-1).sourceBranchByKey, { k5: 'main' }, 'the Folder member never reaches sourceBranchByKey');
});

const pickWorkspace = async (window, id) => {
  const doc = window.document;
  click(window, doc.querySelector('#target-seg button[data-target="workspace"]'));
  await new Promise((r) => setTimeout(r, 0));
  const wsel = doc.querySelector('#workspaceSelect');
  wsel.value = id;
  wsel.dispatchEvent(new window.Event('change', { bubbles: true }));
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};

test('an all-Folder workspace has no Branches block (as a Folder project) and posts no branch keys; a mixed one keeps it', async () => {
  const posted = [];
  const window = await boot({ posted, branches: ['main'] });
  const doc = window.document;
  const tick = () => new Promise((r) => setTimeout(r, 0));
  await pickWorkspace(window, 'wks-folders-00000004');
  // style.css hides #branch-fields (and every git-only control) under #run-form[data-work-mode="folder"]; jsdom loads no CSS.
  assert.equal(doc.querySelector('#run-form').dataset.workMode, 'folder');
  assert.deepEqual([...doc.querySelectorAll('#ws-source-branches .ws-src-row .bt-outcome')].map((c) => c.textContent), ['on a copy', 'on a copy']);
  doc.querySelector('#featureBranch').value = 'feat/hidden';   // hidden, not removed: the submit still reads it
  doc.querySelector('#prompt').value = 'tidy both';
  doc.querySelector('#run-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await tick(); await tick();
  assert.equal(posted.at(-1).workspaceId, 'wks-folders-00000004');
  assert.deepEqual(['featureBranch', 'sourceBranch', 'sourceBranchByKey', 'sameAsSource', 'sourceFromPrevious'].filter((k) => k in posted.at(-1)), []);
  const wsel = doc.querySelector('#workspaceSelect');
  wsel.value = 'wks-gamma-00000003';
  wsel.dispatchEvent(new window.Event('change', { bubbles: true }));
  await tick();
  assert.equal(doc.querySelector('#run-form').dataset.workMode, undefined, 'a Git member keeps the Branches block');
});

test('a workspace start refused 413 (a Folder member over the copy limits) shows the error under the workspace select, not the hidden project select', async () => {
  const TOO_BIG = { error: 'notes is 6.5 GB. The limit is 1 GB.', code: 'FOLDER_TOO_BIG', files: 812, bytes: 6549825126 };
  const window = await boot({ answer: { status: 413, body: TOO_BIG } });
  const doc = window.document;
  await pickWorkspace(window, 'wks-folders-00000004');
  doc.querySelector('#prompt').value = 'tidy both';
  doc.querySelector('#run-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
  assert.equal(doc.querySelector('#target-project-pane').classList.contains('hidden'), true, 'workspace mode hides the project pane');
  assert.equal(doc.querySelector('#target-workspace-pane .field-error .fe-text')?.textContent, TOO_BIG.error);
  assert.equal(doc.querySelector('#workspaceSelect').getAttribute('aria-invalid'), 'true');
  assert.equal(doc.querySelector('#target-project-pane .field-error'), null);
  assert.equal(doc.querySelector('#projectSelect').getAttribute('aria-invalid'), null);
});

test('the feature-branch hint of a mixed workspace names a branch for its Git member only', async () => {
  const window = await boot({ branches: ['main'] });
  const doc = window.document;
  await pickWorkspace(window, 'wks-gamma-00000003');
  const f = doc.querySelector('#featureBranch');
  const hint = () => doc.querySelector('#featureBranchHint').textContent;
  assert.equal(hint(), 'Leave empty and Worca will propose one.');
  f.value = 'feat/x';
  f.dispatchEvent(new window.Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(hint(), 'Creates feat/x-api.');
});
