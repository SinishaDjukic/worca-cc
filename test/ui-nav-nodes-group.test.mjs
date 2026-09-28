// test/ui-nav-nodes-group.test.mjs — Agents and Scripts sit under one "Nodes"
// parent row in the sidebar's Build section. The parent is a disclosure, not a
// route: it folds its two children, remembers the choice, and opens itself
// whenever a child page is shown so "where am I" never hides. The children keep
// their #agents / #scripts hashes and their data-nav wiring (app.js snapshots
// `.nav button[data-nav]`, which reaches nested buttons). The compact topnav is
// a flat strip and stays flat.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, '..', 'ui', 'public');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const css = readFileSync(join(root, 'style.css'), 'utf8');
const appPath = join(root, 'app.js');

const KEY = 'worca-cc.nav.nodes.collapsed';
const SIDEBAR_KEY = 'worca-cc.sidebar.collapsed';
const sidebar = () => html.match(/<nav class="nav"[\s\S]*?<\/nav>/)[0];
const topnav = () => html.match(/<nav class="topnav"[\s\S]*?<\/nav>/)[0];

// Same anchored idiom as test/ui-nav-sections.test.mjs.
function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp('(?:^|[\\s,}])' + escaped + '\\s*\\{([^}]*)\\}'));
  return m ? m[1] : null;
}

// ---- static markup ----

test('Build reads: Workflow Composer, then Nodes holding Agents and Scripts', () => {
  const tokens = [...sidebar().matchAll(
    /data-nav="([a-z-]+)"|data-nav-group="([a-z-]+)"|class="nav-sect"[^>]*>([A-Za-z]+)</g
  )].map((m) => m[1] || m[2] || m[3]);
  const i = tokens.indexOf('Build');
  assert.deepEqual(tokens.slice(i, i + 5), ['Build', 'composer', 'nodes', 'agents', 'scripts']);
});

test('the parent is an expert-gated disclosure button, not a route', () => {
  const m = sidebar().match(/<button type="button" class="nav-group" data-nav-group="nodes"([^>]*)>/);
  assert.ok(m, 'a .nav-group button carries data-nav-group="nodes"');
  assert.match(m[1], /data-min-level="expert"/);
  assert.match(m[1], /aria-expanded="true"/);
  assert.match(m[1], /aria-controls="nav-nodes-children"/);
  assert.doesNotMatch(m[1], /data-nav=/);
  assert.match(sidebar(), /data-nav-group="nodes"[^>]*>[\s\S]*?<span>Nodes<\/span>/);
});

test('the children are nav-child rows inside the group box and keep their hashes', () => {
  // The box is gated too: with only its rows hidden it would still hold its
  // 8px of margin open in the Build section at Simple and Advanced.
  const box = sidebar().match(/<div class="nav-children nav-group-children" id="nav-nodes-children" data-min-level="expert">([\s\S]*?)<\/div>/);
  assert.ok(box, 'the children container exists and is expert-gated');
  const kids = [...box[1].matchAll(
    /<button type="button" class="nav-child" data-nav="([a-z-]+)" data-min-level="expert">/g
  )].map((m) => m[1]);
  assert.deepEqual(kids, ['agents', 'scripts']);
  assert.match(sidebar(), /data-nav-group="nodes"[^>]*>[\s\S]*?<\/button>\s*<div class="nav-children nav-group-children" id="nav-nodes-children" data-min-level="expert"/,
    'the box follows its parent row');
});

test('the compact topnav stays flat: Agents and Scripts remain direct buttons', () => {
  assert.match(topnav(),
    /<button type="button" data-nav="agents" data-min-level="expert">Agents<\/button>\s*<button type="button" data-nav="scripts" data-min-level="expert">Scripts<\/button>/);
  assert.ok(!/nav-group/.test(topnav()));
});

// ---- jsdom ----

const tick = () => new Promise((r) => setTimeout(r, 0));
const click = (window, node) =>
  node.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));

async function boot({ seed = {}, level } = {}) {
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
  for (const [k, v] of Object.entries(seed)) window.localStorage.setItem(k, v);
  // ui-level.mjs reads <html data-level>; absent means expert (gate nothing).
  if (level) window.document.documentElement.dataset.level = level;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await tick();
  const $ = (s) => window.document.querySelector(s);
  const go = async (hash) => { window.location.hash = hash; await tick(); };
  return { window, $, go };
}
const group = ($) => $('.nav .nav-group[data-nav-group="nodes"]');
const box = ($) => $('#nav-nodes-children');
const isOpen = ($) => group($).getAttribute('aria-expanded') === 'true' && !box($).classList.contains('collapsed');

test('clicking Nodes folds and unfolds its children without routing, and remembers it', async () => {
  const { window, $ } = await boot();
  assert.equal(isOpen($), true, 'open by default');
  const hash = window.location.hash;
  click(window, group($)); await tick();
  assert.equal(group($).getAttribute('aria-expanded'), 'false');
  assert.ok(box($).classList.contains('collapsed'));
  assert.equal(window.location.hash, hash, 'a disclosure never routes');
  assert.equal(window.localStorage.getItem(KEY), '1');
  click(window, group($)); await tick();
  assert.equal(isOpen($), true);
  assert.equal(window.localStorage.getItem(KEY), null);
});

test('a folded group is restored on the next boot', async () => {
  const { $ } = await boot({ seed: { [KEY]: '1' } });
  assert.equal(isOpen($), false);
});

test('opening a child page forces the group open and tints the parent', async () => {
  const { $, go } = await boot({ seed: { [KEY]: '1' } });
  await go('#scripts');
  assert.equal(isOpen($), true);
  assert.ok($('.nav button[data-nav="scripts"]').classList.contains('active'));
  assert.ok(group($).classList.contains('has-active'));
  assert.ok(!group($).classList.contains('active'), 'the parent never takes the dark current-page fill');
  await go('#history');
  assert.ok(!group($).classList.contains('has-active'));
  assert.equal(isOpen($), true, 'leaving the group does not fold it');
});

test('a child click routes exactly like before', async () => {
  const { window, $ } = await boot();
  click(window, $('.nav button[data-nav="agents"]')); await tick();
  assert.equal(window.location.hash, '#agents');
  assert.equal($('[data-view="agents"]').classList.contains('hidden'), false);
  assert.ok(group($).classList.contains('has-active'));
});

test('a deep link below the mode keeps the parent visible alongside its child', async () => {
  const { $, go } = await boot({ level: 'advanced' });
  await go('#agents');
  assert.equal($('.nav button[data-nav="agents"]').dataset.levelKeep, '1');
  assert.equal(group($).dataset.levelKeep, '1', 'an orphaned child row would hang off a hidden parent');
  assert.equal(box($).dataset.levelKeep, '1', 'the box is gated too, so a kept row inside a hidden box shows nothing');
  await go('#history');
  assert.equal(group($).dataset.levelKeep, undefined);
  assert.equal(box($).dataset.levelKeep, undefined);
  assert.equal($('.nav button[data-nav="agents"]').dataset.levelKeep, undefined);
});

// Simple is the exception to "the page you are on keeps its menu entry": the
// whole group stays hidden — parent, box, children, and the topnav twins — and
// the level banner alone says where you are. Advanced keeps it (test above).
test('Simple hides the whole group even while a child page is open', async () => {
  const { $, go } = await boot({ level: 'simple' });
  await go('#agents');
  assert.equal($('[data-view="agents"]').classList.contains('hidden'), false, 'the page itself still opens');
  assert.equal($('#level-banner').hidden, false, 'the banner is what says where you are');
  assert.equal(group($).dataset.levelKeep, undefined);
  assert.equal(box($).dataset.levelKeep, undefined);
  assert.equal($('.nav button[data-nav="agents"]').dataset.levelKeep, undefined);
  assert.equal($('.topnav button[data-nav="agents"]').dataset.levelKeep, undefined);
});

test('switching to Simple while on a child page drops the kept group', async () => {
  const { window, $, go } = await boot();
  await go('#scripts');
  const setLevel = (lv) => {
    const prev = window.document.documentElement.dataset.level;
    window.document.documentElement.dataset.level = lv;
    window.document.dispatchEvent(new window.CustomEvent('worca:level', { detail: { level: lv, previous: prev || null } }));
  };
  setLevel('advanced'); await tick();
  assert.equal(group($).dataset.levelKeep, '1', 'Advanced keeps the group with the open child');
  assert.equal($('.nav button[data-nav="scripts"]').dataset.levelKeep, '1');
  setLevel('simple'); await tick();
  assert.equal(group($).dataset.levelKeep, undefined);
  assert.equal(box($).dataset.levelKeep, undefined);
  assert.equal($('.nav button[data-nav="scripts"]').dataset.levelKeep, undefined);
  assert.equal($('.topnav button[data-nav="scripts"]').dataset.levelKeep, undefined);
  assert.equal($('#level-banner').hidden, false);
});

test('on the collapsed rail the children carry tooltips like every other icon', async () => {
  const { $ } = await boot({ seed: { [SIDEBAR_KEY]: '1' } });
  assert.equal($('.nav button[data-nav="agents"]').title, 'Agents');
  assert.equal($('.nav button[data-nav="scripts"]').title, 'Scripts');
});

// ---- CSS ----

test('the chevron turns when the group is folded and the parent tints while a child is open', () => {
  const chev = ruleBody('.nav-group[aria-expanded="false"] .nav-group-chev');
  assert.ok(chev, 'folded-chevron rule');
  assert.match(chev, /rotate\(/);
  const tint = ruleBody('.nav .nav-group.has-active');
  assert.ok(tint, 'has-active rule');
  assert.match(tint, /color:\s*var\(--ink\)/);
  assert.doesNotMatch(tint, /background:\s*var\(--ink\)/);
});

test('an open child keeps the soft tint, not the dark fill, on its icon too', () => {
  const svg = ruleBody('.nav .nav-child.active svg');
  assert.ok(svg, 'the (0,2,2) `.nav button.active svg` white stroke must be out-ranked for children');
  assert.match(svg, /stroke:\s*var\(--ink\)/);
});

test('the rail hides the parent and shows the children as icon squares even when folded', () => {
  assert.match(ruleBody('.sidebar.collapsed .nav-group'), /display:\s*none/);
  assert.match(ruleBody('.sidebar.collapsed .nav-group-children.collapsed'), /display:\s*flex/);
  assert.match(ruleBody('.sidebar.collapsed .nav-child::before,.sidebar.collapsed .nav-child::after'), /content:\s*none/);
  const active = ruleBody('.sidebar.collapsed .nav .nav-child.active');
  assert.ok(active, 'on the rail an open child looks like every other current-page square');
  assert.match(active, /background:\s*var\(--ink\)/);
});
