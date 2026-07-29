// test/ui-subagent-tree.test.mjs — (copy bootLive from test/ui-run-graph-paint.test.mjs)
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

test('subGroupStatus: anyStop -> stop, else anyRun -> run, else done', async () => {
  const { window } = await bootLive();
  const { subGroupStatus } = window.__np;
  assert.equal(subGroupStatus([{ status: 'finished' }, { status: 'running' }]), 'run');
  assert.equal(subGroupStatus([{ status: 'running' }, { status: 'stopped' }]), 'stop', 'stop wins over run');
  assert.equal(subGroupStatus([{ status: 'error' }]), 'stop', 'error maps to the stop class');
  assert.equal(subGroupStatus([{ status: 'finished' }, { status: 'finished' }]), 'done');
  assert.equal(subGroupStatus([]), 'done');
});

test('renderSubsTree builds legend + per-node step + li rows; NO pulse class anywhere', async () => {
  const { window } = await bootLive();
  const panel = window.document.createElement('div');
  panel.className = 'subs-panel';
  const byNode = {
    s0_0: [{ id: 't1', label: 'research auth', status: 'running' }, { id: 't2', label: 'scan deps', status: 'finished' }],
    s1_0: [{ id: 't3', label: 'write tests', status: 'finished' }],
  };
  window.__np.renderSubsTree(panel, byNode, (id) => ({ s0_0: 'Plan', s1_0: 'Refine Plan' }[id] || id));

  assert.ok(panel.querySelector('.subs-legend'), 'legend present');
  const steps = panel.querySelectorAll('.subs-step');
  assert.equal(steps.length, 2, 'one .subs-step per node');

  const first = steps[0];
  assert.equal(first.querySelector('.subs-step-head b').textContent, 'Plan', 'step header shows the node label');
  assert.ok(first.querySelector('.subs-stat.run'), 'a running group -> run status pill');
  assert.match(first.querySelector('.subs-n').textContent, /2 sub-agents/);
  const rows = first.querySelectorAll('.subs-tree li');
  assert.equal(rows.length, 2, 'two sub-agent rows');
  assert.equal(rows[0].querySelector('.ag-name').textContent, 'research auth');
  assert.ok(rows[0].querySelector('.led.on'), 'running sub -> lit .led');
  assert.ok(rows[0].querySelector('.st.run'), 'running sub -> run mono badge');
  assert.ok(rows[1].querySelector('.st.done'), 'finished sub -> done mono badge');
  assert.ok(!rows[1].querySelector('.led').classList.contains('on'), 'finished sub -> unlit .led');

  const second = steps[1];
  assert.ok(second.querySelector('.subs-stat.done'), 'all-finished group -> done status pill');

  // HARD REQUIREMENT: the tree must never carry the graph pulse hook.
  assert.equal(panel.querySelectorAll('.fan .sq.on').length, 0, 'tree has no .fan .sq.on');
  // and the .led/.sq used here are NOT the pulsing selector
  for (const led of panel.querySelectorAll('.led, .sq')) {
    assert.ok(!led.closest('.fan'), 'no tree square lives under a .fan (the only pulsing scope)');
  }

  // idempotent: re-render replaces, does not stack
  window.__np.renderSubsTree(panel, byNode, (id) => id);
  assert.equal(panel.querySelectorAll('.subs-step').length, 2, 're-render does not duplicate steps');
});

// Sub-agent label/id come from attacker-influenced task descriptions and are
// interpolated into innerHTML — they MUST be HTML-escaped. Guards against a
// future regression (escapeHtml already protects this path today).
test('renderSubsTree escapes sub-agent labels (no HTML injection)', async () => {
  const { window } = await bootLive();
  const panel = window.document.createElement('div');
  panel.className = 'subs-panel';
  const evil = '<img src=x onerror=alert(1)>';
  window.__np.renderSubsTree(panel, { s0_0: [{ id: 't1', label: evil, status: 'running' }] }, (id) => id);

  // No live <img> element must be created from the malicious label.
  assert.equal(panel.querySelectorAll('img').length, 0, 'malicious label does not create an <img> element');
  // The label is rendered as escaped text, not parsed markup.
  const name = panel.querySelector('.ag-name');
  assert.ok(name, '.ag-name row present');
  assert.match(name.innerHTML, /&lt;img/, 'label rendered as escaped text (&lt;img…)');
  assert.equal(name.textContent, evil, 'visible text is the raw, un-executed label');
  assert.equal(name.querySelector('img'), null, 'no img child inside .ag-name');
});

// The node label (step header) is likewise escaped.
test('renderSubsTree escapes node labels in the step header', async () => {
  const { window } = await bootLive();
  const panel = window.document.createElement('div');
  panel.className = 'subs-panel';
  const evil = '<img src=x onerror=alert(1)>';
  window.__np.renderSubsTree(panel, { s0_0: [{ id: 't1', label: 'ok', status: 'finished' }] }, () => evil);
  assert.equal(panel.querySelectorAll('.subs-step-head img').length, 0, 'malicious node label does not create an <img>');
  assert.match(panel.querySelector('.subs-step-head b').innerHTML, /&lt;img/, 'node label escaped in header');
});
