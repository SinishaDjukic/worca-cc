// test/ui-graphify-count-pill.test.mjs — per-sub-agent + per-group graphify-use count
// badge. Present only when count > 0. bootLive() copied from ui-subagent-type-pill.test.mjs.
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

test('graphifyCountPillHtml: count badge when > 0, empty string otherwise', async () => {
  const { window } = await bootLive();
  const { graphifyCountPillHtml } = window.__np;
  assert.equal(graphifyCountPillHtml(3), '<span class="graphify-pill">graphify ×3</span>');
  assert.equal(graphifyCountPillHtml(1), '<span class="graphify-pill">graphify ×1</span>');
  assert.equal(graphifyCountPillHtml(0), '');
  assert.equal(graphifyCountPillHtml(null), '');
  assert.equal(graphifyCountPillHtml(undefined), '');
});

test('renderSubsTree renders a per-sub-agent graphify badge (present only when count > 0)', async () => {
  const { window } = await bootLive();
  const { renderSubsTree } = window.__np;
  const panel = window.document.createElement('div');
  const byNode = { 'n1|1': [
    { id: 'a1', label: 'inv A', status: 'finished', graphifyCount: 3 },
    { id: 'a2', label: 'inv B', status: 'finished', graphifyCount: 0 }, // zero -> no badge
    { id: 'a3', label: 'inv C', status: 'finished' },                   // absent -> no badge
  ] };
  renderSubsTree(panel, byNode, () => 'Plan', {}, {});

  const rows = panel.querySelectorAll('.subs-tree li');
  assert.equal(rows[0].querySelector('.graphify-pill').textContent, 'graphify ×3');
  assert.equal(rows[1].querySelector('.graphify-pill'), null, 'zero count -> no badge');
  assert.equal(rows[2].querySelector('.graphify-pill'), null, 'absent count -> no badge');
});

test('per-sub-agent graphify badge is inline: after the type pill, before the status', async () => {
  const { window } = await bootLive();
  const { renderSubsTree } = window.__np;
  const panel = window.document.createElement('div');
  const byNode = { 'n1|1': [
    { id: 'a1', label: 'inv A', status: 'finished', subagentType: 'Explore', graphifyCount: 3 },
  ] };
  renderSubsTree(panel, byNode, () => 'Plan', {}, {});

  const li = panel.querySelector('.subs-tree li');
  const kids = Array.from(li.children);
  const idx = (sel) => kids.findIndex((el) => el.matches(sel));
  assert.ok(idx('.agent-type-pill') >= 0, 'type pill present');
  assert.ok(idx('.graphify-pill') >= 0, 'graphify badge present');
  assert.ok(idx('.st') >= 0, 'status pill present');
  assert.ok(idx('.agent-type-pill') < idx('.graphify-pill'), 'graphify sits right after the type pill');
  assert.ok(idx('.graphify-pill') < idx('.st'), 'graphify sits before the status pill (not its own trailing row)');
});

test('renderSubsTree renders the MAIN-agent graphify badge INLINE in the group header', async () => {
  const { window } = await bootLive();
  const { renderSubsTree } = window.__np;
  const panel = window.document.createElement('div');
  const byNode = { 'n1|1': [{ id: 'a1', label: 'inv', status: 'finished' }] };
  renderSubsTree(panel, byNode, () => 'Plan', {}, { 'n1|1': 4 });

  const head = panel.querySelector('.subs-step-head');
  assert.ok(head, 'group header rendered');
  // The badge must be a CHILD of the header (inline), not a stray block under .subs-step.
  const pill = head.querySelector('.graphify-pill');
  assert.ok(pill, 'graphify badge is inline inside the header');
  assert.equal(pill.textContent, 'graphify ×4');
  // It sits AFTER the status pill and BEFORE the right-pinned "N sub-agents" count.
  const kids = Array.from(head.children);
  const idx = (sel) => kids.findIndex((el) => el.matches(sel));
  assert.ok(idx('.subs-stat') >= 0 && idx('.graphify-pill') >= 0, 'status + badge both in header');
  assert.ok(idx('.subs-stat') < idx('.graphify-pill'), 'badge follows the status pill');
  assert.ok(idx('.graphify-pill') < idx('.subs-n'), 'badge sits before the right-pinned count');
});

test('onSubagent merges graphifyCount onto the run record', async () => {
  const { window } = await bootLive();
  const { makeRun, onSubagent } = window.__np;
  const r = makeRun({ runId: 'run1' });
  onSubagent(r, { id: 'a1', nodeId: 'n1', cycle: 1, status: 'running', graphifyCount: 2 });
  assert.equal(r.subAgents.find((s) => s.id === 'a1').graphifyCount, 2);
});

test('onStepGraphify records the MAIN-agent count by nodeId|cycle group key', async () => {
  const { window } = await bootLive();
  const { makeRun, onStepGraphify } = window.__np;
  const r = makeRun({ runId: 'run1' });
  onStepGraphify(r, { nodeId: 'n1', cycle: 1, graphifyCount: 5 });
  assert.equal(r.stepGraphify['n1|1'], 5);
});

test('stepGraphifyFromSteps derives {groupKey: count}, skipping steps with no graphify', async () => {
  const { window } = await bootLive();
  const { stepGraphifyFromSteps } = window.__np;
  const map = stepGraphifyFromSteps([
    { nodeId: 'n1', cycle: 1, graphifyCount: 3 },
    { nodeId: 'n2', cycle: 1, graphifyCount: 0 },
    { nodeId: 'n3', cycle: 1 },
  ]);
  assert.deepEqual(map, { 'n1|1': 3 });
});
