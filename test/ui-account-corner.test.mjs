// test/ui-account-corner.test.mjs — the account corner at the foot of the sidebar and the menu it
// opens, booted for real (index.html + app.js under jsdom): the menu's order and roles, opening and
// closing (outside click, Escape, a route), the keyboard, the Interface mode side menu, the spend
// card's free-request row, and the stylesheet rules that keep the corner whole on the rail.
// Who the corner names is test/ui-attribution.test.mjs; the spend ring and card are
// test/ui-budget-indicator.test.mjs; the away row is test/ui-night-mode.test.mjs.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { minLevelFor } from '../ui/public/ui-level.mjs';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
const trackDom = useDomRelease(afterEach);
const DAY = 86400000;
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await tick(); };

const BUDGET = () => ({ totalLimitUsd: 50, resetPeriod: 'monthly', windowStartMs: Date.now() - 3 * DAY, windowEndMs: Date.now() + 4 * DAY,
  msUntilReset: 4 * DAY, windowSpendUsd: 20, blocked: false });
const FREE = { enabled: true, known: true, limit: 50, remaining: 4, resetAt: new Date(Date.now() + 3 * 3600000).toISOString(), models: [] };

// width: a viewport (the nav tiers read `(max-width: …)` queries); hover: a mouse (`(hover: hover)` matches);
// budget: false makes GET /api/budget fail (no snapshot ever arrives).
async function boot({ whoami = { name: 'ada.lovelace@acme.dev', source: 'access', shared: true }, free = FREE, width = null, hover = false, budget = true, levelSave = 'ok' } = {}) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/', pretendToBeVisual: true }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  if (width || hover) {
    const matches = (q) => {
      if (/\(hover:\s*hover\)/.test(q)) return hover;
      const m = /max-width:\s*(\d+)px/.exec(q); return !!m && !!width && width <= Number(m[1]);
    };
    window.matchMedia = (q) => ({ media: q, matches: matches(q), addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  }
  window.__budgetTickMs = DAY;
  window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
  const posts = [];
  window.fetch = (u, opts = {}) => {
    const url = String(u);
    const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
    if ((opts.method || 'GET').toUpperCase() === 'POST') {
      const body = JSON.parse(opts.body);
      posts.push({ url, body });
      // levelSave: 'ok', or the error the server answers a {uiLevel} save with.
      if (body.uiLevel && levelSave !== 'ok') return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: levelSave }) });
      return ok(body);
    }
    if (url.endsWith('/api/whoami')) return ok(whoami);
    if (url.includes('/api/budget')) return budget ? ok(BUDGET()) : Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'boom' }) });
    if (url.includes('/api/openrouter/free-daily')) return ok(free || { enabled: false });
    if (url.includes('/api/projects')) return ok({ projects: [] });
    return ok({ config: { steps: {}, customModels: [] }, models: [], efforts: [], pipelines: 0, projects: 0, workspaces: 0 });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* keep */ }
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await settle();
  const doc = window.document;
  const $ = (id) => doc.getElementById(id);
  const click = (el, detail = 1) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, detail }));
  // Keys go where focus is, as in a browser (the menu reads its arrows on itself; Escape is the document's).
  const key = (k) => (doc.activeElement || doc.body).dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  return { window, doc, $, click, key, posts };
}

test('the account menu: the corner opens it upward; a click outside, Escape and a route close it', async () => {
  const { window, doc, $, click, key } = await boot();
  await checkRows([
    { name: 'the corner opens it (placed in px, aria-expanded) and a second click closes it', run: () => {
      assert.deepEqual([$('side-acct').getAttribute('aria-haspopup'), $('side-acct').getAttribute('aria-controls')], ['menu', 'acct-menu']);
      assert.equal($('acct-menu').getAttribute('role'), 'menu');
      assert.equal($('acct-menu').hidden, true);
      click($('side-acct'));
      assert.equal($('acct-menu').hidden, false);
      assert.equal($('side-acct').getAttribute('aria-expanded'), 'true');
      assert.match($('acct-menu').style.top, /^-?\d+(\.\d+)?px$/, 'placed by side-flyout');
      click($('side-acct'));
      assert.equal($('acct-menu').hidden, true);
      assert.equal($('side-acct').getAttribute('aria-expanded'), 'false');
    } },
    { name: 'a click outside closes it; Escape closes it and hands focus back to the corner', run: () => {
      click($('side-acct'));
      click(doc.querySelector('.main'));
      assert.equal($('acct-menu').hidden, true);
      click($('side-acct'));
      key('Escape');
      assert.equal($('acct-menu').hidden, true);
      assert.equal(doc.activeElement, $('side-acct'));
    } },
    { name: 'any route (here: back to Runs) puts it away', run: async () => {
      click($('side-acct'));
      window.location.hash = 'runs';
      window.dispatchEvent(new window.HashChangeEvent('hashchange'));
      await settle();
      assert.equal($('acct-menu').hidden, true);
    } },
  ]);
});

test('stylesheet: the rail keeps the avatar, ring and dot; the popups are fixed; the ring has no level gate', () => {
  const rule = (sel) => { const m = css.match(new RegExp(`(?:^|[\\s,}])${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`)); return m ? m[1] : null; };
  assert.match(rule('.sidebar.collapsed .acct-name,.sidebar.collapsed .acct-updown') || '', /display:none/, 'the rail drops the name and the glyph');
  assert.doesNotMatch(css, /\.sidebar\.collapsed [^{]*\.acct-(?:ring|ava|dot)[^{]*\{[^}]*display:none/, 'never the avatar, the ring or the dot');
  assert.match(rule('.acct[data-spend="ok"] .acct-ring,.acct[data-spend="warn"] .acct-ring,.acct[data-spend="over"] .acct-ring') || '', /display:block/);
  assert.match(rule('.nav-fly') || '', /position:fixed/, 'the menus are .nav-fly popups');
  assert.match(rule('.nav-fly.acct-menu') || '', /width:258px;/);
  assert.match(rule('.nav-fly.lvl-menu') || '', /width:236px;/);
  assert.match(rule('.mi') || '', /flex:none;/, 'a short window scrolls the menu; its rows never squeeze below 31px');
  assert.doesNotMatch(css, /\[data-level[^\]]*\][^{]*\.acct/, 'no interface-mode rule reaches the corner');
});

test('a mouse passing over the corner does not open the menu: it opens on a click', async () => {
  const { window, $, click } = await boot({ hover: true });
  $('side-acct').dispatchEvent(new window.MouseEvent('mouseenter'));
  assert.equal($('acct-menu').hidden, true, 'hover: false — the menu is never a hover popup');
  click($('side-acct'));
  assert.equal($('acct-menu').hidden, false, 'a click opens it');
});

test('the spend card\'s free-request row: amber when low, opens the Providers page and closes the menu; none when OpenRouter is off', async () => {
  let ctx = await boot();
  const row = ctx.doc.querySelector('#acct-spend .mc-free');
  assert.deepEqual([row.querySelector('.mi-lbl').textContent, row.querySelector('.mi-val').textContent, row.dataset.tone], ['Free requests today', '4 / 50', 'warn']);
  ctx.click(ctx.$('side-acct'));
  ctx.click(row);
  await settle();
  assert.equal(ctx.window.location.hash, '#providers');
  assert.equal(ctx.$('acct-menu').hidden, true);
  ctx = await boot({ free: null });
  assert.equal(ctx.doc.querySelector('#acct-spend .mc-free'), null);
  assert.equal(ctx.doc.querySelector('#acct-spend .spend-card .mc-title').textContent.startsWith('Spend in '), true);
});

test('the free-request row paints on its own answer: /api/budget fails, the card is that row alone', async () => {
  const { doc, $ } = await boot({ budget: false });
  assert.equal($('acct-spend').hidden, false, 'paintFreeDaily repaints the card, not only paintBudget');
  assert.equal(doc.querySelector('#acct-spend .mc-title'), null, 'no snapshot: no spend figures');
  assert.equal(doc.querySelector('#acct-spend .mc-free .mi-val').textContent, '4 / 50');
});

test('the account menu: its order and roles (spend card · Signed in as · Interface mode · Settings · away row last), and the keyboard', async () => {
  const { doc, $, click, key } = await boot();
  await checkRows([
    { name: 'order and roles', run: () => {
      const menu = $('acct-menu');
      assert.deepEqual([...menu.children].map((el) => el.id || el.className),
        ['acct-spend', 'acct-id', 'menu-sep', 'acct-lvl', 'acct-settings', 'menu-sep', 'acct-away']);
      assert.deepEqual([...menu.querySelectorAll('[role^="menuitem"]')].map((b) => b.id || b.className),
        ['mc-btn', 'mi mc-free', 'acct-lvl', 'acct-settings', 'acct-away'], 'Details, the free row, then the three rows');
      assert.deepEqual([...menu.querySelectorAll('.menu-sep')].map((s) => s.getAttribute('role')), ['separator', 'separator']);
      assert.deepEqual([$('acct-lvl').getAttribute('aria-haspopup'), $('acct-lvl').getAttribute('aria-controls'), $('acct-lvl').getAttribute('aria-expanded')],
        ['menu', 'lvl-menu', 'false']);
    } },
    { name: 'a keyboard open lands on the first item; the arrows walk the items; Escape from a row refocuses the corner', run: () => {
      click($('side-acct'), 0);
      assert.equal(doc.activeElement.textContent, 'Details', 'the spend card leads');
      key('ArrowDown');
      assert.ok(doc.activeElement.classList.contains('mc-free'));
      key('ArrowDown');
      assert.equal(doc.activeElement, $('acct-lvl'));
      key('End');
      assert.equal(doc.activeElement, $('acct-away'));
      key('Escape');
      assert.equal($('acct-menu').hidden, true);
      assert.equal(doc.activeElement, $('side-acct'));
    } },
  ]);
});

test('Interface mode: the row opens its side menu; a choice applies and saves, both stay open; Escape closes the side menu first', async () => {
  const { doc, $, click, key, posts } = await boot();
  click($('side-acct'));
  click($('acct-lvl'));
  assert.equal($('lvl-menu').hidden, false);
  assert.equal($('acct-lvl').getAttribute('aria-expanded'), 'true');
  assert.deepEqual([...$('lvl-menu').querySelectorAll('[role="menuitemradio"]')].map((o) => [o.querySelector('.lv-opt-name').textContent, o.getAttribute('aria-checked')]),
    [['Simple', 'false'], ['Advanced', 'false'], ['Expert', 'true']]);
  click($('lvl-menu').querySelector('[data-level-choice="simple"]'));
  await settle();
  assert.equal(doc.documentElement.dataset.level, 'simple');
  assert.deepEqual(posts.filter((p) => p.url.endsWith('/api/settings')).map((p) => p.body), [{ uiLevel: 'simple' }]);
  assert.equal($('acct-lvl').querySelector('.mi-val').textContent, 'Simple');
  assert.equal($('lvl-menu').hidden, false, 'the side menu stays open…');
  assert.equal($('acct-menu').hidden, false, '…and so does the menu: the page behind changes in place');
  for (const id of ['side-acct', 'acct-menu', 'lvl-menu', 'acct-lvl', 'acct-settings', 'acct-away']) assert.equal(minLevelFor($(id)), 'simple', `#${id} shows at every mode`);
  key('Escape');
  assert.equal($('lvl-menu').hidden, true, 'Esc: the side menu first');
  assert.equal($('acct-lvl').getAttribute('aria-expanded'), 'false');
  assert.equal(doc.activeElement, $('acct-lvl'));
  assert.equal($('acct-menu').hidden, false);
  key('Escape');
  assert.equal($('acct-menu').hidden, true, 'then the menu');
  assert.equal(doc.activeElement, $('side-acct'));
  click($('side-acct'));
  click($('acct-lvl'));
  click(doc.querySelector('.main'));
  assert.deepEqual([$('acct-menu').hidden, $('lvl-menu').hidden], [true, true], 'closing the menu closes its side menu');
});

// jsdom lays nothing out: give the corner, the menus and the window the sizes a browser would.
function stubLayout(window, el, { left = 0, top = 0, width = 0, height = 0 }) {
  Object.defineProperty(el, 'offsetWidth', { configurable: true, get: () => width });
  Object.defineProperty(el, 'offsetHeight', { configurable: true, get: () => height });
  el.getBoundingClientRect = () => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top });
}
const px = (v) => Number.parseFloat(v);

test('the menu and its side menu stay inside the viewport: on the rail, and in a phone drawer', async () => {
  await checkRows([
    { name: 'rail on a short window: the tall menu is pinned 8px from the top; the side menu opens to the right of it', run: async () => {
      const { window, doc, $, click } = await boot({ width: 1000 });
      assert.ok(doc.querySelector('.sidebar').classList.contains('collapsed'), 'a tablet width forces the rail');
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
      stubLayout(window, $('side-acct'), { left: 11, top: 544, width: 42, height: 46 });
      stubLayout(window, $('acct-menu'), { left: 11, top: 8, width: 258, height: 640 });
      click($('side-acct'));
      assert.deepEqual([px($('acct-menu').style.left), px($('acct-menu').style.top)], [11, 8], 'upward from the avatar, clamped at the top');
      stubLayout(window, $('acct-lvl'), { left: 17, top: 300, width: 246, height: 31 });
      stubLayout(window, $('lvl-menu'), { left: 0, top: 0, width: 236, height: 180 });
      click($('acct-lvl'));
      assert.deepEqual([px($('lvl-menu').style.left), px($('lvl-menu').style.top)], [273, 295], 'beside the menu: its right edge + 4');
    } },
    { name: 'phone drawer: the menu is pulled left to fit; the side menu has no room on the right and lands 8px from the left', run: async () => {
      const { window, doc, $, click } = await boot({ width: 390 });
      click($('mbar-menu'));
      assert.ok(doc.body.classList.contains('nav-open'), 'the drawer is open');
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 640 });
      stubLayout(window, $('side-acct'), { left: 150, top: 584, width: 200, height: 46 });
      stubLayout(window, $('acct-menu'), { left: 124, top: 148, width: 258, height: 430 });
      click($('side-acct'));
      const [l, t] = [px($('acct-menu').style.left), px($('acct-menu').style.top)];
      assert.deepEqual([l, t], [390 - 258 - 8, 584 - 430 - 6]);
      assert.ok(l >= 8 && l + 258 <= 390 - 8 && t >= 8 && t + 430 <= 640 - 8, 'inside the viewport, 8px from every edge');
      stubLayout(window, $('acct-lvl'), { left: 130, top: 500, width: 246, height: 31 });
      stubLayout(window, $('lvl-menu'), { left: 0, top: 0, width: 236, height: 180 });
      click($('acct-lvl'));
      const [ll, lt] = [px($('lvl-menu').style.left), px($('lvl-menu').style.top)];
      assert.equal(ll, 8, 'no room on either side: clamped to the left margin');
      assert.equal(lt, 640 - 180 - 8, 'and pulled up off the bottom edge');
      assert.ok(doc.body.classList.contains('nav-open'), 'the drawer stays open while the menu is used');
    } },
  ]);
});

test('Interface mode: a save the server refuses puts the check back and says why in a toast; both menus stay open', async () => {
  const { doc, $, click } = await boot({ levelSave: 'disk full' });
  click($('side-acct'));
  click($('acct-lvl'));
  click($('lvl-menu').querySelector('[data-level-choice="simple"]'));
  await settle();
  assert.equal(doc.documentElement.dataset.level, 'expert', 'back to the confirmed mode');
  assert.equal($('lvl-menu').querySelector('[aria-checked="true"]').dataset.levelChoice, 'expert');
  assert.equal($('acct-lvl').querySelector('.mi-val').textContent, 'Expert');
  const toast = doc.querySelector('.toast.err[data-key="ui-level-save"]');
  assert.ok(toast, 'an error toast says the mode did not save');
  assert.equal(toast.querySelector('.tt').textContent, 'Could not save the mode');
  assert.equal(toast.querySelector('.td').textContent, 'disk full');
  assert.equal($('mode-modal').classList.contains('hidden'), true, 'the dialog stays shut');
  assert.deepEqual([$('acct-menu').hidden, $('lvl-menu').hidden], [false, false], 'the menus stay open to try again');
});

test('stylesheet: the foot band keeps the mockup\'s 4px gap between Running actions and the corner', () => {
  assert.match(css, /\.side-foot\{flex:none;display:flex;flex-direction:column;gap:4px;padding:8px 10px 10px;/);
});

test('the identity card is named by its visible heading, not by a second copy of it', async () => {
  const { $ } = await boot();
  const card = $('acct-id');
  assert.equal(card.getAttribute('role'), 'group');
  assert.equal(card.hasAttribute('aria-label'), false);
  assert.equal($(card.getAttribute('aria-labelledby')).textContent, 'Signed in as');
});
