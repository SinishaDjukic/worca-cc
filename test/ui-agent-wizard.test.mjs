// test/ui-agent-wizard.test.mjs — jsdom tests for the agent creation wizard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const AGENTS = [
  { key: 'planner', displayName: 'Plan', description: 'architecture', color: 'violet', runnerType: 'producer', consumes: ['userPrompt'], produces: ['plan'], order: 1, origin: 'builtin', connectsTo: '*' },
  { key: 'docsWriter', displayName: 'Docs Writer', description: 'writes docs', color: 'green', runnerType: 'producer', consumes: ['plan'], produces: ['review'], order: 42, origin: 'user', connectsTo: '*' },
];
const CHANNELS = ['userPrompt', 'plan', 'review', 'checklist', 'code', 'workspace', 'clarify', 'decomposition'];

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
  window.fetch = (url, opts) => {
    const u = String(url);
    if (fetchHandler) { const r = fetchHandler(u, opts || {}); if (r) return r; }
    if (u.includes('/api/agents')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ agents: AGENTS, channels: CHANNELS }) });
    if (u.includes('/api/projects')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [] }) });
    if (u.includes('/api/workspaces')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ workspaces: [] }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  if (WSStub.last) WSStub.last._open();
  return { window, ws: () => WSStub.last }; // ws accessor: Task 7's wizard tests destructure it
}
const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true }));

test('Step 1 gating: Generate disabled until name+purpose; own-markdown toggle swaps the requirement', async () => {
  const { window } = await boot();
  window.location.hash = 'agent-create';
  window.dispatchEvent(new window.Event('hashchange'));
  await new Promise((r) => setTimeout(r, 0));
  const doc = window.document;
  assert.equal(doc.querySelector('#agw-start').disabled, true);
  doc.querySelector('#agw-name').value = 'Docs Writer';
  doc.querySelector('#agw-name').dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(doc.querySelector('#agw-start').disabled, true, 'name alone is not enough');
  doc.querySelector('#agw-purpose').value = 'write docs';
  doc.querySelector('#agw-purpose').dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(doc.querySelector('#agw-start').disabled, false);
  // own-markdown mode: purpose no longer required, pasted body is
  click(window, doc.querySelector('#agw-own-md-toggle'));
  assert.equal(doc.querySelector('#agw-own-md-pane').classList.contains('hidden'), false);
  doc.querySelector('#agw-purpose').value = '';
  doc.querySelector('#agw-purpose').dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(doc.querySelector('#agw-start').disabled, true);
  doc.querySelector('#agw-own-md').value = '# my agent';
  doc.querySelector('#agw-own-md').dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(doc.querySelector('#agw-start').disabled, false);
});

test('Generate POSTs the wizard body, shows Step 2, subscribes by genId; agentgen-done lands on Step 3 with .value-bound fields', async () => {
  const posts = [];
  const { window, ws } = await boot({
    fetchHandler: (u, opts) => {
      if (u.endsWith('/api/agents/generate') && opts.method === 'POST') {
        posts.push(JSON.parse(opts.body));
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ genId: 'agen_1' }) });
      }
      return null;
    },
  });
  window.location.hash = 'agent-create';
  window.dispatchEvent(new window.Event('hashchange'));
  await new Promise((r) => setTimeout(r, 0));
  const doc = window.document;
  doc.querySelector('#agw-name').value = 'Docs Writer';
  doc.querySelector('#agw-name').dispatchEvent(new window.Event('input', { bubbles: true }));
  doc.querySelector('#agw-purpose').value = 'write docs';
  doc.querySelector('#agw-purpose').dispatchEvent(new window.Event('input', { bubbles: true }));
  click(window, doc.querySelector('#agw-start'));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(posts.length, 1);
  assert.equal(posts[0].name, 'Docs Writer');
  assert.equal(posts[0].purpose, 'write docs');
  assert.equal(posts[0].userMarkdown, undefined, 'mode A sends no markdown');
  assert.equal(doc.querySelector('#agw-step-2').classList.contains('hidden'), false);
  assert.ok(ws().sent.some((m) => m.type === 'subscribe' && m.genId === 'agen_1'));

  ws().deliver({ type: 'agentgen-progress', genId: 'agen_1', phase: 'draft', message: 'drafting metadata…' });
  assert.equal(doc.querySelector('#agw-status').textContent, 'drafting metadata…');

  const md = '# Docs Writer\n<img src=x onerror="boom()">\n';
  ws().deliver({
    type: 'agentgen-done', genId: 'agen_1',
    draft: { meta: { key: 'docsWriter', displayName: 'Docs Writer', description: 'writes docs', color: 'green', runnerType: 'producer', consumes: ['plan'], optionalConsumes: [], produces: ['review'], connectsTo: '*', order: 99, fanOut: false, loopSource: false }, markdown: md },
  });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(doc.querySelector('#agw-step-3').classList.contains('hidden'), false);
  const root = doc.querySelector('#agw-step-3');
  assert.equal(root.querySelector('.agent-f-name').value, 'Docs Writer');
  assert.equal(root.querySelector('.agent-f-md').value, md, 'markdown bound via .value (inert)');
});

test('Step 3 Save POSTs /api/agents; a 409 keeps the user on Step 3 with the error verbatim', async () => {
  const posts = [];
  let status = 409;
  const { window, ws } = await boot({
    fetchHandler: (u, opts) => {
      if (u.endsWith('/api/agents/generate') && opts.method === 'POST') return Promise.resolve({ ok: true, status: 200, json: async () => ({ genId: 'agen_2' }) });
      if (u.endsWith('/api/agents') && opts.method === 'POST') {
        posts.push(JSON.parse(opts.body));
        return status === 409
          ? Promise.resolve({ ok: false, status: 409, json: async () => ({ error: 'a user agent "docsWriter" already exists' }) })
          : Promise.resolve({ ok: true, status: 201, json: async () => ({ meta: { key: 'docsWriter', origin: 'user' }, markdown: '# x' }) });
      }
      return null;
    },
  });
  window.location.hash = 'agent-create';
  window.dispatchEvent(new window.Event('hashchange'));
  await new Promise((r) => setTimeout(r, 0));
  const doc = window.document;
  doc.querySelector('#agw-name').value = 'Docs Writer';
  doc.querySelector('#agw-name').dispatchEvent(new window.Event('input', { bubbles: true }));
  doc.querySelector('#agw-purpose').value = 'p';
  doc.querySelector('#agw-purpose').dispatchEvent(new window.Event('input', { bubbles: true }));
  click(window, doc.querySelector('#agw-start'));
  await new Promise((r) => setTimeout(r, 0));
  ws().deliver({ type: 'agentgen-done', genId: 'agen_2', draft: { meta: { key: 'docsWriter', displayName: 'Docs Writer', color: 'green', runnerType: 'producer', consumes: ['plan'], optionalConsumes: [], produces: ['review'], connectsTo: '*', order: 99 }, markdown: '# x' } });
  await new Promise((r) => setTimeout(r, 0));
  click(window, doc.querySelector('#agw-save'));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(posts.length, 1);
  assert.equal(posts[0].meta.displayName, 'Docs Writer');
  assert.equal(doc.querySelector('#agw-step-3').classList.contains('hidden'), false, 'still on step 3');
  assert.match(doc.querySelector('#agw-msg').textContent, /already exists/);
  status = 201;
  click(window, doc.querySelector('#agw-save'));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(window.location.hash, '#agents', 'navigated to agents on success');
});

test('agentgen-error returns to Step 1; leave-guard POSTs stop + unsubscribes a live gen', async () => {
  const stops = [];
  const { window, ws } = await boot({
    fetchHandler: (u, opts) => {
      if (u.endsWith('/api/agents/generate') && opts.method === 'POST') return Promise.resolve({ ok: true, status: 200, json: async () => ({ genId: 'agen_3' }) });
      if (u.endsWith('/api/agents/generate/stop') && opts.method === 'POST') { stops.push(JSON.parse(opts.body)); return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) }); }
      return null;
    },
  });
  window.location.hash = 'agent-create';
  window.dispatchEvent(new window.Event('hashchange'));
  await new Promise((r) => setTimeout(r, 0));
  const doc = window.document;
  doc.querySelector('#agw-name').value = 'X';
  doc.querySelector('#agw-name').dispatchEvent(new window.Event('input', { bubbles: true }));
  doc.querySelector('#agw-purpose').value = 'p';
  doc.querySelector('#agw-purpose').dispatchEvent(new window.Event('input', { bubbles: true }));
  click(window, doc.querySelector('#agw-start'));
  await new Promise((r) => setTimeout(r, 0));
  ws().deliver({ type: 'agentgen-error', genId: 'agen_3', message: 'builder exploded' });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(doc.querySelector('#agw-step-1').classList.contains('hidden'), false);
  assert.match(doc.querySelector('#agw-step1-hint').textContent, /builder exploded/);
  // restart then navigate away -> leave-guard stop
  click(window, doc.querySelector('#agw-start'));
  await new Promise((r) => setTimeout(r, 0));
  window.location.hash = 'new';
  window.dispatchEvent(new window.Event('hashchange'));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(stops.length, 1);
  assert.ok(ws().sent.some((m) => m.type === 'unsubscribe' && m.genId === 'agen_3'));
});
