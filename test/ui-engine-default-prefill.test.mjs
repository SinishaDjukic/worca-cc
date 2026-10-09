// test/ui-engine-default-prefill.test.mjs — New pipeline prefills the engine a run here would use and says where that
// came from (plans/cascading-settings-design.md §6, D7, §8 test 11); a Claude pick over a Codex default is sent.
// Boot copied from test/ui-engine-picker.test.mjs.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';

const trackDom = useDomRelease(afterEach);
const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECTS = [{ name: 'web', path: '/a/web', exists: true }, { name: 'api', path: '/a/api', exists: true }];
const ok = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

async function boot({ defaults }) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  let lastWs = null;
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._l = {}; lastWs = this; }
    send() {} close() {}
    addEventListener(t, fn) { (this._l[t] ||= []).push(fn); }
  };
  const posted = [];
  const calls = [];
  window.fetch = (url, opts = {}) => {
    const u = String(url);
    const method = opts.method || 'GET';
    calls.push(u);
    if (u.includes('/api/run-defaults')) {
      const dir = new URL(u, 'http://x').searchParams.get('projectDir') || '';
      return Promise.resolve(ok(defaults(dir)));
    }
    if (u.includes('/api/projects')) return Promise.resolve(ok({ projects: PROJECTS }));
    if (u.includes('/api/workspaces')) return Promise.resolve(ok({ workspaces: [] }));
    if (u.includes('/api/branches')) return Promise.resolve(ok({ branches: ['dev'], current: 'dev' }));
    if (u.endsWith('/api/run') && method === 'POST') { posted.push(JSON.parse(opts.body)); return Promise.resolve(ok({ runId: `r${posted.length}` })); }
    return Promise.resolve(ok({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }));
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* read-only */ }
  }
  globalThis.window = window; globalThis.document = window.document;
  window.localStorage.clear();
  window.localStorage.setItem('worca-cc.runTarget', 'project');
  window.localStorage.setItem('worca-cc.lastProject', 'web');
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await tick();
  lastWs._l.open?.forEach((fn) => fn());
  for (let i = 0; i < 8; i++) await tick();
  return { window, doc: window.document, posted, calls };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
async function submit(ctx) {
  ctx.doc.querySelector('#prompt').value = 'do work';
  const n = ctx.posted.length;
  ctx.doc.querySelector('#run-form').dispatchEvent(new ctx.window.Event('submit', { bubbles: true, cancelable: true }));
  for (let i = 0; i < 40 && ctx.posted.length === n; i++) await tick();
}
const on = (doc) => doc.getElementById('engineSelect').value;

test('a project default of Codex prefills Codex and says it comes from the project', async () => {
  const ctx = await boot({ defaults: (dir) => ({ engine: dir === '/a/web' ? { value: 'codex', source: 'project' } : { value: 'claude', source: 'default' }, steps: { claude: {}, codex: {} } }) });
  assert.equal(on(ctx.doc), 'codex');
  assert.equal(ctx.doc.getElementById('engine-default-hint').hidden, false);
  assert.equal(ctx.doc.getElementById('engine-default-hint').textContent, 'Default from project');
  assert.equal(ctx.doc.getElementById('engine-hint').textContent, 'Codex runs this pipeline, including titles and summaries. Its models: Models › Codex');
  await submit(ctx);
  assert.equal(ctx.posted.at(-1).engine, 'codex');
});

test('a user default of Copilot prefills Copilot and sends it', async () => {
  const ctx = await boot({ defaults: () => ({ engine: { value: 'copilot', source: 'user' }, steps: { claude: {}, codex: {} } }) });
  assert.equal(on(ctx.doc), 'copilot');
  assert.equal(ctx.doc.getElementById('engine-default-hint').textContent, 'Default from your settings');
  await submit(ctx);
  assert.equal(ctx.posted.at(-1).engine, 'copilot');
});

test('switching back to Claude over a Codex default sends engine: claude (Review Focus 1)', async () => {
  const ctx = await boot({ defaults: () => ({ engine: { value: 'codex', source: 'user' }, steps: { claude: {}, codex: { planner: { model: 'gpt-5.5', source: 'project' } } } }) });
  assert.equal(ctx.doc.getElementById('engine-default-hint').textContent, 'Default from your settings');
  assert.match(ctx.doc.getElementById('engine-hint').textContent, /Its models: project Settings$/);
  { const s = ctx.doc.getElementById('engineSelect'); s.value = 'claude'; s.dispatchEvent(new ctx.window.Event('change', { bubbles: true })); }
  for (let i = 0; i < 4; i++) await tick();
  assert.equal(ctx.doc.getElementById('engine-default-hint').hidden, true, 'not the default any more');
  await submit(ctx);
  assert.equal(ctx.posted.at(-1).engine, 'claude');
});

test('a Claude default sends nothing, as before; an unreadable answer leaves Claude', async () => {
  const ctx = await boot({ defaults: () => ({ engine: { value: 'claude', source: 'default' }, steps: { claude: {}, codex: {} } }) });
  assert.equal(on(ctx.doc), 'claude');
  assert.equal(ctx.doc.getElementById('engine-default-hint').hidden, true);
  await submit(ctx);
  assert.equal('engine' in ctx.posted.at(-1), false);
  const bad = await boot({ defaults: () => ({ nope: true }) });
  assert.equal(on(bad.doc), 'claude');
});

test('an unreadable default sends engine: claude, so the run starts on the engine shown (review I4)', async () => {
  const ctx = await boot({ defaults: () => ({ nope: true }) });
  assert.equal(on(ctx.doc), 'claude');
  await submit(ctx);
  assert.equal(ctx.posted.at(-1).engine, 'claude', 'the server must not resolve a Codex default the user never saw');
});

test('switching to a Workspace target takes the user default, not the project\'s (review I3)', async () => {
  const ctx = await boot({ defaults: (dir) => ({ engine: dir ? { value: 'codex', source: 'project' } : { value: 'claude', source: 'default' }, steps: { claude: {}, codex: {} } }) });
  assert.equal(on(ctx.doc), 'codex', 'the project default first');
  ctx.doc.querySelector('button[data-target="workspace"]').click();
  for (let i = 0; i < 8; i++) await tick();
  assert.equal(on(ctx.doc), 'claude', 'a workspace run has no project layer');
  assert.ok(ctx.calls.some((u) => u.endsWith('/api/run-defaults')), 'the user scope was asked');
  ctx.doc.querySelector('button[data-target="project"]').click();
  for (let i = 0; i < 8; i++) await tick();
  assert.equal(on(ctx.doc), 'codex', 'back on the project, its default again');
});
