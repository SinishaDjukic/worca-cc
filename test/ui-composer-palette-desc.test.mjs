// test/ui-composer-palette-desc.test.mjs — palette pills are cards: description
// under the name clamped by .pdesc; empty description → derived in/out line;
// nothing at all → "No description yet" (spec 2026-08-09).
// Harness copied from test/ui-composer.test.mjs with a custom /api/agents
// fixture and NO wf_default fixture (empty canvas — assertions never touch it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const AGENTS = [
  { key: 'described', displayName: 'Described', color: 'blue', domain: 'coding', order: 1,
    description: 'Reviews the implementation diff against the plan and files an honest verdict.',
    consumes: ['plan', 'code'], produces: ['review'] },
  { key: 'bare', displayName: 'Bare', color: 'green', domain: 'coding', order: 2, description: '',
    consumes: ['plan', 'review'], produces: ['checklist'], origin: 'user' },
  { key: 'blank', displayName: 'Blank', color: 'red', domain: 'coding', order: 3, description: '',
    consumes: [], produces: [], origin: 'user' },
];

async function boot() {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  Object.defineProperty(window.HTMLElement.prototype, 'offsetParent', { get() { return window.document.body; }, configurable: true });
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
  window.fetch = (url) => {
    const u = String(url);
    if (u.includes('/api/workflows')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ workflows: [] }) });
    if (u.includes('/api/agents')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ agents: AGENTS }) });
    if (u.includes('/api/projects')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [] }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'requestAnimationFrame']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  window.location.hash = 'composer';
  window.dispatchEvent(new window.Event('hashchange'));
  await new Promise((r) => setTimeout(r, 10));
  return window;
}

test('palette card renders the sidecar/frontmatter description under the name', async () => {
  const window = await boot();
  const pill = window.document.querySelector('#composer-palette .agent-pill[data-key="described"]');
  assert.ok(pill, 'card present');
  assert.equal(pill.getAttribute('tabindex'), '0', 'card is focusable');
  assert.match(pill.querySelector('.phead').textContent, /Described/, 'name in the header row');
  const pdesc = pill.querySelector('.pdesc');
  assert.equal(pdesc.textContent, 'Reviews the implementation diff against the plan and files an honest verdict.');
  assert.equal(pdesc.classList.contains('derived'), false);
});

test('empty description → derived in/out line, marked .derived', async () => {
  const window = await boot();
  const pdesc = window.document.querySelector('.agent-pill[data-key="bare"] .pdesc');
  assert.equal(pdesc.textContent, 'in: plan, review · out: checklist');
  assert.equal(pdesc.classList.contains('derived'), true);
});

test('no description and no channels → "No description yet"', async () => {
  const window = await boot();
  const pdesc = window.document.querySelector('.agent-pill[data-key="blank"] .pdesc');
  assert.equal(pdesc.textContent, 'No description yet');
  assert.equal(pdesc.classList.contains('derived'), true);
});

test('focusin shows the shared bubble with full description, meta line, and IO line', async () => {
  const window = await boot();
  const doc = window.document;
  const pill = doc.querySelector('.agent-pill[data-key="described"]');
  pill.dispatchEvent(new window.Event('focusin', { bubbles: true }));
  const bubble = doc.getElementById('info-bubble');
  assert.ok(bubble, 'shared bubble created');
  assert.equal(bubble.classList.contains('hidden'), false, 'bubble visible');
  assert.ok(bubble.textContent.includes('Reviews the implementation diff against the plan and files an honest verdict.'), 'full description');
  assert.ok(bubble.textContent.includes('coding · builtin'), 'domain · origin meta line');
  assert.ok(bubble.textContent.includes('plan, code → review'), 'consumes → produces line');
  assert.equal(pill.getAttribute('aria-describedby'), 'info-bubble', 'a11y wiring');
  pill.dispatchEvent(new window.Event('focusout', { bubbles: true }));
  assert.equal(bubble.classList.contains('hidden'), true, 'blur hides');
});

test('bubble states: description-less agents show "No description yet"; IO line only when channels exist', async () => {
  const window = await boot();
  const doc = window.document;
  const bare = doc.querySelector('.agent-pill[data-key="bare"]');
  bare.dispatchEvent(new window.Event('focusin', { bubbles: true }));
  const bubble = doc.getElementById('info-bubble');
  assert.ok(bubble.textContent.includes('No description yet'), 'tip-desc fallback, not the derived in/out text');
  assert.ok(bubble.textContent.includes('plan, review → checklist'), 'real channels still shown as the IO line');
  bare.dispatchEvent(new window.Event('focusout', { bubbles: true }));
  const blank = doc.querySelector('.agent-pill[data-key="blank"]');
  blank.dispatchEvent(new window.Event('focusin', { bubbles: true }));
  assert.ok(bubble.textContent.includes('No description yet'), 'blank tip-desc fallback');
  assert.ok(bubble.textContent.includes('coding · user'), 'domain · origin meta line');
  assert.equal(bubble.textContent.includes('→'), false, 'no IO line when both sides are empty');
});

test('mouseover shows the bubble only after the hover-intent delay', async () => {
  const window = await boot();
  const doc = window.document;
  const pill = doc.querySelector('.agent-pill[data-key="described"]');
  pill.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
  const early = doc.getElementById('info-bubble');
  assert.ok(!early || early.classList.contains('hidden'), 'not shown immediately');
  await new Promise((r) => setTimeout(r, 300));
  const bubble = doc.getElementById('info-bubble');
  assert.ok(bubble && !bubble.classList.contains('hidden'), 'shown after ~250ms');
  pill.dispatchEvent(new window.MouseEvent('mouseout', { bubbles: true }));
  assert.equal(bubble.classList.contains('hidden'), true, 'mouseout hides');
});

test('moving between children inside one card never hides the visible bubble', async () => {
  const window = await boot();
  const doc = window.document;
  const pill = doc.querySelector('.agent-pill[data-key="described"]');
  const phead = pill.querySelector('.phead');
  const pdesc = pill.querySelector('.pdesc');
  phead.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  const bubble = doc.getElementById('info-bubble');
  assert.ok(bubble && !bubble.classList.contains('hidden'), 'bubble shown after hover intent');
  // cursor crosses .phead -> .pdesc (browsers fire BOTH events with relatedTarget set)
  phead.dispatchEvent(new window.MouseEvent('mouseout', { bubbles: true, relatedTarget: pdesc }));
  pdesc.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true, relatedTarget: phead }));
  assert.equal(bubble.classList.contains('hidden'), false, 'bubble must stay visible inside the card');
  pdesc.dispatchEvent(new window.MouseEvent('mouseout', { bubbles: true, relatedTarget: doc.body }));
  assert.equal(bubble.classList.contains('hidden'), true, 'true leave hides');
});

test('dragstart cancels the pending tip and hides the bubble', async () => {
  const window = await boot();
  const doc = window.document;
  const pill = doc.querySelector('.agent-pill[data-key="described"]');
  pill.dispatchEvent(new window.Event('focusin', { bubbles: true }));
  assert.equal(doc.getElementById('info-bubble').classList.contains('hidden'), false);
  pill.dispatchEvent(new window.Event('dragstart', { bubbles: true }));
  assert.equal(doc.getElementById('info-bubble').classList.contains('hidden'), true, 'dragstart hides');
});

test('Escape during the hover-intent window cancels the pending bubble', async () => {
  const window = await boot();
  const doc = window.document;
  const pill = doc.querySelector('.agent-pill[data-key="described"]');
  pill.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  const bubble = doc.getElementById('info-bubble');
  assert.ok(!bubble || bubble.classList.contains('hidden'), 'Escape must clear the pending timer, not just hide');
});
