// test/ui-subagent-type-pill.test.mjs — per-sub-agent type pill (raw subagent_type),
// escaped + present-only-when-set. bootLive() copied from test/ui-subagent-pill.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECT = '/tmp/proj';

async function bootLive() {
  const wsInstances = [];
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._listeners = {}; wsInstances.push(this); }
    send() {} close() {}
    addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); }
    _fire(type, data) { for (const fn of (this._listeners[type] || [])) fn(data); }
  };
  window.fetch = (url) => {
    if (String(url).includes('/api/projects')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  return { window };
}

test('renderSubsTree renders a per-sub-agent type pill (raw value, present-only-when-set)', async () => {
  const { window } = await bootLive();
  const { renderSubsTree } = window.__np;
  const panel = window.document.createElement('div');
  const byNode = { 'n1|1': [
    { id: 'a1', label: 'AR sheet', status: 'running',  subagentType: 'Explore' },
    { id: 'a2', label: 'AR items', status: 'finished', subagentType: 'general-purpose' },
    { id: 'a3', label: 'AR none',  status: 'finished' }, // no type -> no pill
  ] };
  renderSubsTree(panel, byNode, () => 'Plan');

  const rows = panel.querySelectorAll('.subs-tree li');
  assert.equal(rows[0].querySelector('.agent-type-pill').textContent, 'Explore');
  assert.equal(rows[1].querySelector('.agent-type-pill').textContent, 'general-purpose'); // raw, verbatim
  assert.equal(rows[2].querySelector('.agent-type-pill'), null, 'untyped sub-agent has no type pill');
});

test('renderSubsTree escapes the sub-agent type (no HTML injection)', async () => {
  const { window } = await bootLive();
  const { renderSubsTree } = window.__np;
  const panel = window.document.createElement('div');
  const evil = '<img src=x onerror=alert(1)>';
  renderSubsTree(panel, { 's0_0': [{ id: 't1', label: 'ok', status: 'running', subagentType: evil }] }, (id) => id);
  assert.equal(panel.querySelectorAll('img').length, 0, 'malicious type does not create an <img>');
  assert.match(panel.querySelector('.agent-type-pill').innerHTML, /&lt;img/, 'type rendered as escaped text');
});

test('agentTypePillHtml: raw value, escaped, empty string when absent', async () => {
  const { window } = await bootLive();
  const { agentTypePillHtml } = window.__np;
  assert.equal(agentTypePillHtml('worca-cc-planner'), '<span class="agent-type-pill">worca-cc-planner</span>');
  assert.equal(agentTypePillHtml(''), '');
  assert.equal(agentTypePillHtml(null), '');
  assert.equal(agentTypePillHtml(undefined), '');
});

test('onSubagent merges subagentType onto the run record', async () => {
  const { window } = await bootLive();
  const { makeRun, onSubagent } = window.__np;
  const r = makeRun({ runId: 'run1' });
  onSubagent(r, { id: 'a1', nodeId: 'n1', cycle: 1, status: 'running', subagentType: 'Explore' });
  assert.equal(r.subAgents.find((s) => s.id === 'a1').subagentType, 'Explore');
});
