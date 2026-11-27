// test/ui-workspace-readiness-buttons.test.mjs — the workspace page's "Evaluate with AI" / "Set up with AI" header buttons
// and the one notice after a scan when a member is not agent-ready. One shared boot of the real app (shared-app-boot);
// each test answers the API for its own workspace and member keys, so nothing the app cached from an earlier test applies.
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { useSharedApp } from './helpers/shared-app-boot.mjs';
import { lastToast } from './helpers/feedback.mjs';

// The popovers open after two animation frames: frames run on a timer here, as in the browser's next paint.
const app = useSharedApp({ before, beforeEach, after }, {
  setup: (window) => {
    window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
    globalThis.requestAnimationFrame = window.requestAnimationFrame;
  },
});
const sum = (level, n = 0) => ({ level, failingCount: n, mustFix: n, shouldFix: 0, passed: 3, applicable: 5 });
const AVAILABLE = { available: { check: true, setup: true }, lastCheck: null, lastSetup: null, live: null };
const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });

// One workspace with two members, all under ids of this test's own.
async function boot({ run = AVAILABLE, l2 = 'partial', posts = [] } = {}) {
  const ID = `wks-${app.uid('w')}-00000001`;
  const k1 = app.uid('k'), k2 = app.uid('k');
  const WS = [{ id: ID, name: 'Alpha WS', description: '', projectPaths: [`/a/${k1}`, `/a/${k2}`], projectKeys: [k1, k2], exists: [true, true], createdAt: 'x', updatedAt: 'x' }];
  const projects = () => [{ name: 'svc-iam', path: `/a/${k1}`, exists: true, key: k1, readiness: sum('ready') }, { name: 'svc-ui', path: `/a/${k2}`, exists: true, key: k2, readiness: sum(l2, l2 === 'ready' ? 0 : 1) }];
  const state = { run, l2, posts, ID };
  await app.fresh({ fetchHandler: (u, opts = {}) => {
    if (u.includes(`/api/workspaces/${ID}/readiness-run`)) { state.posts.push(JSON.parse(opts.body)); return ok({ runId: 'run-ws-1' }); }
    if (u.includes(`/api/workspaces/${ID}/readiness`)) return ok(state.run);
    if (/\/api\/projects\/[^/]+\/readiness/.test(u)) return ok({ readiness: { level: state.l2, counts: { mustFix: 0, shouldFix: 0, passed: 3, applicable: 5 }, engines: {}, checks: [] } });
    if (u.includes('/api/projects')) return ok({ projects: projects() });
    if (u.endsWith('/api/workspaces') || u.includes('/api/workspaces?')) return ok({ workspaces: structuredClone(WS) });
    return ok({ config: { steps: {}, customModels: [] }, models: [], efforts: [] });
  } });
  // The workspace list is loaded once at boot: a changed frame makes the app read this test's list.
  app.recv({ type: 'workspaces-changed', action: 'created' });
  app.recv({ type: 'projects-changed', action: 'added' });
  await app.settle(6);
  return { window: app.window, state, ws: () => ({ deliver: (obj) => app.recv(obj) }), ID };
}
const until = async (fn) => { for (let i = 0; i < 400 && !fn(); i++) await new Promise((r) => setTimeout(r, 15)); };
const open = async (window, ID) => { window.location.hash = `workspaces/${ID}`; await until(() => window.document.querySelector('#ws-detail .ws-eval') && window.document.querySelector('#ws-detail')?.textContent.includes('Alpha WS')); };
const click = (window, n) => n.dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 1 }));

test('the header has Evaluate with AI and Set up with AI once the server offers them; they hide without the plugin', async () => {
  const { window, ID } = await boot();
  await open(window, ID);
  const doc = window.document;
  const ev = doc.querySelector('#ws-detail .ws-eval'); const su = doc.querySelector('#ws-detail .ws-setup-ai');
  assert.equal(su.className, 'ws-setup-ai btn', 'a plain button, as in the readiness popover');
  await until(() => !ev.hidden);
  assert.match(ev.textContent, /Evaluate with AI/); assert.match(su.textContent, /Set up with AI/);
  assert.equal(ev.hidden, false); assert.equal(su.hidden, false);
  assert.ok(ev.closest('.pd-actions'), 'in the header actions');
});

test('without the workflow both buttons stay hidden', async () => {
  const { window, ID } = await boot({ run: { available: { check: false, setup: false }, lastCheck: null, lastSetup: null, live: null } });
  await open(window, ID);
  await new Promise((r) => setTimeout(r, 150));
  const doc = window.document;
  assert.equal(doc.querySelector('#ws-detail .ws-eval').hidden, true);
  assert.equal(doc.querySelector('#ws-detail .ws-setup-ai').hidden, true);
});

test('a live run hides both; a click posts its kind and opens the run', async () => {
  const live = await boot({ run: { ...AVAILABLE, live: { runId: 'r1', pipelineId: 'p1', status: 'running', title: 'AI readiness check', workflowId: 'wfp_ai-readiness_check' } } });
  await open(live.window, live.ID);
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(live.window.document.querySelector('#ws-detail .ws-eval').hidden, true, 'hidden while a run is live');
  const { window, state, ID } = await boot();
  await open(window, ID);
  const su = window.document.querySelector('#ws-detail .ws-setup-ai');
  await until(() => !su.hidden);
  click(window, su);
  await until(() => state.posts.length);
  assert.deepEqual(state.posts, [{ kind: 'setup' }]);
  await until(() => /running/.test(window.location.hash));
  assert.match(window.location.hash, /run-ws-1/);
});

test('a finished scan with a not-ready member shows one Evaluate with AI notice per workspace; its action posts check', async () => {
  const { window, state, ws, ID } = await boot();
  await open(window, ID);
  const doc = window.document;
  await until(() => doc.querySelectorAll('#ws-detail .wd-member-rd .pl-rd').length === 2);
  ws().deliver({ type: 'workspaces-changed', action: 'scan-updated', workspaceId: ID });
  await until(() => lastToast(doc)?.action === 'Evaluate with AI');
  assert.equal(lastToast(doc).action, 'Evaluate with AI');
  const count = () => doc.querySelectorAll('#toasts > .toast').length;
  const n = count();
  ws().deliver({ type: 'workspaces-changed', action: 'scan-updated', workspaceId: ID });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(count(), n, 'once per workspace');
  click(window, doc.querySelector('#toasts > .toast .toast-act'));
  await until(() => state.posts.length);
  assert.deepEqual(state.posts, [{ kind: 'check' }]);
});

test('no notice when every member is ready', async () => {
  const { window, ws, ID } = await boot({ l2: 'ready' });
  await open(window, ID);
  const doc = window.document;
  await until(() => doc.querySelectorAll('#ws-detail .wd-member-rd .pl-rd').length === 2);
  ws().deliver({ type: 'workspaces-changed', action: 'scan-created', workspaceId: ID });
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(doc.querySelectorAll('#toasts > .toast').length, 0);
});

test('a scan frame for another workspace shows no notice and does not spend the seen flag', async () => {
  const { window, ws, ID } = await boot();
  await open(window, ID);
  const doc = window.document;
  await until(() => doc.querySelectorAll('#ws-detail .wd-member-rd .pl-rd').length === 2);
  ws().deliver({ type: 'workspaces-changed', action: 'scan-updated', workspaceId: 'wks-other-99999999' });
  ws().deliver({ type: 'workspaces-changed', action: 'scan-updated' });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(doc.querySelectorAll('#toasts > .toast').length, 0);
  assert.equal(window.localStorage.getItem(`readiness-ws-notice-seen:${ID}`), null);
  ws().deliver({ type: 'workspaces-changed', action: 'scan-updated', workspaceId: ID });
  await until(() => lastToast(doc)?.action === 'Evaluate with AI');
  assert.equal(lastToast(doc).action, 'Evaluate with AI', 'its own scan still nudges');
});

test('Set up with AI hides while every member is agent-ready (the aggregate is ready); Evaluate with AI stays', async () => {
  const { window, ID } = await boot({ l2: 'ready' });
  await open(window, ID);
  const doc = window.document;
  const ev = doc.querySelector('#ws-detail .ws-eval'); const su = doc.querySelector('#ws-detail .ws-setup-ai');
  await until(() => doc.querySelectorAll('#ws-detail .wd-member-rd .pl-rd').length === 2 && !ev.hidden);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(ev.hidden, false, 'Evaluate with AI is still offered');
  assert.equal(su.hidden, true, 'nothing to set up');
});
