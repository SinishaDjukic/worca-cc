// test/ui-topnav-shell.test.mjs — the top bar (#topnav) over the pages: the shell around it, its
// box, and what app.js paints into it, driven through the REAL app.js against the REAL index.html.
// jsdom has no layout, so sizes are pinned in the stylesheet; boot() installs a width-driven
// matchMedia stub BEFORE app.js loads (the same one as test/ui-mobile-nav.test.mjs).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, '..', 'ui', 'public');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const css = readFileSync(join(root, 'style.css'), 'utf8');
const appPath = join(root, 'app.js');
const PROJECT = '/tmp/proj';
const DAY = 24 * 60 * 60 * 1000;
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await tick(); };

/** The body of the FIRST rule written exactly as `selector {…}` (house rule: no comment inside a rule body). */
function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp('(?:^|[\\s,}])' + escaped + '\\s*\\{([^}]*)\\}'));
  return m ? m[1].replace(/\s+/g, ' ') : null;
}

/** Only max-width / min-width queries can match; colour-scheme and reduced-motion stay false. */
function mediaStub(width) {
  let w = width;
  const lists = [];
  const evalQ = (q) => {
    const max = /max-width:\s*(\d+)px/.exec(q);
    const min = /min-width:\s*(\d+)px/.exec(q);
    if (!max && !min) return false;
    return (!max || w <= Number(max[1])) && (!min || w >= Number(min[1]));
  };
  const matchMedia = (q) => {
    const l = {
      media: q, matches: evalQ(q), fns: [],
      addEventListener(t, fn) { if (t === 'change') this.fns.push(fn); },
      removeEventListener() {}, addListener(fn) { this.fns.push(fn); }, removeListener() {},
    };
    lists.push(l);
    return l;
  };
  const resize = (next) => {
    w = next;
    for (const l of lists) {
      const m = evalQ(l.media);
      if (m !== l.matches) { l.matches = m; for (const fn of l.fns) fn({ matches: m, media: l.media }); }
    }
  };
  return { matchMedia, resize };
}

/** `hash` is the address the page loads on (a cold deep link); `resize(px)` crosses the tiers. */
async function boot({ width = 1280, seed = {}, hash = '' } = {}) {
  const dom = trackDom(new JSDOM(html, { url: `http://localhost:4317/${hash ? `#${hash}` : ''}` }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.__budgetTickMs = DAY;   // the budget ticker must not repaint a later test's DOM
  const media = mediaStub(width);
  window.matchMedia = media.matchMedia;
  let lastWs = null;
  window.WebSocket = class { constructor() { this.readyState = 1; this._l = {}; lastWs = this; }
    send() {} close() {} addEventListener(t, fn) { (this._l[t] ||= []).push(fn); } };
  window.fetch = (u) => {
    const url = String(u);
    const json = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
    if (url.includes('/api/projects')) return json({ projects: [{ name: 'proj', path: PROJECT, exists: true }] });
    if (url.includes('/api/stats')) {
      return json({
        range: 'month', bucket: 'day', windowStartMs: Date.now() - 30 * DAY, windowEndMs: Date.now(),
        totals: { spentUsd: 0, pipelineSpendUsd: 0, ask: { spendUsd: 0, sessions: 0, turns: 0 },
          workedMs: 0, runs: 0, finished: 0, stopped: 0, failed: 0, paused: 0, running: 0, prsOpened: 0, prsMerged: 0 },
        prev: null, budget: null, series: [],
      });
    }
    return json({ config: { steps: {}, customModels: [] }, models: [], efforts: [], pipelines: 0, projects: 0, workspaces: 0 });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  window.localStorage.clear();
  for (const [k, v] of Object.entries(seed)) window.localStorage.setItem(k, v);
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await tick();
  lastWs._l.open?.forEach((fn) => fn());
  const recv = (obj) => lastWs._l.message.forEach((fn) => fn({ data: JSON.stringify(obj) }));
  const $ = (s) => window.document.querySelector(s);
  const click = (s) => (typeof s === 'string' ? $(s) : s)
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  // The assignment routes through app.js's one hashchange listener (jsdom delivers it on a timer).
  const go = async (hash) => { window.location.hash = hash; await settle(); };
  return { window, $, click, recv, go, resize: media.resize };
}

const live = (runId, extra = {}) => ({
  runId, title: runId, projectDir: PROJECT, status: 'running', kind: 'run',
  startedAt: '10:00:00', pendingQuestion: null, ...extra,
});

// ---- the shell ----

test('the shell: .app holds the sidebar and .main-col; .main-col stacks #topnav over main.main', () => {
  const doc = new JSDOM(html).window.document;
  const col = doc.querySelector('.app > .main-col');
  assert.ok(col, '.main-col is a child of .app');
  assert.ok(col.previousElementSibling.matches('aside.sidebar#side-rail'), 'right after the sidebar');
  assert.deepEqual([...col.children].map((n) => `${n.tagName.toLowerCase()}.${n.className}`), ['header.topnav', 'main.main'],
    'the top bar, then the one scroll container');
  assert.equal(col.firstElementChild.id, 'topnav');
  assert.deepEqual([...doc.querySelector('#topnav').children].map((n) => n.className), ['topnav-l', 'topnav-c', 'topnav-r']);
  const title = doc.getElementById('topnav-title');
  assert.equal(title.tagName, 'H1');
  assert.ok(title.classList.contains('topnav-title'));
  assert.equal(title.parentElement.className, 'topnav-l');
});

test('the top bar box: a 48px white grid with a hairline; .main-col is a flex column and .main stays the scroll container', () => {
  assert.match(ruleBody('.main-col'), /flex:1;min-width:0;height:100vh;display:flex;flex-direction:column;/);
  const main = ruleBody('.main');
  assert.match(main, /flex:1;/);
  assert.match(main, /min-height:0;/, 'or the column grows past the window and nothing scrolls');
  assert.match(main, /overflow-y:auto;/, '.main is still the one scroll container (the sticky run headers pin to it)');
  const bar = ruleBody('.topnav');
  for (const d of ['flex:none;', 'height:48px;', 'display:grid;', 'grid-template-columns:minmax(32px,1fr) minmax(240px,440px) minmax(max-content,1fr);',
    'align-items:center;', 'gap:12px;', 'padding:0 16px 0 12px;', 'background:var(--panel);', 'border-bottom:1px solid var(--line);']) {
    assert.ok(bar.includes(d), `.topnav has ${d}`);
  }
  // The side slots keep a floor: with 0 minimums the 440px search grew first and Activity + New run spilled left under
  // the search pill (Chrome hit-tested the search at 820 rail, 1100, 1280 + terminal), and with the right floor alone the
  // left track fell to 0 and the search covered the collapse toggle (1280 + terminal).
  assert.match(bar, /grid-template-columns:[^;]* minmax\(max-content,1fr\);/, 'the right track never goes below its content');
  assert.match(bar, /grid-template-columns:minmax\(32px,1fr\) /, 'the left track keeps the 32px collapse toggle');
  assert.match(ruleBody('.side-toggle'), /flex:none;width:32px;/, 'the floor is the toggle\'s width');
  const all = [...css.matchAll(/(?:^|[\s,}])\.topnav\s*\{([^}]*)\}/g)].map((m) => m[1]);
  assert.ok(all.length >= 1);
  for (const body of all.slice(1)) assert.doesNotMatch(body, /height/, 'no tier changes the bar\'s height');
  assert.match(ruleBody('.topnav-title'), /font-size:14px;font-weight:600;/);
  assert.match(ruleBody('.topnav-title'), /overflow:hidden;text-overflow:ellipsis;/);
  // One contiguous block right after the .main group (P2 and P3 append after it).
  const at = (s) => css.indexOf(s);
  assert.ok(at('body.view-workspaces .main{') < at('.main-col{') && at('.main-col{') < at('.topbar{'), 'the block follows the .main group');
  assert.equal(ruleBody('.rd-bar,.hd-bar').includes('position:sticky;top:0;'), true, 'the run headers still pin to the top of .main');
});

// ---- the collapse toggle ----

test('the collapse toggle sits in the bar\'s left slot, before the page name: a static panel icon (line while open, filled block on the rail), no chevron, no mark', () => {
  const doc = new JSDOM(html).window.document;
  const btn = doc.getElementById('side-toggle');
  assert.equal(btn.parentElement.className, 'topnav-l');
  assert.equal(btn.nextElementSibling.id, 'topnav-title');
  assert.equal(doc.querySelector('.brand #side-toggle, .sidebar #side-toggle'), null, 'it left the logo row');
  assert.equal(btn.getAttribute('aria-controls'), 'side-rail');
  assert.equal(btn.querySelector('svg').innerHTML, '<rect x="2.5" y="4.5" width="19" height="15" rx="4.5"></rect><path class="side-toggle-line" d="M7.25 9v6"></path><rect class="side-toggle-fill" x="6" y="8.25" width="4" height="7.5" rx="1.5" fill="currentColor" stroke="none"></rect>');
  assert.equal(btn.querySelector('svg').getAttribute('stroke-width'), '1.5');
  assert.equal(doc.querySelector('.side-toggle-mark, #side-toggle .chev'), null);
  assert.match(ruleBody('.side-toggle svg'), /width:20px;height:20px;/);
  // The state lives in CSS off aria-expanded, so the markup never changes.
  assert.equal(ruleBody('.side-toggle .side-toggle-fill,.side-toggle[aria-expanded="false"] .side-toggle-line'), 'display:none;');
  assert.equal(ruleBody('.side-toggle[aria-expanded="false"] .side-toggle-fill'), 'display:inline;');
  for (const sel of ['.sidebar .side-toggle', '.sidebar.collapsed .side-toggle', '.brand .side-toggle-mark']) {
    assert.equal(ruleBody(sel), null, `${sel} is gone`);
  }
});

test('the toggle is desktop only: hidden from 1080px down (the tablet rail is forced, phones use the hamburger)', () => {
  const tiers = [...css.matchAll(/@media \(max-width:1080px\)\{\n([\s\S]*?)\n\}/g)].map((m) => m[1]);
  assert.ok(tiers.some((b) => /^\s*\.side-toggle\{display:none;\}$/m.test(b)), 'a 1080px tier rule hides .side-toggle');
});

test('clicking the toggle in the bar collapses and expands the sidebar: aria, label, title and the stored key; the icon never changes', async () => {
  const { window, $, click } = await boot();
  const btn = $('#side-toggle');
  const icon = btn.innerHTML;
  click(btn);
  assert.ok($('.sidebar').classList.contains('collapsed'));
  assert.deepEqual([btn.getAttribute('aria-expanded'), btn.getAttribute('aria-label'), btn.title], ['false', 'Expand menu', 'Expand menu']);
  assert.equal(window.localStorage.getItem('worca-cc.sidebar.collapsed'), '1');
  assert.equal(btn.innerHTML, icon, 'no chevron rewrite');
  click(btn);
  assert.equal($('.sidebar').classList.contains('collapsed'), false);
  assert.deepEqual([btn.getAttribute('aria-expanded'), btn.getAttribute('aria-label'), btn.title], ['true', 'Collapse menu', 'Collapse menu']);
  assert.equal(window.localStorage.getItem('worca-cc.sidebar.collapsed'), '0');
  assert.equal(btn.innerHTML, icon);
});

test('resizing across 1080px and 760px: the tiers never touch the stored preference, and back on desktop the toggle reads it again', async () => {
  const tiers = [...css.matchAll(/@media \(max-width:1080px\)\{\n([\s\S]*?)\n\}/g)].map((m) => m[1]);
  assert.ok(tiers.every((b) => !/\.mbar-menu/.test(b)), 'the rail tier never shows the hamburger (only the 760px block does)');
  const KEY = 'worca-cc.sidebar.collapsed';
  await checkRows([
    { name: 'collapsed', seed: '1', desktop: ['false', 'Expand menu', 'Expand menu'], railOnDesktop: true },
    { name: 'expanded', seed: '0', desktop: ['true', 'Collapse menu', 'Collapse menu'], railOnDesktop: false },
  ].map((row) => ({ name: `the sidebar ${row.name}`, run: async () => {
    const { window, $, click, resize } = await boot({ width: 1280, seed: { [KEY]: row.seed } });
    const btn = $('#side-toggle');
    const aria = () => [btn.getAttribute('aria-expanded'), btn.getAttribute('aria-label'), btn.title];
    assert.deepEqual(aria(), row.desktop, 'desktop: the stored preference');
    resize(900);
    assert.ok($('.sidebar').classList.contains('collapsed'), 'the rail tier forces the rail');
    assert.deepEqual(aria(), ['false', 'Expand menu', 'Expand menu'], 'hidden there, and still true to what is on screen');
    resize(390);
    assert.equal($('.sidebar').classList.contains('collapsed'), false, 'the phone drawer is the full column');
    resize(1080);
    assert.ok($('.sidebar').classList.contains('collapsed'), '1080px is still the rail tier');
    resize(1280);
    assert.equal($('.sidebar').classList.contains('collapsed'), row.railOnDesktop);
    assert.deepEqual(aria(), row.desktop, 'back on desktop: the toggle reads the preference again');
    assert.equal(window.localStorage.getItem(KEY), row.seed, 'no tier wrote the preference');
    click(btn);
    assert.equal($('.sidebar').classList.contains('collapsed'), !row.railOnDesktop, 'and it still toggles');
  } })));
});

// ---- New run ----

test('New run: an ink pill in the bar\'s right slot, shown at every level, never a nav row', () => {
  const doc = new JSDOM(html).window.document;
  const btn = doc.getElementById('topnav-new');
  assert.equal(btn.tagName, 'BUTTON');
  assert.equal(btn.type, 'button');
  assert.equal(btn.parentElement.className, 'topnav-r');
  assert.ok(btn.classList.contains('topnav-new'));
  assert.equal(btn.dataset.minLevel, 'simple', 'visible at every interface mode');
  assert.equal(btn.hasAttribute('data-nav'), false, 'the router never lights it as the open page');
  assert.equal(btn.querySelector('.topnav-new-label').textContent, 'New run');
  assert.equal(btn.querySelector('svg path').getAttribute('d'), 'M6 4.5v15a1 1 0 0 0 1.5.9l12-7.5a1 1 0 0 0 0-1.8l-12-7.5A1 1 0 0 0 6 4.5Z', 'the play icon');
  const pill = ruleBody('.topnav-new');
  for (const d of ['height:32px;', 'border-radius:999px;', 'background:var(--ink);', 'color:var(--on-ink);']) assert.ok(pill.includes(d), `.topnav-new has ${d}`);
  assert.match(ruleBody('.topnav-new:focus-visible'), /outline:2px solid var\(--ink\);/);
});

test('New run opens #new from any page, a started run\'s page included, and is never marked current', async () => {
  const { window, $, click, go, recv } = await boot();
  recv({ type: 'hello', runs: [live('r1')] });
  await checkRows([
    ['stats', 'Statistics'], ['running/r1', 'Runs'], ['new', 'New run'],
  ].map(([from, fromTitle]) => ({ name: `from #${from}`, run: async () => {
    await go(from);
    assert.equal($('#topnav-title').textContent, fromTitle, 'precondition');
    click('#topnav-new');
    await settle();
    assert.equal(window.location.hash, '#new');
    assert.equal($('[data-view="new"]').classList.contains('hidden'), false, 'the New run page shows');
    assert.equal($('#topnav-title').textContent, 'New run');
    assert.equal($('#topnav-new').hasAttribute('aria-current'), false);
    assert.equal($('#topnav-new').classList.contains('active'), false);
  } })));
});

test('the sidebar has no New run row: 14 pages, Runs first; New run is the top bar\'s button', () => {
  const doc = new JSDOM(html).window.document;
  assert.equal(doc.querySelector('.nav [data-nav="new"]'), null);
  assert.equal(doc.querySelectorAll('.nav button[data-nav]').length, 14);
  assert.equal(doc.querySelector('.nav').firstElementChild.dataset.nav, 'runs');
});

// ---- phones (<=760px) ----

test('phones: no #mbar; the hamburger (with its needs-you dot) is the top bar\'s first control; New run turns icon-only', () => {
  const doc = new JSDOM(html).window.document;
  for (const sel of ['#mbar', '#mbar-title', '.mbar', '.mbar-mark']) assert.equal(doc.querySelector(sel), null, `${sel} is gone`);
  const menu = doc.getElementById('mbar-menu');
  assert.equal(menu.parentElement.className, 'topnav-l');
  assert.equal(menu.parentElement.firstElementChild, menu, 'first in the left slot, where the collapse toggle sits on desktop');
  assert.equal(menu.getAttribute('aria-controls'), 'side-rail');
  assert.equal(doc.getElementById('mbar-rollup').parentElement, menu);
  assert.equal(doc.getElementById('topnav-new').getAttribute('aria-label'), 'New run', 'its name when the label is hidden');
  for (const sel of ['.mbar', '.mbar-mark', '.mbar-title']) assert.equal(ruleBody(sel), null, `${sel} has no rule left`);
  assert.match(css, /\n\.mbar-menu,\.nav-scrim,\.side-close\{display:none;\}/, 'the hamburger is hidden above 760px');
  const phone = css.slice(css.indexOf('.mbar-menu,.nav-scrim,.side-close{display:none;}'));
  const block = phone.slice(phone.indexOf('@media (max-width:760px){'), phone.indexOf('\n}\n', phone.indexOf('@media (max-width:760px){')));
  assert.match(block, /\n {2}\.mbar-menu\{position:relative;display:flex;/);
  assert.match(block, /\n {2}\.topnav\{grid-template-columns:minmax\(0,1fr\) auto auto;gap:8px;\}/);
  assert.match(block, /\n {2}\.topnav-new\{width:32px;padding:0;justify-content:center;\}/);
  assert.match(block, /\n {2}\.topnav-new-label\{display:none;\}/);
  assert.doesNotMatch(block, /\n {2}\.(app|main)\{/, 'the column, not a phone override, stacks the bar over the page');
});

test('phones: the drawer makes the page and the top bar inert, and hands focus back to the hamburger', async () => {
  const { window, $, click } = await boot({ width: 390 });
  click('#mbar-menu');
  assert.ok(window.document.body.classList.contains('nav-open'));
  assert.ok($('#topnav').hasAttribute('inert'), 'the bar behind the drawer is inert');
  assert.ok($('.main').hasAttribute('inert'));
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(window.document.body.classList.contains('nav-open'), false);
  assert.equal($('#topnav').hasAttribute('inert'), false);
  assert.equal(window.document.activeElement, $('#mbar-menu'));
});

test('phones: widening past 760px with the drawer open puts it away, and the top bar and the page are live again', async () => {
  await checkRows([900, 1280].map((width) => ({ name: `390px → ${width}px`, run: async () => {
    const { window, $, click, resize } = await boot({ width: 390 });
    click('#mbar-menu');
    assert.ok($('#topnav').hasAttribute('inert'), 'precondition: the drawer is open');
    resize(width);
    assert.equal(window.document.body.classList.contains('nav-open'), false);
    assert.equal($('#topnav').hasAttribute('inert'), false, 'the top bar is not left inert');
    assert.equal($('.main').hasAttribute('inert'), false, 'the page is not left inert');
    assert.equal($('#mbar-menu').getAttribute('aria-expanded'), 'false');
  } })));
});

// ---- the page name ----

test('the pages carry no title of their own: the top bar\'s h1 is the page name; only entity names (a run, a project, a workspace) stay h1', () => {
  const doc = new JSDOM(html).window.document;
  const roots = [doc, ...[...doc.querySelectorAll('template')].map((t) => t.content)];
  const h1s = roots.flatMap((r) => [...r.querySelectorAll('h1')]);
  assert.deepEqual(h1s.filter((h) => !h.matches('#topnav-title, .rd-page-title, .hd-title, .pd-title')).map((h) => h.textContent), [],
    'a page h1 is left (a .topbar or .runs-head title)');
  assert.equal(doc.querySelectorAll('.topbar h1, .runs-head h1').length, 0);
  for (const bar of doc.querySelectorAll('.topbar')) {
    assert.ok(bar.textContent.trim() || bar.querySelector('button, a, select'), `an empty .topbar is left in ${bar.closest('[data-view]')?.dataset.view}`);
  }
  assert.equal(doc.querySelector('[data-view="composer"] .topbar'), null, 'the Composer\'s title-only bar is gone');
  assert.ok(doc.querySelector('[data-view="new"] .topbar .sub'), 'the sub lines stay');
  assert.equal(ruleBody('.topbar h1'), null);
  assert.equal(ruleBody('.runs-head h1'), null);
  assert.match(ruleBody('.topbar'), /align-items:center;/, 'a .sub-only left column centres against the page buttons');
  assert.match(ruleBody('.runs-head'), /justify-content:flex-end;/, 'the Runs list tools keep the right edge');
});

test('#topnav-title names the open page on every route', async () => {
  const { $, go, recv } = await boot();
  recv({ type: 'hello', runs: [live('r1')] });
  await settle();
  assert.equal($('#topnav-title').textContent, 'New run', 'the boot page');
  await checkRows([
    ['stats', 'Statistics'], ['runs', 'Runs'], ['running/r1', 'Runs'], ['history/proj-00000001/p1', 'Runs'],
    ['settings', 'Settings'], ['settings/memory', 'Settings'], ['getting-started', 'Getting started'],
    ['workspace-create', 'New workspace'], ['agent-create', 'New agent'], ['agents', 'Agents'],
    ['marketplace', 'Marketplace'], ['projects', 'Projects'], ['new', 'New run'],
  ].map(([hash, title]) => ({ name: `#${hash} → ${title}`, run: async () => {
    await go(hash);
    assert.equal($('#topnav-title').textContent, title);
  } })));
});

test('a cold deep link to a run reads "Runs" at once, before the runs or History have loaded', async () => {
  await checkRows(['running/r9', 'running/r9/details/logs', 'history/proj-00000001/p9'].map((hash) => ({ name: `#${hash}`, run: async () => {
    const { $ } = await boot({ hash });   // no hello: the server has told the page about no run yet
    assert.equal($('#topnav-title').textContent, 'Runs');
  } })));
});
