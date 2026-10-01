// New pipeline with a predecessor (run chains): #new/after/<id> preselects the target and the pick,
// "Branch of the run before it" leads the Source branch select, the submit carries after +
// sourceFromPrevious, run branches are grouped in the picker, and workspace mode uses the switch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECTS = [{ name: 'svc-iam', path: '/a/svc-iam', exists: true }, { name: 'svc-ui', path: '/a/svc-ui', exists: true }, { name: 'svc-empty', path: '/a/svc-empty', exists: true }];
const WORKSPACES = [
  { id: 'ws_1', name: 'Alpha WS', description: '# x', projectPaths: ['/a/svc-iam', '/a/svc-ui'],
    projectKeys: ['svc-iam-aaaa1111', 'svc-ui-bbbb2222'], exists: [true, true], createdAt: 'x', updatedAt: 'x' },
  // No members: renderWorkspaceSourceBranches takes its early return and the single select stays as a disabled stand-in.
  { id: 'ws_2', name: 'Empty WS', description: '', projectPaths: [], projectKeys: [], exists: [], createdAt: 'x', updatedAt: 'x' },
];
const BRANCHES = {
  '/a/svc-iam': { branches: ['main', 'worca/refactor-p1'], current: 'main', runs: [{ branch: 'worca/refactor-p1', pipelineId: 'p1', title: 'Refactor', status: 'running', endedAt: null }] },
  // A second project WITH branches: switching to it takes populateBranchSelect's full rebuild, whose
  // tail is the one place the option is re-applied after the list is rebuilt.
  '/a/svc-ui': { branches: ['dev'], current: 'dev', runs: [] },
  // …and one WITHOUT: that switch takes the `!branches.length` early return, which has its own copy.
  '/a/svc-empty': { branches: [], current: '', runs: [] },
};
const tick = (n = 1) => new Promise((r) => setTimeout(r, n));
// boot()'s fixed 60 ms budget can expire before the deliberately SLOW (25 ms) branch fetch lands,
// which flakes under parallel test load. Wait for the rebuilt list instead of a fixed delay.
async function branchesReady(doc) {
  for (let i = 0; i < 200 && !doc.getElementById('sourceBranch').dataset.current; i++) await tick(5);
}

async function boot(hash, { withSync = false } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: `http://localhost:4317/${hash}` });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
  const runBodies = []; const calls = [];
  const json = (data, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => data });
  // The branch fetch resolves LATE on purpose: the previous-run option must be re-applied
  // after populateBranchSelect rebuilds the list, not only before it.
  const slow = (data) => new Promise((r) => setTimeout(() => r({ ok: true, status: 200, json: async () => data }), 25));
  window.fetch = (url, opts) => {
    const u = String(url); calls.push(u);
    // SLOW on purpose (like /api/branches): GET /api/schedules/after/:id is a sync DB read on the server and
    // answers before the async registry read — openAfterForNew must wait for the project list, not judge [].
    if (u.includes('/api/projects')) return slow({ projects: PROJECTS });
    if (u.includes('/api/workspaces')) return json({ workspaces: WORKSPACES });
    if (u.includes('/api/schedules/after/p1')) return json({ kind: 'pipeline', id: 'p1', title: 'Refactor', status: 'running', projectDir: '/a/svc-iam', workspaceId: null });
    if (u.includes('/api/schedules/after/e1')) return json({ kind: 'pipeline', id: 'e1', title: 'Broken', status: 'error', projectDir: '/a/svc-iam', workspaceId: null });
    if (u.includes('/api/schedules/after/w2')) return json({ kind: 'pipeline', id: 'w2', title: 'Empty run', status: 'done', projectDir: null, workspaceId: 'ws_2' });
    if (u.includes('/api/schedules/after/w1')) return json({ kind: 'pipeline', id: 'w1', title: 'Ws run', status: 'done', projectDir: null, workspaceId: 'ws_1' });
    // A ticket predecessor always answers with ITS projectDir, registered or not — the form must say so.
    if (u.includes('/api/schedules/after/t9')) return json({ kind: 'ticket', id: 't9', title: 'Elsewhere', status: 'scheduled', projectDir: '/a/not-registered', workspaceId: null });
    if (u.includes('/api/schedules/after/t8')) return json({ kind: 'ticket', id: 't8', title: 'Gone', status: 'canceled', projectDir: '/a/svc-iam', workspaceId: null });
    if (u.includes('/api/schedules/after-candidates')) return json({ runs: [{ pipelineId: 'p1', runId: 'r1', title: 'Refactor', status: 'running' }], tickets: [] });
    if (u.includes('/api/branches')) {
      const q = new URL(u, 'http://x').searchParams;
      const dir = decodeURIComponent(q.get('projectDir') || '');
      const b = BRANCHES[dir] || { branches: [], current: '', runs: [] };
      // withSync: the fresh list names a remote and HEAD's SyncBlock, as GET /api/branches?fresh=1 does.
      if (withSync && q.get('fresh') === '1' && b.current) {
        return slow({ ...b, remote: { name: 'origin', branches: b.branches }, sync: { base: b.current, remote: 'origin', state: 'behind', behind: 2, ahead: 0, stale: false, settings: { beforeRun: true, onDiverged: 'ask' } } });
      }
      return slow(b);
    }
    if (u.endsWith('/api/run') && opts && opts.method === 'POST') { const body = JSON.parse(opts.body); runBodies.push(body); return json({ runId: 'r-2', status: 'scheduled', scheduledFor: null, after: body.after }, 202); }
    if (u.includes('/api/schedules')) return json({ schedules: [], tickets: [], counts: { scheduled: 0, missed: 0, recurring: 0, unread: 0 }, defaults: { graceMin: 360, ifMissed: 'run', maxFailures: 3 } });
    return json({ config: { steps: {}, customModels: [] }, models: [], efforts: [] });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await tick(60);
  return { window, runBodies, calls };
}

async function projectForm() {
  const ctx = await boot('#new');
  const doc = ctx.window.document;
  const projects = doc.getElementById('projectSelect');
  projects.value = '/a/svc-iam';
  projects.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  await tick(60);
  await branchesReady(doc);
  doc.getElementById('sourceBranch').value = 'main';
  doc.getElementById('sourceBranch').dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  doc.getElementById('prompt').value = 'Do it';
  return { ...ctx, doc };
}
/** Type a whole name and commit it, as a blur or Enter does: `input`, then `change`. */
const type = (ctx, el, v) => {
  el.value = v;
  el.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
  el.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
};

test('typing the source branch as the feature name switches "Run on the source branch" on', async () => {
  const ctx = await projectForm();
  const feature = ctx.doc.getElementById('featureBranch');
  const toggle = ctx.doc.getElementById('sameAsSource');
  assert.equal(toggle.checked, false);
  type(ctx, feature, 'main');
  assert.equal(toggle.checked, true);
  assert.equal(feature.disabled, true);
  assert.equal(feature.value, 'main', 'the disabled input names the branch the run commits onto');
  ctx.doc.getElementById('start-btn').click();
  await tick(3);
  assert.equal(ctx.runBodies[0].sameAsSource, true);
  assert.equal('featureBranch' in ctx.runBodies[0], false);
});

test('toggle off: the input is enabled again and cleared of the colliding name; the body has no flag', async () => {
  const ctx = await projectForm();
  const feature = ctx.doc.getElementById('featureBranch');
  const toggle = ctx.doc.getElementById('sameAsSource');
  type(ctx, feature, 'main');
  toggle.checked = false;
  toggle.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  assert.equal(feature.disabled, false);
  assert.equal(feature.value, '');
  type(ctx, feature, 'feat/x');
  ctx.doc.getElementById('start-btn').click();
  await tick(3);
  assert.equal('sameAsSource' in ctx.runBodies[0], false, 'default bodies are byte-identical');
  assert.equal(ctx.runBodies[0].featureBranch, 'feat/x');
});

test('toggle-off path unchanged: a name that only STARTS with the source stays typeable, keystroke by keystroke', async () => {
  const ctx = await projectForm();
  const feature = ctx.doc.getElementById('featureBranch');
  for (const v of ['m', 'ma', 'mai', 'main', 'main-', 'main-v2']) {   // passes through "main" on the way
    feature.value = v;
    feature.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
  }
  feature.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  assert.equal(ctx.doc.getElementById('sameAsSource').checked, false);
  assert.equal(feature.disabled, false);
  ctx.doc.getElementById('start-btn').click();
  await tick(3);
  assert.equal(ctx.runBodies[0].featureBranch, 'main-v2');
  assert.equal('sameAsSource' in ctx.runBodies[0], false);
});

test('Start right after typing the source name (no change event yet, e.g. Enter) still runs on the source branch', async () => {
  const ctx = await projectForm();
  const feature = ctx.doc.getElementById('featureBranch');
  feature.value = 'main';
  feature.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
  assert.equal(ctx.doc.getElementById('sameAsSource').checked, false, 'nothing switches per keystroke');
  ctx.doc.getElementById('start-btn').click();   // jsdom's click() fires no blur/change: the submit-time check does it
  await tick(3);
  assert.equal(ctx.runBodies[0].sameAsSource, true);
  assert.equal('featureBranch' in ctx.runBodies[0], false);
});
