// test/ui-agent-editor.test.mjs — jsdom tests for the in-card agent editor pane.
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
const goAgents = async (window) => {
  window.location.hash = 'agents';
  window.dispatchEvent(new window.Event('hashchange'));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
};

test('Edit opens the pane, fills fields via .value (markup inert), and PUTs the edited agent', async () => {
  const puts = [];
  const MD_XSS = '# body\n<img src=x onerror="boom()">\n';
  const { window } = await boot({
    fetchHandler: (u, opts) => {
      if (u.endsWith('/api/agents/docsWriter') && (!opts.method || opts.method === 'GET')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ meta: AGENTS[1], markdown: MD_XSS }) });
      }
      if (u.endsWith('/api/agents/docsWriter') && opts.method === 'PUT') {
        puts.push(JSON.parse(opts.body));
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ meta: { ...AGENTS[1], displayName: 'Docs v2' }, markdown: MD_XSS }) });
      }
      return null;
    },
  });
  await goAgents(window);
  const doc = window.document;
  const card = doc.querySelector('.agent-card[data-agent-key="docsWriter"]');
  click(window, card.querySelector('.agent-edit'));
  await new Promise((r) => setTimeout(r, 0));
  const pane = card.querySelector('.agent-edit-pane');
  assert.equal(pane.hidden, false, 'edit pane visible');
  const ta = card.querySelector('.agent-f-md');
  assert.equal(ta.value, MD_XSS, 'markdown bound via .value');
  assert.equal(ta.querySelector && ta.querySelector('img'), null, 'no element parsed (never innerHTML)');
  assert.equal(card.querySelector('.agent-f-name').value, 'Docs Writer');
  // consumes chips: 'plan' checked, others not
  const planCb = [...card.querySelectorAll('.agent-f-consumes input')].find((c) => c.value === 'plan');
  assert.equal(planCb.checked, true);

  card.querySelector('.agent-f-name').value = 'Docs v2';
  ta.value = MD_XSS + 'edited\n';
  click(window, card.querySelector('.agent-edit-save'));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(puts.length, 1);
  assert.equal(puts[0].meta.displayName, 'Docs v2');
  assert.deepEqual(puts[0].meta.consumes, ['plan']);
  assert.equal(puts[0].markdown, MD_XSS + 'edited\n');
});

test('editing an agent with a custom channel id keeps it: chip renders checked, save round-trips it', async () => {
  const puts = [];
  const metaWithCustom = { ...AGENTS[1], consumes: ['plan', 'spec'] }; // 'spec' NOT in the CHANNELS stub
  const { window } = await boot({
    fetchHandler: (u, opts) => {
      if (u.endsWith('/api/agents/docsWriter') && (!opts.method || opts.method === 'GET')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ meta: metaWithCustom, markdown: '# b' }) });
      }
      if (u.endsWith('/api/agents/docsWriter') && opts.method === 'PUT') {
        puts.push(JSON.parse(opts.body));
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ meta: metaWithCustom, markdown: '# b' }) });
      }
      return null;
    },
  });
  await goAgents(window);
  const card = window.document.querySelector('.agent-card[data-agent-key="docsWriter"]');
  click(window, card.querySelector('.agent-edit'));
  await new Promise((r) => setTimeout(r, 0));
  const specCb = [...card.querySelectorAll('.agent-f-consumes input')].find((c) => c.value === 'spec');
  assert.ok(specCb, 'custom channel renders a chip even though the channels list omits it');
  assert.equal(specCb.checked, true, 'custom channel chip is checked');
  click(window, card.querySelector('.agent-edit-save')); // save WITHOUT touching any chip
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(puts.length, 1);
  assert.deepEqual(puts[0].meta.consumes, ['plan', 'spec'], 'custom id survives the edit round-trip');
});

test('a 400 on save keeps the pane open and surfaces the error in the form', async () => {
  const { window } = await boot({
    fetchHandler: (u, opts) => {
      if (u.endsWith('/api/agents/docsWriter') && (!opts.method || opts.method === 'GET')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ meta: AGENTS[1], markdown: '# b' }) });
      }
      if (u.endsWith('/api/agents/docsWriter') && opts.method === 'PUT') {
        return Promise.resolve({ ok: false, status: 400, json: async () => ({ error: 'markdown body cannot be empty' }) });
      }
      return null;
    },
  });
  await goAgents(window);
  const doc = window.document;
  const card = doc.querySelector('.agent-card[data-agent-key="docsWriter"]');
  click(window, card.querySelector('.agent-edit'));
  await new Promise((r) => setTimeout(r, 0));
  card.querySelector('.agent-f-md').value = '';
  click(window, card.querySelector('.agent-edit-save'));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(card.querySelector('.agent-edit-pane').hidden, false, 'pane stays open');
  assert.match(card.querySelector('.agent-edit-msg').textContent, /cannot be empty/);
});
