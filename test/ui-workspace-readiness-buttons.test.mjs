// test/ui-workspace-readiness-buttons.test.mjs — the workspace page's "Evaluate with AI" / "Set up with AI" header buttons
// and the one notice after a scan when a member is not agent-ready. jsdom boot of the real app against a stubbed API.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { lastToast } from './helpers/feedback.mjs';
import { readIndexHtml } from '../src/core/read-index-html.mjs';

const trackDom = useDomRelease(afterEach);
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const ID = 'wks-alpha-00000001';
const WS = [{ id: ID, name: 'Alpha WS', description: '', projectPaths: ['/a/svc-iam', '/a/svc-ui'], projectKeys: ['k1', 'k2'], exists: [true, true], createdAt: 'x', updatedAt: 'x' }];
const sum = (level, n = 0) => ({ level, failingCount: n, mustFix: n, shouldFix: 0, passed: 3, applicable: 5 });
const projects = (l2) => [{ name: 'svc-iam', path: '/a/svc-iam', exists: true, key: 'k1', readiness: sum('ready') }, { name: 'svc-ui', path: '/a/svc-ui', exists: true, key: 'k2', readiness: sum(l2, l2 === 'ready' ? 0 : 1) }];
const AVAILABLE = { available: { check: true, setup: true }, lastCheck: null, lastSetup: null, live: null };

class WSStub {
  constructor() { this.readyState = 1; this._listeners = {}; WSStub.last = this; }
  send() {} close() {}
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  deliver(obj) { (this._listeners.message || []).forEach((fn) => fn({ data: JSON.stringify(obj) })); }
}
const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });

async function boot({ run = AVAILABLE, l2 = 'partial', posts = [] } = {}) {
  const dom = trackDom(new JSDOM(readIndexHtml(), { url: 'http://localhost:4317/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = WSStub;
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  const state = { run, l2, posts };
  window.fetch = (url, opts = {}) => {
    const u = String(url);
    if (u.includes(`/api/workspaces/${ID}/readiness-run`)) { state.posts.push(JSON.parse(opts.body)); return ok({ runId: 'run-ws-1' }); }
    if (u.includes(`/api/workspaces/${ID}/readiness`)) return ok(state.run);
    if (/\/api\/projects\/[^/]+\/readiness/.test(u)) return ok({ readiness: { level: state.l2, counts: { mustFix: 0, shouldFix: 0, passed: 3, applicable: 5 }, engines: {}, checks: [] } });
    if (u.includes('/api/projects')) return ok({ projects: projects(state.l2) });
    if (u.endsWith('/api/workspaces') || u.includes('/api/workspaces?')) return ok({ workspaces: structuredClone(WS) });
    return ok({ config: { steps: {}, customModels: [] }, models: [], efforts: [] });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'requestAnimationFrame']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  return { window, state, ws: () => WSStub.last };
}
const until = async (fn) => { for (let i = 0; i < 400 && !fn(); i++) await new Promise((r) => setTimeout(r, 15)); };
const open = async (window) => { window.location.hash = `workspaces/${ID}`; await until(() => window.document.querySelector('#ws-detail .ws-eval')); };
const click = (window, n) => n.dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 1 }));

test('the header has Evaluate with AI and Set up with AI once the server offers them; they hide without the plugin', async () => {
  const { window } = await boot();
  await open(window);
  const doc = window.document;
  const ev = doc.querySelector('#ws-detail .ws-eval'); const su = doc.querySelector('#ws-detail .ws-setup-ai');
  await until(() => !ev.hidden);
  assert.match(ev.textContent, /Evaluate with AI/); assert.match(su.textContent, /Set up with AI/);
  assert.equal(ev.hidden, false); assert.equal(su.hidden, false);
  assert.ok(ev.closest('.pd-actions'), 'in the header actions');
});

test('without the workflow both buttons stay hidden', async () => {
  const { window } = await boot({ run: { available: { check: false, setup: false }, lastCheck: null, lastSetup: null, live: null } });
  await open(window);
  await new Promise((r) => setTimeout(r, 150));
  const doc = window.document;
  assert.equal(doc.querySelector('#ws-detail .ws-eval').hidden, true);
  assert.equal(doc.querySelector('#ws-detail .ws-setup-ai').hidden, true);
});

test('a live run hides both; a click posts its kind and opens the run', async () => {
  const live = await boot({ run: { ...AVAILABLE, live: { runId: 'r1', pipelineId: 'p1', status: 'running', title: 'AI readiness check', workflowId: 'wfp_ai-readiness_check' } } });
  await open(live.window);
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(live.window.document.querySelector('#ws-detail .ws-eval').hidden, true, 'hidden while a run is live');
  const { window, state } = await boot();
  await open(window);
  const su = window.document.querySelector('#ws-detail .ws-setup-ai');
  await until(() => !su.hidden);
  click(window, su);
  await until(() => state.posts.length);
  assert.deepEqual(state.posts, [{ kind: 'setup' }]);
  await until(() => /running/.test(window.location.hash));
  assert.match(window.location.hash, /run-ws-1/);
});

test('a finished scan with a not-ready member shows one Evaluate with AI notice per workspace; its action posts check', async () => {
  const { window, state, ws } = await boot();
  await open(window);
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
  const { window, ws } = await boot({ l2: 'ready' });
  await open(window);
  const doc = window.document;
  await until(() => doc.querySelectorAll('#ws-detail .wd-member-rd .pl-rd').length === 2);
  ws().deliver({ type: 'workspaces-changed', action: 'scan-created', workspaceId: ID });
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(doc.querySelectorAll('#toasts > .toast').length, 0);
});

test('a scan frame for another workspace shows no notice and does not spend the seen flag', async () => {
  const { window, ws } = await boot();
  await open(window);
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
  const { window } = await boot({ l2: 'ready' });
  await open(window);
  const doc = window.document;
  const ev = doc.querySelector('#ws-detail .ws-eval'); const su = doc.querySelector('#ws-detail .ws-setup-ai');
  await until(() => doc.querySelectorAll('#ws-detail .wd-member-rd .pl-rd').length === 2 && !ev.hidden);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(ev.hidden, false, 'Evaluate with AI is still offered');
  assert.equal(su.hidden, true, 'nothing to set up');
});
