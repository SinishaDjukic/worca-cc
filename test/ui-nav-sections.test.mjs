// test/ui-nav-sections.test.mjs — sidebar is grouped: New-pipeline CTA, then
// Activity / Build / Manage sections, Settings pinned at the bottom behind a
// divider. Topnav mirrors the order with thin separators. Markup+CSS only —
// app.js wires nav via `.nav button[data-nav]`, so headers are divs and
// Settings stays inside <nav class="nav">.
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
    'Build', 'composer', 'agents',
    'Manage', 'projects', 'workspaces',
    'nav-sep', 'settings',
  ]);
});

// guardrails/models/plugins moved into Settings as tabs, so 12 -> 9.
test('grouping adds no buttons and no anchors (9-button invariant holds)', () => {
  assert.equal((sidebar().match(/<button type="button"/g) || []).length, 9);
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
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
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

// ---- Task 2: sidebar CSS ----
// Same anchored ruleBody idiom as test/ui-pinned-sidebar.test.mjs.
function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp('(?:^|[\\s,}])' + escaped + '\\s*\\{([^}]*)\\}'));
  return m ? m[1] : null;
}

test('.nav fills the sidebar column so margin-top:auto can pin Settings', () => {
  const nav = ruleBody('.nav');
  assert.ok(nav, '.nav rule must exist');
  assert.match(nav, /flex:\s*1 1 auto/);
});

test('.nav-sect is a quiet sentence-case label, not a button lookalike', () => {
  const sect = ruleBody('.nav-sect');
  assert.ok(sect, '.nav-sect rule must exist');
  // The heading reads exactly as the markup writes it — "Activity", not
  // "ACTIVITY". `text-transform:none` has to be STATED, not merely absent: the
  // rule is the only place a future caps revert would land.
  assert.match(sect, /text-transform:\s*none/);
  assert.doesNotMatch(sect, /text-transform:\s*uppercase/);
  assert.match(sect, /letter-spacing/);
  assert.match(sect, /color:\s*var\(--ink-3\)/);
});

test('items sit tight; the air goes BETWEEN groups, not inside them', () => {
  // Measured in Chrome: adjacent item pills are 2px apart (.nav gap), while a
  // heading's own box adds 24px above it and 5px below. So item->item is 2px,
  // item->next heading is 26px, and heading->its first item is 7px. Flip the
  // heading's padding and the groups read as belonging to the row above them.
  assert.match(ruleBody('.nav'), /gap:\s*2px/);
  assert.match(ruleBody('.nav button'), /padding:\s*8px 13px/);
  const sect = ruleBody('.nav-sect');
  const pad = sect.match(/padding:\s*(\d+)px 13px (\d+)px/);
  assert.ok(pad, '.nav-sect needs an explicit top/bottom padding pair');
  const [top, bottom] = [Number(pad[1]), Number(pad[2])];
  assert.ok(top >= 3 * bottom,
    `the gap above a heading (${top}px) must dwarf the one below it (${bottom}px)`);
});

test('.nav-sep pins the tail: pushes to the bottom and draws the divider', () => {
  const sep = ruleBody('.nav-sep');
  assert.ok(sep, '.nav-sep rule must exist');
  assert.match(sep, /margin-top:\s*auto/);
  assert.match(sep, /border-top:\s*1px solid var\(--line\)/);
});

test('CTA is outlined at rest and compensates the border in its padding', () => {
  const cta = ruleBody('.nav button.nav-cta');
  assert.ok(cta, '.nav button.nav-cta rule must exist');
  assert.match(cta, /border:\s*1\.5px solid var\(--ink\)/);
  // 6.5 + the 1.5px border = the 8px the plain rows pad with, so the CTA does
  // not stand taller than the list it heads.
  assert.match(cta, /padding:\s*6\.5px 11\.5px/);
  const active = ruleBody('.nav button.nav-cta.active');
  assert.ok(active, 'active CTA keeps the dark current-view fill');
  assert.match(active, /background:\s*var\(--ink\)/);
});

// ---- Task 3: compact topnav mirrors the grouping ----

test('topnav order mirrors the sidebar, with a separator per group boundary', () => {
  const tokens = [...topnav().matchAll(/data-nav="([a-z]+)"|class="(topnav-sep)"/g)]
    .map((m) => m[1] || m[2]);
  assert.deepEqual(tokens, [
    'new', 'topnav-sep',
    'running', 'history', 'stats', 'topnav-sep',
    'composer', 'agents', 'topnav-sep',
    'projects', 'workspaces', 'topnav-sep',
    'settings',
  ]);
});

test('separators are spans (button count and settings-text invariants hold)', () => {
  assert.equal((topnav().match(/<button type="button"/g) || []).length, 9);
  assert.equal((topnav().match(/<span class="topnav-sep" aria-hidden="true"><\/span>/g) || []).length, 4);
  assert.match(topnav(), /data-nav="settings">Settings<\/button>/);
});

test('.topnav-sep is a hairline that cannot flex-grow', () => {
  const sep = ruleBody('.topnav-sep');
  assert.ok(sep, '.topnav-sep rule must exist');
  assert.match(sep, /flex:\s*0 0 1px/);
  assert.match(sep, /background:\s*var\(--line-2\)/);
  // Placement: the rule must live inside the same media block that shows the topnav.
  const media = [...css.matchAll(/@media[^{]*\{([\s\S]*?)\n\}/g)].map((m) => m[1]);
  const topnavBlock = media.find((b) => /\.topnav\{[^}]*display:flex/.test(b));
  assert.ok(topnavBlock, 'media block that shows .topnav must exist');
  assert.match(topnavBlock, /\.topnav-sep\{/, '.topnav-sep must be defined inside that media block');
});

test('the toggle hangs off the spend card exactly as Settings hangs off the divider', () => {
  // Measured in Chrome, expanded: 10px above Settings, 10px below it, 10px above
  // the toggle, 10px below it. Three declarations produce those four gaps —
  // .side-foot's padding-top and gap, and .sidebar's padding-bottom — so they
  // are asserted as one number rather than three literals.
  const foot = ruleBody('.side-foot');
  const padTop = Number(foot.match(/padding-top:\s*(\d+)px/)[1]);
  const gap = Number(foot.match(/gap:\s*(\d+)px/)[1]);
  const bottom = Number(ruleBody('.sidebar').match(/padding:\s*\d+px \d+px (\d+)px/)[1]);
  assert.equal(gap, padTop, 'the gap above the toggle must match the one above Settings');
  assert.equal(bottom, padTop, 'the rail must end the same distance below the toggle');
  // Collapsed, the same four 10px gaps are rebuilt from different parts: the
  // foot's 1px border-top eats into its padding, and the divider's margin sits
  // on top of the 6px collapsed .nav gap. Measured in Chrome: 10/10/10/10.
  const cFoot = ruleBody('.sidebar.collapsed .side-foot');
  const cSep = ruleBody('.sidebar.collapsed .nav-sep');
  const cNav = ruleBody('.sidebar.collapsed .nav');
  assert.equal(Number(cFoot.match(/padding-top:\s*(\d+)px/)[1]) + 1, padTop,
    'foot padding-top + its 1px border must equal the expanded gap');
  assert.equal(Number(cFoot.match(/gap:\s*(\d+)px/)[1]), padTop);
  assert.equal(Number(cSep.match(/margin-bottom:\s*(\d+)px/)[1])
    + Number(cNav.match(/gap:\s*(\d+)px/)[1]), padTop,
    'divider margin + the rail nav gap must equal the expanded gap');
  assert.equal(Number(ruleBody('.sidebar.collapsed')
    .match(/padding:\s*\d+px \d+px (\d+)px/)[1]), padTop);
});

test('Settings sits the same distance from the divider as from the spend card', () => {
  // Measured in Chrome: the divider's 8px margin-bottom plus the 2px `.nav` gap
  // is the 10px the foot pads with, so the row is centred between the two edges
  // it hangs from. Change one number and the row visibly belongs to the half it
  // moved toward.
  const foot = ruleBody('.side-foot');
  assert.ok(foot, '.side-foot rule must exist');
  const pad = foot.match(/padding-top:\s*(\d+)px/);
  assert.ok(pad, 'footer needs padding-top so Settings does not sit flush on the spend card');
  const sep = ruleBody('.nav-sep');
  const below = sep.match(/margin-bottom:\s*(\d+)px/);
  assert.ok(below, '.nav-sep must own the gap under the divider');
  const gap = ruleBody('.nav').match(/gap:\s*(\d+)px/);
  assert.equal(Number(below[1]) + Number(gap[1]), Number(pad[1]),
    'divider gap + .nav gap must equal the footer padding');
});

test('compact topnav wraps instead of spilling past its rounded box', () => {
  const media = [...css.matchAll(/@media[^{]*\{([\s\S]*?)\n\}/g)].map((m) => m[1]);
  const topnavBlock = media.find((b) => /\.topnav\{[^}]*display:flex/.test(b));
  assert.ok(topnavBlock, 'media block that shows .topnav must exist');
  assert.match(topnavBlock, /\.topnav\{[^}]*flex-wrap:\s*wrap/,
    '9 buttons cannot shrink below min-content; without wrap they overflow the pill below ~965px');
});
