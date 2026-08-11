// test/ui-agents-view.test.mjs — jsdom tests for the Agents management view.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const cssPath = fileURLToPath(new URL('../ui/public/style.css', import.meta.url));

// Meta v2: the card head reads typed PORTS, not the dead channel vocabulary.
const AGENTS = [
  {
    key: 'planner', displayName: 'Plan', description: 'architecture', color: 'violet',
    runnerType: 'producer', order: 1, origin: 'builtin', metaVersion: 2,
    inputs: [{ id: 'task', type: 'md', required: true, as: 'file' }],
    outputs: [{ id: 'plan', type: 'md', when: 'always', filename: '{base}.md', store: 'project' }],
  },
  {
    key: 'docsWriter', displayName: 'Docs Writer', description: 'writes docs', color: 'green',
    runnerType: 'producer', order: 42, origin: 'user', metaVersion: 2,
    inputs: [{ id: 'plan', type: 'md', required: true, as: 'file' }],
    outputs: [{ id: 'review', type: 'md', when: 'always', filename: 'docs.md', store: 'run' }],
  },
];
const MOCK_ROLES = ['generic-producer', 'generic-verifier'];

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
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  window.fetch = (url, opts) => {
    const u = String(url);
    if (fetchHandler) { const r = fetchHandler(u, opts || {}); if (r) return r; }
    if (u.includes('/api/agents')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ agents: AGENTS, channels: [], mockWriterRoles: MOCK_ROLES }) });
    if (u.includes('/api/projects')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [] }) });
    if (u.includes('/api/workspaces')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ workspaces: [] }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'requestAnimationFrame']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  if (WSStub.last) WSStub.last._open();
  return { window, ws: () => WSStub.last }; // ws accessor: Task 7's wizard tests destructure it
}
const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true }));
const goAgents = async (window) => {
  window.location.hash = 'agents';
  window.dispatchEvent(new window.Event('hashchange'));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
};

test('agents view renders grouped cards with origin badges + port chips', async () => {
  const { window } = await boot();
  await goAgents(window);
  const doc = window.document;
  assert.equal(doc.querySelector('.view[data-view="agents"]').classList.contains('hidden'), false);
  const cards = [...doc.querySelectorAll('#agents-list .agent-card')];
  assert.equal(cards.length, 2);
  const user = cards.find((c) => c.dataset.agentKey === 'docsWriter');
  assert.equal(user.querySelector('.agent-origin').textContent, 'user');
  assert.ok([...user.querySelectorAll('.agent-chip.prod')].some((n) => n.textContent === 'review md'));
  assert.ok([...user.querySelectorAll('.agent-chip.cons')].some((n) => n.textContent === 'plan md'));
  const builtin = cards.find((c) => c.dataset.agentKey === 'planner');
  assert.equal(builtin.querySelector('.agent-delete').hidden, true, 'no delete for builtin');
  assert.equal(builtin.querySelector('.agent-edit').hidden, true, 'no edit for builtin');
  assert.equal(builtin.querySelector('.agent-duplicate').hidden, false);
  assert.equal(user.querySelector('.agent-duplicate').hidden, true);
  const labels = [...doc.querySelectorAll('#agents-list .agents-group-label')].map((n) => n.textContent);
  assert.deepEqual(labels, ['Built-in agents', 'Your agents']);
});

test('Delete issues DELETE /api/agents/:key; a 409 keeps the card + surfaces the error', async () => {
  let mode = 409;
  const calls = [];
  const { window } = await boot({
    fetchHandler: (u, opts) => {
      if (u.endsWith('/api/agents/docsWriter') && opts.method === 'DELETE') {
        calls.push(u);
        return mode === 409
          ? Promise.resolve({ ok: false, status: 409, json: async () => ({ error: 'used by saved workflow(s): Uses Docs' }) })
          : Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
      }
      return null;
    },
  });
  await goAgents(window);
  const doc = window.document;
  const card = doc.querySelector('.agent-card[data-agent-key="docsWriter"]');
  click(window, card.querySelector('.agent-delete'));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls.length, 1);
  assert.ok(doc.querySelector('.agent-card[data-agent-key="docsWriter"]'), '409 keeps the card');
  assert.match(doc.querySelector('#agents-msg').textContent, /Uses Docs/);
  mode = 200;
  click(window, doc.querySelector('.agent-card[data-agent-key="docsWriter"] .agent-delete'));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(doc.querySelector('.agent-card[data-agent-key="docsWriter"]'), null, '200 removes the card');
});

test('Duplicate on a builtin GETs the full agent then POSTs a copy with a fresh name', async () => {
  const posts = [];
  const { window } = await boot({
    fetchHandler: (u, opts) => {
      if (u.endsWith('/api/agents/planner') && (!opts.method || opts.method === 'GET')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ meta: AGENTS[0], markdown: '# planner body' }) });
      }
      if (u.endsWith('/api/agents') && opts.method === 'POST') {
        posts.push(JSON.parse(opts.body));
        return Promise.resolve({ ok: true, status: 201, json: async () => ({ meta: { ...AGENTS[0], key: 'planCopy', origin: 'user' }, markdown: '# planner body' }) });
      }
      return null;
    },
  });
  await goAgents(window);
  const doc = window.document;
  click(window, doc.querySelector('.agent-card[data-agent-key="planner"] .agent-duplicate'));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(posts.length, 1);
  assert.equal(posts[0].meta.displayName, 'Plan (copy)');
  assert.equal(posts[0].meta.key, undefined, 'key derived server-side');
  assert.equal(posts[0].markdown, '# planner body');
});

test('agents view splits PORT pills into labeled Input and Output rows', async () => {
  const { window } = await boot();
  await goAgents(window);
  const planner = [...window.document.querySelectorAll('#agents-list .agent-card')]
    .find((c) => c.dataset.agentKey === 'planner');
  assert.ok(planner, 'planner card rendered');

  const inRow = planner.querySelector('.agent-io-in');
  const outRow = planner.querySelector('.agent-io-out');
  assert.ok(inRow && outRow, 'both Input and Output rows render in the header');
  assert.equal(inRow.querySelector('.agent-io-label').textContent, 'Input');
  assert.equal(outRow.querySelector('.agent-io-label').textContent, 'Output');

  // input pills under the Input row, output pills under the Output row
  assert.deepEqual([...inRow.querySelectorAll('.agent-chip')].map((n) => n.textContent), ['task md']);
  assert.deepEqual([...outRow.querySelectorAll('.agent-chip')].map((n) => n.textContent), ['plan md']);

  // no consume pill leaks into the Output row (and vice-versa)
  assert.equal(outRow.querySelector('.agent-chip.cons'), null, 'Output row has no consume pills');
  assert.equal(inRow.querySelector('.agent-chip.prod'), null, 'Input row has no produce pills');

  // rows live in the always-visible header, not the collapsible detail
  assert.ok(planner.querySelector('.agent-head .agent-io'), 'io block is inside .agent-head');
});

test('agents view shows a placeholder when a port side is empty', async () => {
  const agents = [{
    key: 'sink', displayName: 'Sink', description: 'consumes only', color: 'amber',
    runnerType: 'verifier', order: 1, origin: 'user', metaVersion: 2,
    inputs: [{ id: 'code', type: 'void', required: true }], outputs: [],
  }];
  const { window } = await boot({
    fetchHandler: (u) => u.includes('/api/agents')
      ? Promise.resolve({ ok: true, status: 200, json: async () => ({ agents, channels: [], mockWriterRoles: MOCK_ROLES }) })
      : null,
  });
  await goAgents(window);
  const card = window.document.querySelector('#agents-list .agent-card');
  const outRow = card.querySelector('.agent-io-out');
  assert.equal(outRow.querySelector('.agent-chip'), null, 'no output pills for a portless side');
  assert.equal(outRow.querySelector('.agent-io-none').textContent, '—', 'empty Output row shows muted placeholder');
  // input side still renders its pill
  assert.deepEqual(
    [...card.querySelectorAll('.agent-io-in .agent-chip')].map((n) => n.textContent), ['code void']);
});

test('agent detail body is spaced below the port pills', () => {
  // jsdom does not compute layout; assert the spacing RULE exists in the stylesheet.
  const css = readFileSync(cssPath, 'utf8');
  assert.match(css, /\.agent-detail\s*\{[^}]*margin-top\s*:/, '.agent-detail must define margin-top for pill→body spacing');
});
