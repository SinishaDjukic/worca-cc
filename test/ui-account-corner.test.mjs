// test/ui-account-corner.test.mjs — the account corner at the foot of the sidebar and the menu it
// opens, booted for real (index.html + app.js under jsdom): the menu's order and roles, opening and
// closing (outside click, Escape, a route), the keyboard, the Interface mode side menu, the spend
// card's free-request row, the stylesheet rules that keep the corner whole on the rail, and the
// mockup's look (row icons, the Appearance row, the padded sheet with its inset hairlines).
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
// budget: false makes GET /api/budget fail (no snapshot ever arrives). keepAwake: the setting GET /api/settings reports;
// keepAwakeSave: 'ok', or the { status, error } the server answers a {keepAwake} save with.
async function boot({ whoami = { name: 'ada.lovelace@acme.dev', source: 'access', shared: true }, free = FREE, width = null, hover = false, budget = true, levelSave = 'ok', keepAwake = true, keepAwakeSave = 'ok' } = {}) {
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
    const method = (opts.method || 'GET').toUpperCase();
    if (url.endsWith('/api/flags')) return ok({ flags: [] });
    if (method === 'POST') {
      const body = JSON.parse(opts.body);
      posts.push({ url, body });
      // levelSave: 'ok', or the error the server answers a {uiLevel} save with.
      if (body.uiLevel && levelSave !== 'ok') return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: levelSave }) });
      if ('keepAwake' in body && keepAwakeSave !== 'ok') return Promise.resolve({ ok: false, status: keepAwakeSave.status, json: async () => ({ error: keepAwakeSave.error }) });
      return ok(body);
    }
    if (url.endsWith('/api/settings')) return ok({ keepAwake, chat: {} });
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
  doc.activeElement?.blur?.();                         // the Chat page focused its composer at boot; start these rows with focus free
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
  assert.match(rule('.mi-lbl') || '', /overflow:hidden;[^}]*line-height:1\.4;/, 'the ellipsis box keeps g, p and y: the row\'s line-height:1 would clip them');
  assert.doesNotMatch(css, /\[data-level[^\]]*\][^{]*\.acct/, 'no interface-mode rule reaches the corner');
});

test('a mouse passing over the corner does not open the menu: it opens on a click', async () => {
  const { window, $, click } = await boot({ hover: true });
  $('side-acct').dispatchEvent(new window.MouseEvent('mouseenter'));
  assert.equal($('acct-menu').hidden, true, 'no popup opens on hover');
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

test('the account menu: its order and roles (spend card · Signed in as · Interface mode · Settings · away row · appearance icons last), and the keyboard', async () => {
  const { doc, $, click, key } = await boot();
  await checkRows([
    { name: 'order and roles', run: () => {
      const menu = $('acct-menu');
      assert.deepEqual([...menu.children].map((el) => el.id || el.className),
        ['acct-spend', 'acct-id', 'msect', 'msect sw-sect', 'msect theme-sect']);
      assert.deepEqual([...menu.querySelectorAll('.msect')].map((s) => [s.getAttribute('role'), [...s.children].map((b) => b.id)]),
        [['group', ['acct-team-setup', 'acct-lvl', 'acct-settings']], ['group', ['acct-away', 'acct-keepawake']], ['group', ['acct-theme-k', 'acct-theme']]], 'each run of rows is its own section; the two switches share one');
      assert.deepEqual([...menu.querySelectorAll('[role^="menuitem"]')].map((b) => b.id || b.dataset.themeMode || b.className),
        ['btn btn-sm mc-btn', 'mi menu-item mc-free', 'acct-team-setup', 'acct-lvl', 'acct-settings', 'acct-away', 'acct-keepawake', 'system', 'light', 'dark'], 'Details, the free row, the team-setup row (hidden until the team updates its setup), the four rows, then the three icons');
      assert.equal($('acct-away').closest('.msect').getAttribute('aria-label'), 'Switches');
      assert.deepEqual([...$('acct-theme').querySelectorAll('button')].map((b) => [b.getAttribute('role'), b.getAttribute('aria-label'), b.textContent.trim()]),
        [['menuitemradio', 'System', ''], ['menuitemradio', 'Light', ''], ['menuitemradio', 'Dark', '']], 'icons only: the name is the aria-label');
      assert.deepEqual([$('acct-lvl').getAttribute('aria-haspopup'), $('acct-lvl').getAttribute('aria-controls'), $('acct-lvl').getAttribute('aria-expanded')],
        ['menu', 'lvl-menu', 'false']);
    } },
    { name: 'a keyboard open lands on the first item (not the checked theme icon); the arrows walk the items; Escape from a row refocuses the corner', run: () => {
      click($('side-acct'), 0);
      assert.equal(doc.activeElement.textContent, 'Details', 'the spend card leads');
      key('ArrowDown');
      assert.ok(doc.activeElement.classList.contains('mc-free'));
      key('ArrowDown');
      assert.equal(doc.activeElement, $('acct-lvl'));
      key('End');
      assert.equal(doc.activeElement.dataset.themeMode, 'dark', 'the last icon ends the menu');
      key('ArrowUp'); key('ArrowUp'); key('ArrowUp');
      assert.equal(doc.activeElement, $('acct-keepawake'), 'the arrows walk the switch rows');
      key('ArrowUp');
      assert.equal(doc.activeElement, $('acct-away'));
      key('Escape');
      assert.equal($('acct-menu').hidden, true);
      assert.equal(doc.activeElement, $('side-acct'));
    } },
  ]);
});

test('Appearance icons: a pick applies and saves, lights both switchers and keeps the menu open; Left and Right move between them', async () => {
  const { doc, $, click, key, posts } = await boot();
  const lit = (sel, attr) => [...doc.querySelectorAll(`${sel} button[data-theme-mode]`)].map((b) => [b.dataset.themeMode, b.classList.contains('on'), b.getAttribute(attr)]);
  assert.deepEqual(lit('#acct-theme', 'aria-checked'), [['system', true, 'true'], ['light', false, 'false'], ['dark', false, 'false']]);
  click($('side-acct'));
  click($('acct-theme').querySelector('[data-theme-mode="dark"]'));
  await settle();
  assert.equal(doc.documentElement.dataset.theme, 'dark');
  assert.deepEqual(posts.filter((p) => p.url.endsWith('/api/settings')).map((p) => p.body), [{ theme: 'dark' }]);
  assert.deepEqual(lit('#acct-theme', 'aria-checked'), [['system', false, 'false'], ['light', false, 'false'], ['dark', true, 'true']]);
  assert.deepEqual(lit('#theme-seg', 'aria-pressed'), [['system', false, 'false'], ['light', false, 'false'], ['dark', true, 'true']], 'Settings › General follows');
  assert.equal($('acct-menu').hidden, false, 'the menu stays open: the page behind changes in place');
  for (const b of $('acct-theme').querySelectorAll('button')) assert.equal(minLevelFor(b), 'simple', 'shows at every mode');
  $('acct-theme').querySelector('[data-theme-mode="dark"]').focus();
  key('ArrowRight');
  assert.equal(doc.activeElement.dataset.themeMode, 'system', 'Right wraps to the first');
  key('ArrowLeft');
  assert.equal(doc.activeElement.dataset.themeMode, 'dark', 'Left wraps to the last');
  click($('theme-seg').querySelector('[data-theme-mode="light"]'));
  await settle();
  assert.deepEqual(lit('#acct-theme', 'aria-checked'), [['system', false, 'false'], ['light', true, 'true'], ['dark', false, 'false']], 'a Settings pick lights the menu too');
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
  for (const id of ['side-acct', 'acct-menu', 'lvl-menu', 'acct-lvl', 'acct-settings', 'acct-away', 'acct-keepawake']) assert.equal(minLevelFor($(id)), 'simple', `#${id} shows at every mode`);
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

test('the mockup rows: Interface mode and Settings lead with their own icon; Appearance is a visible label beside its icons', async () => {
  const { $ } = await boot();
  for (const id of ['acct-lvl', 'acct-settings', 'acct-away', 'acct-keepawake']) {
    const row = $(id);
    const icons = row.querySelectorAll('.mi-ic');
    assert.equal(icons.length, 1, `${id}: one icon`);
    assert.equal(row.firstElementChild, icons[0], `${id}: the icon leads the row`);
    assert.equal(icons[0].getAttribute('aria-hidden'), 'true', `${id}: the icon is decoration`);
  }
  assert.ok($('acct-lvl').querySelector('.mi-ic circle') && $('acct-settings').querySelector('.mi-ic path'), 'the sliders and the gear are drawn, not empty boxes');
  assert.deepEqual([...$('acct-lvl').children].map((el) => el.getAttribute('class')), ['mi-ic', 'mi-lbl', 'mi-val', 'mi-chev'], 'the value and the chevron stay');
  const sect = $('acct-theme').parentElement;
  assert.equal(sect.hasAttribute('aria-label'), false, 'named once, by the visible label');
  const label = $(sect.getAttribute('aria-labelledby'));
  assert.equal(label.textContent, 'Appearance');
  assert.equal(label.nextElementSibling, $('acct-theme'), 'the label sits left of the icons');
  assert.equal(label.hasAttribute('role'), false, 'the arrows never stop on it');
});

test('stylesheet: the account menu is the mockup\'s padded sheet: inset hairlines, a grey spend panel, the one button and a one-row Appearance', () => {
  const rule = (sel) => { const m = css.match(new RegExp(`(?:^|[\\s,}])${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`)); return m ? m[1] : null; };
  assert.match(rule('.nav-fly.acct-menu') || '', /padding:6px;/, 'padding round the content');
  assert.doesNotMatch(css, /\.acct-menu > :not\(\[hidden\]\) ~ :not\(\[hidden\]\)\{[^}]*border-top/, 'no full-width border between sections');
  assert.match(rule('.acct-menu > :not([hidden]) ~ :not([hidden])') || '', /margin-top:9px;/, '4px, the 1px hairline, 4px');
  assert.match(rule('.acct-menu > :not([hidden]) ~ :not([hidden])::before') || '', /top:-5px;left:6px;right:6px;height:1px;background:var\(--line\);/, 'the hairline stops short of the edges');
  assert.match(rule('.mcard') || '', /border-radius:var\(--r-sm\);background:var\(--field\);/, 'the cards are inset grey panels');
  assert.match(rule('.mc-title') || '', /font:600 /, 'a semibold title');
  assert.equal(rule('.mc-btn'), 'flex:none;', 'Details keeps layout only: its skin is .btn .btn-sm in markup');
  assert.match(rule('.mc-rows dd') || '', /font:600 [^;]*var\(--sans\);/, 'semibold sans figures');
  assert.doesNotMatch(rule('.mc-rows dd') || '', /--mono/);
  assert.equal(rule('.mc-rows dd.pos'), null, 'Saved is ink, as the mockup shows');
  assert.match(rule('.mc-free:first-child') || '', /margin-top:0;padding-top:0;border-top:0;/, 'the free row alone in the card opens on no rule');
  for (const [sel, ink] of [['.mc-rows dd.warn', 'amber'], ['.mc-free[data-tone="warn"] .mi-val', 'amber'], ['.mc-rows dd.over', 'red'],
    ['.mc-free[data-tone="over"] .mi-val', 'red'], ['.mc-note', 'red']]) {
    assert.match(rule(sel) || '', new RegExp(`color:var\\(--${ink}-ink-strong\\);`), `${sel}: the -strong ink keeps 4.5:1 on the grey panel`);
  }
  assert.match(rule('.menu-item') || '', /min-height:30px;/, 'a menu row is the shared 30px one');
  assert.match(rule('.msect.theme-sect') || '', /flex-direction:row;align-items:center;justify-content:space-between;/, 'Appearance is one row');
  assert.match(rule('.theme-ic') || '', /width:30px;/, 'a compact segmented control, not a full-width track');
  assert.doesNotMatch(rule('.theme-ic') || '', /flex:1;/);
});

test('Keep awake in the account menu: a switch row for the keepAwake setting; a click saves it and the menu stays open', async () => {
  const { doc, $, click, posts } = await boot();
  const row = $('acct-keepawake');
  const saves = () => posts.filter((p) => p.url.endsWith('/api/settings') && 'keepAwake' in p.body).map((p) => p.body);
  await checkRows([
    { name: 'a menuitemcheckbox whose .switch is decoration, painted from GET /api/settings, with its tip', run: () => {
      assert.deepEqual([row.getAttribute('role'), row.querySelector('.mi-lbl').textContent, row.getAttribute('aria-checked')], ['menuitemcheckbox', 'Keep awake', 'true']);
      const sw = row.querySelector('.switch');
      assert.deepEqual([sw.getAttribute('aria-hidden'), sw.hasAttribute('role'), sw.hasAttribute('tabindex')], ['true', false, false]);
      assert.equal(row.title, 'Keeps the computer awake while runs are working. The display may still turn off.');
      assert.equal(row.getAttribute('aria-description'), row.title);
      assert.equal(row.querySelector('a'), null, 'no Beta chip link inside a menu row');
    } },
    { name: 'a click saves {keepAwake:false}, repaints off, and the menu stays open', run: async () => {
      click($('side-acct'));
      click(row);
      await settle();
      assert.deepEqual(saves(), [{ keepAwake: false }]);
      assert.equal(row.getAttribute('aria-checked'), 'false');
      assert.equal($('acct-menu').hidden, false, 'a toggle leaves the menu open');
    } },
    { name: 'a keyboard click (Enter/Space on the button, detail 0) toggles it and keeps the menu open', run: async () => {
      row.focus();
      click(row, 0);
      await settle();
      assert.deepEqual(saves().at(-1), { keepAwake: true });
      assert.equal(row.getAttribute('aria-checked'), 'true');
      assert.equal($('acct-menu').hidden, false);
      assert.equal(doc.activeElement, row);
    } },
  ]);
});

test('Keep awake in the account menu: a stored off paints off; a refused change reverts and toasts', async () => {
  const off = await boot({ keepAwake: false });
  assert.equal(off.$('acct-keepawake').getAttribute('aria-checked'), 'false');
  const { doc, $, click } = await boot({ keepAwakeSave: { status: 500, error: 'disk full' } });
  const row = $('acct-keepawake');
  click(row);
  await settle();
  assert.equal(row.getAttribute('aria-checked'), 'true', 'reverted');
  assert.equal(doc.querySelector('.toast.err[data-key="keep-awake"] .td')?.textContent, 'disk full');
});

test('stylesheet: a switch row paints its inner .switch from the row\'s aria-checked and aria-disabled, and the switch takes no pointer', () => {
  assert.match(css, /\.sw-item\[aria-checked="true"\] \.switch\)\{background:var\(--switch-on\);\}/);
  assert.match(css, /\.sw-item\[aria-disabled="true"\] \.switch\)\{/);
  assert.match(css, /\.sw-item \.switch\{pointer-events:none;\}/);
  assert.doesNotMatch(css, /\.away-item\[data-state="away"\]\{background/, 'the switch shows the state; no row tint');
  assert.doesNotMatch(css, /\.sw-item\[aria-disabled="true"\]\{cursor/, 'a disabled row keeps .mi\'s default cursor (the unread away row still opens Settings)');
});
