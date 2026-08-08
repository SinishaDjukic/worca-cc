// test/ui-nav-sections.test.mjs — sidebar is grouped: New-pipeline CTA, then
// Activity / Build / Manage sections, Settings pinned at the bottom behind a
// divider. Topnav mirrors the order with thin separators. Markup+CSS only —
// app.js wires nav via `.nav button[data-nav]`, so headers are divs and
// Settings stays inside <nav class="nav">.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, '..', 'ui', 'public');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const css = readFileSync(join(root, 'style.css'), 'utf8');
const appPath = join(root, 'app.js');

const sidebar = () => html.match(/<nav class="nav"[\s\S]*?<\/nav>/)[0];
const topnav = () => html.match(/<nav class="topnav"[\s\S]*?<\/nav>/)[0];

// ---- Task 1: sidebar structure ----

test('sidebar reads: CTA, Activity, Build, Manage, divider, Settings — in order', () => {
  // One combined token stream: nav ids and section labels, in source order.
  const tokens = [...sidebar().matchAll(
    /data-nav="([a-z]+)"|class="nav-sect">([A-Za-z]+)<|class="(nav-sep)"/g
  )].map((m) => m[1] || m[2] || m[3]);
  assert.deepEqual(tokens, [
    'new',
    'Activity', 'running', 'history', 'stats',
    'Build', 'composer', 'agents', 'guardrails', 'plugins',
    'Manage', 'projects', 'workspaces',
    'nav-sep', 'settings',
  ]);
});

test('grouping adds no buttons and no anchors (11-button invariant holds)', () => {
  assert.equal((sidebar().match(/<button type="button"/g) || []).length, 11);
  assert.ok(!/<a[\s>]/.test(sidebar()));
  assert.match(sidebar(), /<div class="nav-sect">Activity<\/div>/);
  assert.match(sidebar(), /<div class="nav-sect">Build<\/div>/);
  assert.match(sidebar(), /<div class="nav-sect">Manage<\/div>/);
  assert.match(sidebar(), /<div class="nav-sep" aria-hidden="true"><\/div>/);
});

test('New-pipeline button is the CTA and still boots active', () => {
  assert.match(sidebar(), /<button type="button" class="active nav-cta" data-nav="new">/);
});

test('running children container still sits between Running and History', () => {
  assert.match(sidebar(),
    /data-nav="running">[\s\S]*?id="nav-running-children"[\s\S]*?data-nav="history">/);
});

test('Settings stays a .nav child (app.js selector `.nav button[data-nav]` must match it)', () => {
  assert.match(sidebar(), /data-nav="settings">\s*<svg/);
  const sideFoot = html.match(/<div class="side-foot">[\s\S]*?<\/aside>/)[0];
  assert.ok(!/data-nav=/.test(sideFoot),
    'settings must not move into .side-foot — routing would silently die');
});

// ---- jsdom guard: restructured menu still routes (esp. the pinned item) ----

const tick = () => new Promise((r) => setTimeout(r, 0));
const click = (window, node) =>
  node.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));

async function boot() {
  const dom = new JSDOM(html, { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class { constructor() { this.readyState = 1; }
    send() {} close() {} addEventListener() {} };
  window.fetch = () => Promise.resolve({ ok: true, status: 200, json: async () => ({
    config: { steps: {}, customModels: [] }, models: [], efforts: [],
    pipelines: 0, projects: 0, workspaces: 0, projects_list: [] }) });
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  window.localStorage.clear();
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await tick();
  return { window };
}

test('clicking pinned Settings still routes via the hash', async () => {
  const { window } = await boot();
  const doc = window.document;
  const btn = doc.querySelector('.nav button[data-nav="settings"]');
  assert.ok(btn, 'settings button reachable through the .nav selector');
  click(window, btn);
  await tick();
  assert.equal(window.location.hash, '#settings');
  assert.equal(doc.querySelector('[data-view="settings"]').classList.contains('hidden'), false);
  assert.ok(btn.classList.contains('active'));
});

test('clicking the CTA routes back to the New view', async () => {
  const { window } = await boot();
  const doc = window.document;
  click(window, doc.querySelector('.nav button[data-nav="history"]'));
  await tick();
  click(window, doc.querySelector('.nav button[data-nav="new"]'));
  await tick();
  assert.equal(doc.querySelector('[data-view="new"]').classList.contains('hidden'), false);
  assert.ok(doc.querySelector('.nav button[data-nav="new"]').classList.contains('active'),
    'CTA still receives the .active state from the router');
});
