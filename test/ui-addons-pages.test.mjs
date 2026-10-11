// test/ui-addons-pages.test.mjs — the Add-ons pages: Settings tabs that became pages of their own.
// Each is a routed view with its own level and banner. An old address (#settings/<tab>[/x], #plugins,
// #guardrails/<id>) lands on the page it means now, keeps its sub-path, and REPLACES the history entry:
// Back never returns to the old address only to be bounced forward again.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

const html = readFileSync(fileURLToPath(new URL('../ui/public/index.html', import.meta.url)), 'utf8');
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const GSETS = [
  { id: 'gr_org', name: 'Org Policy', origin: null,
    settings: { honorProjectSettings: true, envScrub: true, envAllowlist: [], protectedPaths: [], deny: [] } },
];

class WSStub {
  constructor() { this.readyState = 1; WSStub.last = this; this._l = {}; }
  send() {} close() {}
  addEventListener(t, fn) { (this._l[t] = this._l[t] || []).push(fn); }
  _open() { (this._l.open || []).forEach((fn) => fn({})); }
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await tick(); };

// `hash`: the address the page boots on. `level`: the server-rendered interface mode. `routes`: a body per
// URL prefix, or a function returning the whole response (a failure).
async function boot({ hash = '', level = null, routes = {} } = {}) {
  const page = level ? html.replace('<html lang="en" data-theme="system">', `<html lang="en" data-theme="system" data-level="${level}">`) : html;
  const dom = trackDom(new JSDOM(page, { url: `http://localhost:4319/${hash ? `#${hash}` : ''}` }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = WSStub;
  const calls = [];
  window.fetch = (u, opts = {}) => {
    const s = String(u);
    calls.push(`${opts.method || 'GET'} ${s}`);
    const json = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
    for (const [prefix, body] of Object.entries(routes)) if (s.startsWith(prefix)) return typeof body === 'function' ? Promise.resolve(body()) : json(body);
    if (s.startsWith('/api/providers')) return json({});
    if (s.startsWith('/api/models')) return json({ models: [], predefined: [], efforts: [] });
    if (s.startsWith('/api/plugins')) return json({ plugins: [], orphans: [] });
    if (s.startsWith('/api/marketplaces')) return json({ marketplaces: [] });
    if (s === '/api/mcp/sets') return json({ newer: false, sets: [] });
    if (s.startsWith('/api/mcp/sets/')) return json({ set: { id: 'general', name: 'General', group: 'general', greyed: false, home: null, usedBy: [] }, members: [] });
    if (s.startsWith('/api/guardrails')) return json({ guardrails: GSETS });
    if (s.startsWith('/api/settings')) return json({ root: '/tmp/x', default: '/tmp/x' });
    return json({ config: { steps: {}, customModels: [] }, models: [], efforts: [], projects: 0, pipelines: 0, workspaces: 0, projects_list: [], guardrails: GSETS });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  window.localStorage.clear();
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await tick();
  if (WSStub.last) WSStub.last._open();
  await settle();
  return { window, doc: window.document, calls };
}

// The assignment pushes one history entry, as a click on a link does. jsdom also delivers the hashchange of
// that assignment itself, on a timer, so dispatching one at once as well routes twice here: the rows that use
// go() check where you land and what the history holds, never how often a page loaded. The one-load test at
// the end of this file never dispatches by hand.
async function go(window, hash) {
  window.location.hash = hash;
  window.dispatchEvent(new window.Event('hashchange'));
  await settle();
}

const shownView = (doc) => [...doc.querySelectorAll('section.view[data-view]')].filter((v) => !v.classList.contains('hidden')).map((v) => v.dataset.view);

test('old addresses land on the page they mean now, keep the sub-path and replace the history entry (hashchange and boot)', async () => {
  // [old address, the address it becomes, the view that shows]
  const moves = [
    ['settings/plugins', '#marketplace', 'marketplace'],
    ['settings/plugins/x', '#marketplace/x', 'marketplace'],
    ['plugins', '#marketplace', 'marketplace'],
    ['settings/providers', '#providers', 'providers'],
    ['settings/providers/x', '#providers/x', 'providers'],
    ['settings/models', '#models', 'models'],
    ['settings/models/title-model', '#models/title-model', 'models'],
    ['settings/mcp', '#connectors', 'connectors'],
    ['settings/mcp/sets/billing', '#connectors/sets/billing', 'connectors'],
    ['guardrails/gr_org', '#settings/guardrails/gr_org', 'settings'],
  ];
  await checkRows([
    ...moves.map(([from, to, view]) => ({ name: `#${from} -> ${to} on a hashchange, the old entry replaced`, run: async () => {
      const { window, doc } = await boot();
      const entries = window.history.length;
      await go(window, from);
      assert.equal(window.location.hash, to);
      assert.deepEqual(shownView(doc), [view]);
      assert.equal(window.history.length, entries + 1, 'only the link\'s own entry: the redirect replaced it');
    } })),
    { name: 'an in-app call that still names the old tab (showView(\'settings\', \'providers\')) opens the page, not General', run: async () => {
      const { window, doc } = await boot();
      window.__np.showView('settings', 'providers');
      await settle();
      assert.equal(window.location.hash, '#providers');
      assert.deepEqual(shownView(doc), ['providers']);
    } },
    ...moves.map(([from, to, view]) => ({ name: `#${from} -> ${to} at boot, no entry added`, run: async () => {
      const { window, doc } = await boot({ hash: from });
      assert.equal(window.location.hash, to);
      assert.deepEqual(shownView(doc), [view]);
      assert.equal(window.history.length, 1);
    } })),
    { name: '#models is a page now, not an old address: it stays as typed', run: async () => {
      const { window, doc } = await boot();
      const entries = window.history.length;
      await go(window, 'models');
      assert.equal(window.location.hash, '#models');
      assert.deepEqual(shownView(doc), ['models']);
      assert.equal(window.history.length, entries + 1);
    } },
  ]);
});

test('Providers is a page of its own: its loader, its title, its level banner, and no Settings tab', async () => {
  await checkRows([
    { name: '#providers loads GET /api/providers into its own section, titled Providers; Settings has no Providers tab', run: async () => {
      const { window, doc, calls } = await boot();
      await go(window, 'providers');
      assert.deepEqual(shownView(doc), ['providers']);
      assert.ok(calls.includes('GET /api/providers'));
      assert.equal(doc.getElementById('topnav-title').textContent, 'Providers');
      assert.ok(doc.querySelector('[data-view="providers"] #providers-list .mv-providers'), 'the card painted');
      assert.equal(doc.querySelector('#settings-tabs button[data-tab="providers"]'), null);
      assert.equal(doc.querySelector('[data-view="settings"] #providers-list'), null);
    } },
    { name: 'the OpenRouter allowance paints under the OpenAI-compatible row while the Providers page shows', run: async () => {
      const { window, doc } = await boot({ routes: { '/api/openrouter/free-daily': { enabled: true, known: true, remaining: 37, limit: 50 } } });
      await go(window, 'providers');
      await settle();
      assert.equal(doc.querySelector('#providers-list .mv-pv-row[data-provider="openai"] .mv-pv-msg').textContent, 'Free-model requests today: 37 of 50 left.');
    } },
    { name: 'at Simple, #providers still opens under a banner naming Expert', run: async () => {
      const { window, doc } = await boot({ level: 'simple' });
      await go(window, 'providers');
      assert.deepEqual(shownView(doc), ['providers']);
      assert.equal(doc.getElementById('level-banner').hidden, false);
      assert.equal(doc.getElementById('level-banner-text').textContent, 'Providers is part of Expert mode, so it is not in your menu.');
      assert.equal(doc.getElementById('level-banner-pill').dataset.lv, 'expert');
    } },
  ]);
});

test('Models is a page of its own: the catalog, the Engines card from GET /api/settings, a card deep link, its banner and leave-guard', async () => {
  // A bridged catalog row that is not signed in yet: its "Sign in" leaves for the Providers page.
  const CP = { id: 'cp-gpt', label: 'GPT (Copilot)', efforts: ['medium'], upstream: { provider: 'copilot', api: 'openai-chat', model: 'gpt-5' },
    bridged: 'copilot', needsSignIn: true, signInReason: 'not_signed_in', signInMessage: 'not signed in' };
  await checkRows([
    { name: 'a catalog row\'s Sign in opens the Providers page; the OpenAI row\'s Import models… opens the Models page with the import dialog', run: async () => {
      const { window, doc } = await boot({ routes: { '/api/models': { models: [CP], predefined: [], efforts: [] } } });
      await go(window, 'models');
      doc.querySelector('#models-list .mv-signin').click();
      await settle();
      assert.equal(window.location.hash, '#providers');
      assert.deepEqual(shownView(doc), ['providers']);
      doc.querySelector('#providers-list .mv-pv-row[data-provider="openai"] .mv-pv-browse').click();
      await settle();
      assert.equal(window.location.hash, '#models');
      assert.deepEqual(shownView(doc), ['models']);
      assert.equal(doc.getElementById('model-import-modal').classList.contains('hidden'), false, 'the import dialog opens over the catalog');
    } },
    { name: '#models loads the catalog and GET /api/settings into its own section, titled Models; Settings has no Models tab', run: async () => {
      const { window, doc, calls } = await boot({ routes: { '/api/settings': { root: '/tmp/x', default: '/tmp/x', runEngine: 'codex' } } });
      await go(window, 'models');
      assert.deepEqual(shownView(doc), ['models']);
      assert.ok(calls.includes('GET /api/models'));
      assert.ok(calls.includes('GET /api/settings'));
      assert.equal(doc.getElementById('topnav-title').textContent, 'Models');
      assert.equal(doc.querySelector('#engine-settings-root [data-setting="run.engine"] .inherit-input').value, 'codex', 'the Engines card painted');
      assert.equal(doc.querySelector('#settings-tabs button[data-tab="models"]'), null);
      assert.equal(doc.querySelector('[data-view="settings"] #models-list'), null);
    } },
    { name: 'a failed GET /api/settings says so on the Models page (its Engines card and pickers come from it); a later load that works takes it back', run: async () => {
      let fail = true;
      const { window, doc } = await boot({ routes: { '/api/settings': () => (fail
        ? { ok: false, status: 500, json: async () => ({ error: 'disk full' }) }
        : { ok: true, status: 200, json: async () => ({ root: '/tmp/x', default: '/tmp/x' }) }) } });
      await go(window, 'models');
      const msg = doc.getElementById('models-msg');
      assert.equal(msg.textContent, 'Could not load settings: disk full');
      assert.equal(msg.className, 'form-msg err');
      // Another tab saved a setting: the page loads the settings again, and this time they come.
      const changed = async () => { WSStub.last._l.message.forEach((fn) => fn({ data: JSON.stringify({ type: 'settings-changed' }) })); await settle(); };
      fail = false;
      await changed();
      assert.equal(msg.textContent, '', 'the load that worked takes the message back');
      msg.textContent = 'Imported from Copilot: 2 added.';
      await changed();
      assert.equal(msg.textContent, 'Imported from Copilot: 2 added.', 'only its own message: the line also reports imports');
    } },
    { name: 'leaving Models hides an open info tip (the bubble lives on <body>)', run: async () => {
      const { window, doc } = await boot();
      await go(window, 'models');
      // The page ships no ⓘ since the helper-model cards became Helper jobs rows; the leave-guard covers any it gains.
      const tip = Object.assign(doc.createElement('button'), { type: 'button', className: 'info-tip', innerHTML: 'i<span class="tip-content hidden">A tip.</span>' });
      doc.querySelector('[data-view="models"]').append(tip);
      tip.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
      assert.equal(doc.getElementById('info-bubble').classList.contains('hidden'), false, 'the tip opened');
      await go(window, 'runs');
      assert.equal(doc.getElementById('info-bubble').classList.contains('hidden'), true);
    } },
    { name: 'a window focus on the Models page reads the catalog again (a key added in another tab shows at once)', run: async () => {
      const { window, calls } = await boot({ routes: { '/api/credentials': { enabled: true, models: {}, slots: [] } } });
      await go(window, 'models');
      const reads = () => calls.filter((c) => c === 'GET /api/models').length;
      const before = reads();
      window.dispatchEvent(new window.Event('focus'));
      await settle();
      assert.equal(reads(), before + 1);
    } },
    { name: 'signing out of Copilot on the Providers page repaints its card there', run: async () => {
      let connected = true;
      const res = (body) => ({ ok: true, status: 200, json: async () => body });
      const pv = () => ({ copilot: { connected, termsCurrent: true, login: 'ada', accountType: 'individual', maxConcurrent: 4 } });
      const { window, doc } = await boot({ routes: {
        '/api/providers/copilot/logout': () => { connected = false; return res(pv()); },
        '/api/providers': () => res(pv()),
      } });
      await go(window, 'providers');
      doc.querySelector('#providers-list .mv-cp-signout').click();
      await settle();
      doc.getElementById('confirm-ok').click();
      await settle();
      assert.equal(doc.querySelector('#providers-list .mv-cp-signout'), null, 'the card shows the signed-out state');
    } },
    { name: 'at Simple, #models still opens under a banner naming Expert', run: async () => {
      const { window, doc } = await boot({ level: 'simple' });
      await go(window, 'models');
      assert.deepEqual(shownView(doc), ['models']);
      assert.equal(doc.getElementById('level-banner').hidden, false);
      assert.equal(doc.getElementById('level-banner-text').textContent, 'Models is part of Expert mode, so it is not in your menu.');
    } },
  ]);
});

test('at Simple, #connectors still opens under a banner naming Advanced', async () => {
  const { window, doc } = await boot({ level: 'simple' });
  await go(window, 'connectors');
  assert.deepEqual(shownView(doc), ['connectors']);
  assert.equal(doc.getElementById('level-banner').hidden, false);
  assert.equal(doc.getElementById('level-banner-text').textContent, 'Connectors is part of Advanced mode, so it is not in your menu.');
  assert.equal(doc.getElementById('level-banner-pill').dataset.lv, 'advanced');
});

test('Marketplace is a page of its own: its loader and background refresh, its title, its level banner, and no Settings tab', async () => {
  await checkRows([
    { name: 'a team policy change elsewhere repaints the Marketplace page\'s required-plugins strip', run: async () => {
      const { window, calls } = await boot();
      await go(window, 'marketplace');
      const reads = () => calls.filter((c) => c === 'GET /api/policy/scopes').length;
      const before = reads();
      WSStub.last._l.message.forEach((fn) => fn({ data: JSON.stringify({ type: 'team-policy-changed', action: 'updated' }) }));
      await settle();
      assert.ok(reads() > before, 'the strip reads the scopes again');
    } },
    { name: '#marketplace loads the plugins and marketplaces into its own section, titled Marketplace; Settings has no Plugins tab', run: async () => {
      const { window, doc, calls } = await boot();
      await go(window, 'marketplace');
      assert.deepEqual(shownView(doc), ['marketplace']);
      assert.ok(calls.includes('GET /api/plugins'));
      assert.ok(calls.includes('GET /api/marketplaces'));
      assert.ok(calls.includes('POST /api/marketplaces/refresh'), 'opening the page refreshes the marketplaces in the background');
      assert.equal(doc.getElementById('topnav-title').textContent, 'Marketplace');
      assert.equal(doc.querySelector('#settings-tabs button[data-tab="plugins"]'), null);
      assert.equal(doc.querySelector('[data-view="settings"] #plugins-list'), null);
      assert.deepEqual([...doc.querySelectorAll('#settings-tabs button[data-tab]')].map((b) => b.dataset.tab), ['general', 'runs', 'ask', 'guardrails', 'memory']);
    } },
    { name: 'at Simple, #marketplace still opens under a banner naming Advanced', run: async () => {
      const { window, doc } = await boot({ level: 'simple' });
      await go(window, 'marketplace');
      assert.deepEqual(shownView(doc), ['marketplace']);
      assert.equal(doc.getElementById('level-banner').hidden, false);
      assert.equal(doc.getElementById('level-banner-text').textContent, 'Marketplace is part of Advanced mode, so it is not in your menu.');
      assert.equal(doc.getElementById('level-banner-pill').dataset.lv, 'advanced');
    } },
  ]);
});

// The redirects catch an old address typed or bookmarked; this keeps the app's own links and calls
// off them, so no click lands on an old address (and no branch waits for a tab that is gone).
test('no in-app link, route call or tab check names an old address', () => {
  const pub = fileURLToPath(new URL('../ui/public/', import.meta.url));
  const files = readdirSync(pub, { recursive: true }).map(String).filter((f) => /\.(m?js|html)$/.test(f));
  assert.ok(files.includes('app.js') && files.includes('index.html'));
  assert.ok(files.some((f) => /^graph[\\/]/.test(f)) && files.some((f) => /^ask[\\/]/.test(f)), 'the sweep reads ui/public/graph and ui/public/ask too');
  const offenders = [];
  for (const f of files) {
    let src = readFileSync(pub + f, 'utf8');
    if (f === 'app.js') {
      const start = src.indexOf('const MOVED_ROUTES = Object.freeze({');
      assert.ok(start > 0, 'MOVED_ROUTES is in app.js');
      src = src.slice(0, start) + src.slice(src.indexOf('});', start));
    }
    for (const re of [/settings\/(plugins|mcp|models|providers)\b/g, /showView\('settings', '(plugins|mcp|models|providers)/g,
      /currentSettingsTab [!=]== '(plugins|mcp|models|providers)'/g, /data-tab="(plugins|mcp|models|providers)"/g]) {
      for (const m of src.matchAll(re)) offenders.push(`${f}: ${m[0]}`);
    }
  }
  assert.deepEqual(offenders, []);
});

// U7: the four pages are named as pages ("the Providers page", "Connectors › Skills"); no string, prompt,
// comment or user doc still sends anyone to a Settings tab that is gone. (docs/superpowers, docs/plans and
// docs/changelog are history: they keep the words of their day.)
test('no copy in the app, the server or the docs points at Settings › Plugins / Sets / Models / Providers', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const walk = (dir) => readdirSync(root + dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory()
    ? (e.name === 'vendor' ? [] : walk(`${dir}/${e.name}`)) : [`${dir}/${e.name}`]));
  const docs = ['README.md', 'THIRD_PARTY_NOTICES.md', '.claude/skills/creating-worca-cc-plugins/SKILL.md',
    ...readdirSync(root + 'docs').filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`),
    ...readdirSync(root + 'plugins').map((d) => `plugins/${d}/README.md`).filter((f) => { try { readFileSync(root + f); return true; } catch { return false; } })];
  const files = [...walk('ui/public'), ...walk('src'), 'ui/server.mjs'].filter((f) => /\.(m?js|html|css)$/.test(f)).concat(docs);
  assert.ok(files.length > 50 && docs.length > 10, 'the sweep reads the tree');
  const offenders = [];
  for (const f of files) {
    const src = readFileSync(root + f, 'utf8');
    for (const m of src.matchAll(/Settings\s*[›>→▸]\s*(Plugins|Sets|Models|Providers)\b/g)) offenders.push(`${f}: ${m[0]}`);
    // A path through the old Plugins place ("worca → Plugins → <plugin> → Settings"); "Plugins → Marketplace" names the rename.
    for (const m of src.matchAll(/\bPlugins\s*[›>→▸]\s*(?!Marketplace\b)\S+/g)) offenders.push(`${f}: ${m[0]}`);
  }
  assert.deepEqual(offenders, []);
});

// ── the sidebar's Add-ons group (CONTRACT §3) ─────────────────────────────────
test('the sidebar\'s Add-ons group sits between Workflows and Manage: a label and four rows, each with its level', () => {
  const doc = new JSDOM(html).window.document;
  const sect = [...doc.querySelectorAll('.nav > .nav-sect')].find((s) => s.textContent.trim() === 'Add-ons');
  assert.ok(sect, 'the Add-ons label');
  assert.equal(sect.dataset.minLevel, 'advanced', 'the label hides with its Advanced rows');
  assert.equal(sect.previousElementSibling.dataset.nav, 'workflows', 'right after the Workflows row');
  const rows = [];
  for (let n = sect.nextElementSibling; n && n.tagName === 'BUTTON'; n = n.nextElementSibling) rows.push(n);
  assert.deepEqual(rows.map((b) => [b.dataset.nav, b.dataset.minLevel, b.querySelector(':scope > span').textContent]), [
    ['marketplace', 'advanced', 'Marketplace'], ['connectors', 'advanced', 'Connectors'],
    ['models', 'expert', 'Models'], ['providers', 'expert', 'Providers'],
  ]);
  for (const b of rows) assert.equal(b.firstElementChild.tagName.toLowerCase(), 'svg', `${b.dataset.nav}: the icon comes first`);
  assert.equal(rows.at(-1).nextElementSibling.textContent.trim(), 'Manage');
});

test('an Add-ons row opens its page, lights itself and names the page in the top bar; at Simple the open page keeps its row', async () => {
  const rows = [['marketplace', 'Marketplace'], ['connectors', 'Connectors'], ['models', 'Models'], ['providers', 'Providers']];
  await checkRows([
    ...rows.map(([view, label]) => ({ name: `the ${label} row`, run: async () => {
      const { window, doc } = await boot();
      const row = doc.querySelector(`.nav > button[data-nav="${view}"]`);
      row.click();
      window.dispatchEvent(new window.Event('hashchange'));
      await settle();
      assert.equal(window.location.hash, `#${view}`);
      assert.deepEqual(shownView(doc), [view]);
      assert.ok(row.classList.contains('active'));
      assert.equal(row.getAttribute('aria-current'), 'page');
      assert.deepEqual([...doc.querySelectorAll('[aria-current="page"]')], [row], 'only the open page is lit: Settings is not');
      assert.equal(doc.getElementById('topnav-title').textContent, label);
    } })),
    { name: 'at Simple the Models row stays on screen while Models is open, and goes when you leave', run: async () => {
      const { window, doc } = await boot({ level: 'simple' });
      const row = doc.querySelector('.nav > button[data-nav="models"]');
      await go(window, 'models');
      assert.equal(row.dataset.levelKeep, '1');
      await go(window, 'runs');
      assert.equal(row.dataset.levelKeep, undefined);
    } },
  ]);
});

// A page entry loads once. jsdom delivers the hashchange of a `location.hash =` assignment itself (on a timer),
// so this test never dispatches one by hand: a route that ran twice would show as a doubled request.
test('one entry, one load: a row click and an old address each fetch the page once', async () => {
  const LOAD = { marketplace: 'POST /api/marketplaces/refresh', connectors: 'GET /api/mcp/sets', models: 'GET /api/models', providers: 'GET /api/providers' };
  const OLD = { marketplace: 'settings/plugins', connectors: 'settings/mcp', models: 'settings/models', providers: 'settings/providers' };
  await checkRows(Object.entries(LOAD).flatMap(([view, req]) => [
    { name: `the ${view} row`, run: async () => {
      const { window, doc, calls } = await boot({ hash: 'runs' });
      const n = calls.filter((c) => c === req).length;
      doc.querySelector(`.nav > button[data-nav="${view}"]`).click();
      await settle(12);
      assert.equal(window.location.hash, `#${view}`);
      assert.equal(calls.filter((c) => c === req).length - n, 1, `${req} once`);
    } },
    { name: `#${OLD[view]} -> #${view}`, run: async () => {
      const { window, calls } = await boot({ hash: 'runs' });
      const n = calls.filter((c) => c === req).length;
      window.location.hash = OLD[view];
      await settle(12);
      assert.equal(window.location.hash, `#${view}`);
      assert.equal(calls.filter((c) => c === req).length - n, 1, `${req} once`);
    } },
  ]));
});
