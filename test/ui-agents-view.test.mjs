// test/ui-agents-view.test.mjs — jsdom tests for the Agents management view.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { confirmDialog } from './helpers/confirm-modal.mjs';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const cssPath = fileURLToPath(new URL('../ui/public/style.css', import.meta.url));

const AGENTS = [
  { key: 'planner', displayName: 'Plan', description: 'architecture', color: 'violet', runnerType: 'producer',
    metaVersion: 2, order: 1, origin: 'builtin', portSummary: 'Reads task; produces plan.',
    inputs: [{ id: 'task', type: 'md' }, { id: 'revise', type: 'md', loop: true, required: false }],
    outputs: [{ id: 'plan', type: 'md', filename: '{base}.md', store: 'project' }] },
  { key: 'docsWriter', displayName: 'Docs Writer', description: '', color: 'green', runnerType: 'verifier',
    metaVersion: 2, order: 42, origin: 'user', placeable: false, portSummary: 'Reads plan; produces review.',
    verdict: { filename: 'docs-review.json' },
    inputs: [{ id: 'plan', type: 'md' }],
    outputs: [{ id: 'review', type: 'md', when: 'blocking', filename: 'docs-review.md' },
              { id: 'pass', type: 'void', when: 'clean' }] },
];
const MOCK_ROLES = ['clarify', 'planner-plan', 'generic-producer', 'generic-verifier'];

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
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0); // composer paints via rAF (same stub as ui-composer.test.mjs)
  window.fetch = (url, opts) => {
    const u = String(url);
    if (fetchHandler) { const r = fetchHandler(u, opts || {}); if (r) return r; }
    if (u.includes('/api/agents')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ agents: AGENTS, mockWriterRoles: MOCK_ROLES }) });
    if (u.includes('/api/projects')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [] }) });
    if (u.includes('/api/workspaces')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ workspaces: [] }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'requestAnimationFrame']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
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

test('agents view renders grouped cards with origin badges + typed port pills', async () => {
  const { window } = await boot();
  await goAgents(window);
  const cards = window.document.querySelectorAll('.agent-card');
  assert.equal(cards.length, 2);
  const planner = cards[0];
  assert.equal(planner.querySelector('.agent-origin').textContent, 'builtin');
  assert.equal(planner.querySelector('.agent-sub').textContent, 'planner \u00b7 producer \u2014 architecture');
  const inPills = [...planner.querySelectorAll('.agent-chips-in .agent-chip')].map((p) => p.textContent);
  assert.deepEqual(inPills, ['task \u00b7 md', '\u21ba revise \u00b7 md']);
  assert.deepEqual([...planner.querySelectorAll('.agent-chips-out .agent-chip')].map((p) => p.textContent), ['plan \u00b7 md']);
  // The io block stays in the always-visible header, one labelled row per side.
  // (Rescued from the deleted channel-pill test — nothing else pins this.)
  assert.ok(planner.querySelector('.agent-head .agent-io'), 'io block is inside .agent-head');
  assert.equal(planner.querySelector('.agent-io-in .agent-io-label').textContent, 'Input');
  assert.equal(planner.querySelector('.agent-io-out .agent-io-label').textContent, 'Output');
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
  await confirmDialog(window);
  assert.equal(calls.length, 1);
  assert.ok(doc.querySelector('.agent-card[data-agent-key="docsWriter"]'), '409 keeps the card');
  assert.match(doc.querySelector('#agents-msg').textContent, /Uses Docs/);
  mode = 200;
  click(window, doc.querySelector('.agent-card[data-agent-key="docsWriter"] .agent-delete'));
  await confirmDialog(window);
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

test('a description-less agent falls back to its port summary, and void pills are marked', async () => {
  const { window } = await boot();
  await goAgents(window);
  const docs = window.document.querySelectorAll('.agent-card')[1];
  assert.equal(docs.querySelector('.agent-sub').textContent, 'docsWriter \u00b7 verifier \u2014 Reads plan; produces review.');
  const out = docs.querySelectorAll('.agent-chips-out .agent-chip');
  assert.equal(out[1].textContent, 'pass \u00b7 void');
  assert.ok(out[1].classList.contains('void'), 'a void port pill is visually distinct');
  assert.ok(!out[0].classList.contains('void'));
});

test('placeable:false raises the amber "not placeable" badge, and only there', async () => {
  const { window } = await boot();
  await goAgents(window);
  const [planner, docs] = window.document.querySelectorAll('.agent-card');
  assert.equal(planner.querySelector('.agent-not-placeable').hidden, true);
  const badge = docs.querySelector('.agent-not-placeable');
  assert.equal(badge.hidden, false);
  assert.equal(badge.textContent, 'not placeable');
});

test('an agent with no ports on a side keeps the \u2014 placeholder', async () => {
  const { window } = await boot({ fetchHandler: (u) => (u.includes('/api/agents')
    ? Promise.resolve({ ok: true, status: 200, json: async () => ({
      agents: [{ key: 'lonely', displayName: 'Lonely', runnerType: 'producer', metaVersion: 2, order: 5,
        origin: 'user', inputs: [], outputs: [], portSummary: '' }], mockWriterRoles: MOCK_ROLES }) })
    : null) });
  await goAgents(window);
  assert.equal(window.document.querySelector('.agent-chips-in .agent-io-none').textContent, '\u2014');
});

test('agent detail body is spaced below the channel pills', () => {
  // jsdom does not compute layout; assert the spacing RULE exists in the stylesheet.
  const css = readFileSync(cssPath, 'utf8');
  assert.match(css, /\.agent-detail\s*\{[^}]*margin-top\s*:/, '.agent-detail must define margin-top for pill→body spacing');
});
