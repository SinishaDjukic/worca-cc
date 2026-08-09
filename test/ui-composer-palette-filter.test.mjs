// test/ui-composer-palette-filter.test.mjs — the palette header filter narrows
// cards live by key/name/description/channel names; a zero-match query hides the
// whole section; the active query survives a palette rebuild (spec 2026-08-09).
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
  // Authored description + a channel the card never paints — the review F2 repro
  // (the real 'Plan'/'Refine Plan' cards matched a REVIEW query for this reason).
  { key: 'authored', displayName: 'Authored', color: 'amber', domain: 'coding', order: 4,
    description: 'Turns hidden decisions into questions before planning.',
    consumes: ['review'], produces: ['plan'], origin: 'user' },
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

const type = (window, value) => {
  const input = window.document.getElementById('composer-agent-filter');
  input.value = value;
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
};

test('typing filters cards by name/description substring, case-insensitively', async () => {
  const window = await boot();
  const doc = window.document;
  type(window, 'REVIEWS');   // hits only the 'described' agent's description text
  assert.equal(doc.querySelector('.agent-pill[data-key="described"]').classList.contains('hidden'), false);
  assert.equal(doc.querySelector('.agent-pill[data-key="bare"]').classList.contains('hidden'), true);
  assert.equal(doc.querySelector('.agent-pill[data-key="blank"]').classList.contains('hidden'), true);
});

test('channel names are searchable — the derived in/out line is real card text', async () => {
  const window = await boot();
  const doc = window.document;
  type(window, 'CHECKLIST');   // bare's produces channel, visible in its derived line
  assert.equal(doc.querySelector('.agent-pill[data-key="bare"]').classList.contains('hidden'), false);
  assert.equal(doc.querySelector('.agent-pill[data-key="described"]').classList.contains('hidden'), true);
  assert.equal(doc.querySelector('.agent-pill[data-key="blank"]').classList.contains('hidden'), true);
});

test('a card showing an authored description is NOT matched by its invisible channel names', async () => {
  const window = await boot();
  const doc = window.document;
  type(window, 'REVIEW');
  // 'authored' consumes 'review' but renders its own description — the word
  // appears nowhere on the card, so matching it is a hit with no visible reason.
  assert.equal(doc.querySelector('.agent-pill[data-key="authored"]').classList.contains('hidden'), true,
    'channels are not searchable on a card that paints a real description');
  // 'bare' renders the derived "in: plan, review · out: checklist" line — the
  // word IS on the card, so it must still match.
  assert.equal(doc.querySelector('.agent-pill[data-key="bare"]').classList.contains('hidden'), false,
    'the derived in/out line stays searchable');
  // 'described' matches on its own description text ("Reviews the …").
  assert.equal(doc.querySelector('.agent-pill[data-key="described"]').classList.contains('hidden'), false,
    'description text still matches');
});

test('a query with zero matches hides the whole section; clearing restores all', async () => {
  const window = await boot();
  const doc = window.document;
  type(window, 'zzz-no-such-agent');
  const section = doc.querySelector('#composer-palette .pal-section');
  assert.equal(section.classList.contains('hidden'), true, 'empty section hidden');
  type(window, '');
  assert.equal(section.classList.contains('hidden'), false, 'section restored');
  assert.equal(doc.querySelectorAll('#composer-palette .agent-pill.hidden').length, 0, 'all cards restored');
});

test('palette rebuild (collapse chip toggle) re-applies the active query', async () => {
  const window = await boot();
  const doc = window.document;
  type(window, 'REVIEWS');
  // Re-query the chip between clicks: each click rebuilds the palette and
  // detaches the previous chip node (detached dispatch happens to work in
  // jsdom, but a fresh query is what a browser user actually does).
  doc.querySelector('#composer-palette .pal-chip').dispatchEvent(new window.Event('click', { bubbles: true }));  // collapse = rebuild
  doc.querySelector('#composer-palette .pal-chip').dispatchEvent(new window.Event('click', { bubbles: true }));  // expand = rebuild again
  assert.equal(doc.querySelector('.agent-pill[data-key="bare"]').classList.contains('hidden'), true, 'query survived rebuild');
});
