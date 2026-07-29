// test/ui-subagent-pill.test.mjs — (copy bootLive from test/ui-run-graph-paint.test.mjs)
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

test('subsPillText: spawned/active wording + colour flag', async () => {
  const { window } = await bootLive();
  const { subsPillText } = window.__np;
  // byNode: { nodeId: Array<{status}> }
  assert.deepEqual(
    subsPillText({ a: [{ status: 'running' }, { status: 'finished' }], b: [{ status: 'finished' }] }),
    { text: '3 spawned · 1 active', active: true },
  );
  assert.deepEqual(
    subsPillText({ a: [{ status: 'finished' }, { status: 'finished' }] }),
    { text: '2 sub-agents', active: false },
  );
  assert.deepEqual(subsPillText({}), { text: '0 sub-agents', active: false });
  // error/stopped count as spawned but not active
  assert.deepEqual(
    subsPillText({ a: [{ status: 'error' }, { status: 'stopped' }] }),
    { text: '2 sub-agents', active: false },
  );
});

test('paintSubsBar fills the button text, sb-count colour, and toggles the panel', async () => {
  const { window } = await bootLive();
  // Build a card so the template's .subs-bar exists.
  const tpl = window.document.querySelector('#run-card-tpl');
  const card = tpl.content.firstElementChild.cloneNode(true);
  const bar = card.querySelector('.subs-bar');
  assert.ok(bar, '.subs-bar present in the run-card template');
  const btn = bar.querySelector('.btn-subs');
  const panel = bar.querySelector('.subs-panel');
  assert.equal(btn.getAttribute('aria-expanded'), 'false', 'panel starts collapsed');
  assert.ok(panel.hidden, 'panel hidden initially');

  window.__np.paintSubsBar(bar, { a: [{ status: 'running' }, { status: 'finished' }] });
  assert.match(btn.querySelector('.sb-count').textContent, /2 spawned · 1 active/);
  assert.ok(!btn.querySelector('.sb-count').classList.contains('grey'), 'active -> blue count');

  window.__np.paintSubsBar(bar, { a: [{ status: 'finished' }] });
  assert.match(btn.querySelector('.sb-count').textContent, /1 sub-agents/);
  assert.ok(btn.querySelector('.sb-count').classList.contains('grey'), 'no active -> grey count');

  // toggle wiring (disclosure pattern)
  btn.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.equal(btn.getAttribute('aria-expanded'), 'true');
  assert.ok(!panel.hidden, 'click opens the panel');
  btn.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  assert.ok(panel.hidden, 'click again collapses');
});

test('paintSubsBar hides the whole bar when there are no sub-agents', async () => {
  const { window } = await bootLive();
  const tpl = window.document.querySelector('#run-card-tpl');
  const card = tpl.content.firstElementChild.cloneNode(true);
  const bar = card.querySelector('.subs-bar');
  window.__np.paintSubsBar(bar, {});
  assert.ok(bar.hidden, 'empty -> the pill row is hidden entirely');
});

// REGRESSION (concurrency): the app renders MANY run cards at once, each
// repainting independently on its own WS events. Per-card grouping/label state
// must live on the element — a module-level function static bleeds the most
// recently painted card's data into another card's open panel. Two independent
// bars, painted A then B with DIFFERENT groupings + DIFFERENT label resolvers:
// card A's panel must always show A's labels + A's rows, never B's.
test('paintSubsBar: per-card state does not bleed across concurrent run cards', async () => {
  const { window } = await bootLive();
  const tpl = window.document.querySelector('#run-card-tpl');
  const mkBar = () => tpl.content.firstElementChild.cloneNode(true).querySelector('.subs-bar');

  const barA = mkBar();
  const barB = mkBar();

  // Card A: node "sA" labelled "Alpha", one running sub "alpha-task".
  const groupsA = { sA: [{ id: 'a1', label: 'alpha-task', status: 'running' }] };
  const labelA = (id) => ({ sA: 'Alpha' }[id] || id);
  // Card B: node "sB" labelled "Beta", two finished subs.
  const groupsB = { sB: [{ id: 'b1', label: 'beta-task', status: 'finished' }, { id: 'b2', label: 'beta-task-2', status: 'finished' }] };
  const labelB = (id) => ({ sB: 'Beta' }[id] || id);

  // Paint A first, then B (B is "most recently painted" — what a function static captures).
  window.__np.paintSubsBar(barA, groupsA, labelA);
  window.__np.paintSubsBar(barB, groupsB, labelB);

  // ── Path 1: open A's panel while it is already collapsed; click renders A's tree.
  const btnA = barA.querySelector('.btn-subs');
  const panelA = barA.querySelector('.subs-panel');
  btnA.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.equal(btnA.getAttribute('aria-expanded'), 'true', 'A opens on click');
  assert.ok(!panelA.hidden, 'A panel visible');

  // A's panel must show A's node label + A's sub rows — NOT B's.
  const headA = panelA.querySelector('.subs-step-head b');
  assert.equal(headA && headA.textContent, 'Alpha', 'A panel header shows A\'s node label, not B\'s ("Beta")');
  const rowNamesA = [...panelA.querySelectorAll('.subs-tree li .ag-name')].map((e) => e.textContent);
  assert.deepEqual(rowNamesA, ['alpha-task'], 'A panel shows A\'s sub-agent rows, not B\'s');
  assert.equal(panelA.querySelectorAll('.subs-step').length, 1, 'A panel shows A\'s single node group');

  // ── Path 2: A's panel is OPEN; B repaints last; A repaints — the in-place
  // re-render of A's open panel must still use A's grouping/labels, not B's.
  window.__np.paintSubsBar(barB, groupsB, labelB);
  window.__np.paintSubsBar(barA, groupsA, labelA);
  const headA2 = panelA.querySelector('.subs-step-head b');
  assert.equal(headA2 && headA2.textContent, 'Alpha', 'open A panel keeps A\'s label after B then A repaint');
  const rowNamesA2 = [...panelA.querySelectorAll('.subs-tree li .ag-name')].map((e) => e.textContent);
  assert.deepEqual(rowNamesA2, ['alpha-task'], 'open A panel keeps A\'s rows after B then A repaint');

  // ── Path 3: open B as well — B shows B's data; A unchanged.
  const btnB = barB.querySelector('.btn-subs');
  const panelB = barB.querySelector('.subs-panel');
  btnB.dispatchEvent(new window.Event('click', { bubbles: true }));
  const headB = panelB.querySelector('.subs-step-head b');
  assert.equal(headB && headB.textContent, 'Beta', 'B panel shows B\'s label');
  const rowNamesB = [...panelB.querySelectorAll('.subs-tree li .ag-name')].map((e) => e.textContent);
  assert.deepEqual(rowNamesB, ['beta-task', 'beta-task-2'], 'B panel shows B\'s rows');
  // A still correct after B opened.
  assert.equal(panelA.querySelector('.subs-step-head b').textContent, 'Alpha', 'A panel still A\'s label after B opened');
});
