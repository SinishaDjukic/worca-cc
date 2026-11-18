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
import { lastToast, cardAlertOf } from './helpers/feedback.mjs';
import { readIndexHtml } from '../src/core/read-index-html.mjs';
import { readStyleCss } from '../src/core/read-style-css.mjs';
import { SERVER_MJS, readServerSource } from '../src/core/read-server-source.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

const html = readIndexHtml();
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
    ['settings/providers', '#models/providers', 'models'],
    ['settings/providers/x', '#models/providers/x', 'models'],
    ['providers', '#models/providers', 'models'],
    ['providers/openai', '#models/providers/openai', 'models'],
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
    { name: 'an in-app call that still names the old tab (showView(\'settings\', \'providers\')) opens the Providers tab, not General', run: async () => {
      const { window, doc } = await boot();
      window.__np.showView('settings', 'providers');
      await settle();
      assert.equal(window.location.hash, '#models/providers');
      assert.deepEqual(shownView(doc), ['models']);
      assert.equal(doc.getElementById('models-tab-providers').hidden, false);
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

test('Providers is a tab of the Models page: its loader, the page title, the page banner, and no Settings tab', async () => {
  await checkRows([
    { name: '#models/providers loads GET /api/providers into the Providers tab, titled Models; Settings has no Providers tab', run: async () => {
      const { window, doc, calls } = await boot();
      await go(window, 'models/providers');
      assert.deepEqual(shownView(doc), ['models']);
      assert.ok(calls.includes('GET /api/providers'));
      assert.equal(doc.getElementById('topnav-title').textContent, 'Models');
      assert.ok(doc.querySelector('[data-view="models"] #models-tab-providers #providers-list .mv-providers'), 'the card painted');
      assert.equal(doc.querySelector('[data-view="providers"]'), null, 'no Providers page');
      assert.equal(doc.querySelector('#settings-tabs button[data-tab="providers"]'), null);
      assert.equal(doc.querySelector('[data-view="settings"] #providers-list'), null);
    } },
    { name: 'the OpenRouter allowance paints under the OpenRouter row while the Providers tab shows', run: async () => {
      const { window, doc } = await boot({ routes: { '/api/openrouter/free-daily': { enabled: true, known: true, remaining: 37, limit: 50 } } });
      await go(window, 'models/providers');
      await settle();
      assert.equal(doc.querySelector('#providers-list .mv-pv-row[data-provider="openrouter"] .mv-pv-msg').textContent, 'Free-model requests today: 37 of 50 left.');
      assert.equal(doc.querySelector('#providers-list .mv-pv-row[data-provider="openai"] .mv-pv-msg').textContent, '', 'not under the OpenAI-compatible row');
    } },
    { name: 'at Simple, #models/providers still opens under the Models banner naming Expert', run: async () => {
      const { window, doc } = await boot({ level: 'simple' });
      await go(window, 'models/providers');
      assert.deepEqual(shownView(doc), ['models']);
      assert.equal(doc.getElementById('level-banner').hidden, false);
      assert.equal(doc.getElementById('level-banner-text').textContent, 'Models is part of Expert mode, so it is not in your menu.');
      assert.equal(doc.getElementById('level-banner-pill').dataset.lv, 'expert');
    } },
    { name: 'the Image generation row is wired: a refused Save in its own line, Test picture in the row, a service fills its preset', run: async () => {
      const routes = {
        '/api/providers/images': () => ({ ok: false, status: 400, json: async () => ({ error: 'Enter a price; 0 for a free server' }) }),
        '/api/images/test': { ok: true, w: 256, h: 256, ms: 900, dataUrl: 'data:image/png;base64,AAAA' },
      };
      const { window, doc } = await boot({ routes });
      await go(window, 'models/providers');
      const row = () => doc.querySelector('#providers-list .mv-pv-row[data-provider="images"]');
      row().querySelector('.mv-im-save').click();
      await settle();
      const line = row().querySelector('.mv-pv-msg');
      assert.deepEqual([line.textContent, line.classList.contains('err')], ['Enter a price; 0 for a free server', true]);
      assert.equal(doc.querySelector('#providers-list .card-alert'), null, 'the row\'s own line, not the card\'s alert');
      row().querySelector('.mv-im-test').click();
      await settle();
      assert.deepEqual([line.textContent, line.getAttribute('role')], ['', null], 'the Test clears the refused Save, its alert role too');
      assert.equal(row().querySelector('.mv-im-made').textContent, 'Made in 1 s · 256×256');
      const service = row().querySelector('.mv-im-service');
      service.value = 'xai';
      service.dispatchEvent(new window.Event('change', { bubbles: true }));
      assert.equal(row().querySelector('.mv-im-field[data-field="baseUrl"]').value, 'https://api.x.ai/v1');
      // A Save that goes through repaints the card: the new row's own Save takes the "Saved" state.
      routes['/api/providers/images'] = {};
      row().querySelector('.mv-im-save').click();
      await settle();
      assert.equal(row().querySelector('.mv-im-save').dataset.fbState, 'done');
    } },
    { name: 'the Sound row is wired: Test sends the typed key and shows the voices, a refused Save is the card\'s alert, an accepted one is Saved', run: async () => {
      // Prefix match, first key wins: the Test route before the PATCH route.
      const routes = {
        '/api/providers/sound/test': { ok: true, voices: 6 },
        '/api/providers/sound': () => ({ ok: false, status: 400, json: async () => ({ error: 'unknown sound field "voice"' }) }),
      };
      const { window, doc, calls } = await boot({ routes });
      const bodies = [];
      const inner = window.fetch;
      globalThis.fetch = window.fetch = (u, opts = {}) => { if (String(u).startsWith('/api/providers/sound')) bodies.push(`${opts.method || 'GET'} ${u} ${opts.body}`); return inner(u, opts); };
      await go(window, 'models/providers');
      const row = () => doc.querySelector('#providers-list .mv-pv-row[data-provider="sound"]');
      row().querySelector('.mv-pv-key').value = 'sk_typed_0123';
      row().querySelector('.mv-so-test').click();
      await settle();
      assert.ok(calls.includes('POST /api/providers/sound/test'));
      assert.deepEqual(bodies, ['POST /api/providers/sound/test {"apiKey":"sk_typed_0123"}']);
      const result = row().querySelector('.mv-so-result');
      assert.deepEqual([result.hidden, result.textContent, result.classList.contains('err')], [false, 'Key works · 6 voices', false]);
      // A failed Test: the reason in the same line, in red.
      routes['/api/providers/sound/test'] = { ok: false, message: 'ElevenLabs rejected the key' };
      row().querySelector('.mv-so-test').click();
      await settle();
      assert.deepEqual([result.hidden, result.textContent, result.classList.contains('err')], [false, 'ElevenLabs rejected the key', true]);
      row().querySelector('.mv-so-save').click();
      await settle();
      const alert = doc.querySelector('#providers-list .card-alert');
      assert.ok(alert && alert.closest('.mv-pv-card').contains(row()), 'the Sound row\'s own card');
      assert.deepEqual([alert.querySelector('.ca-title').textContent, alert.querySelector('.ca-detail').textContent], ['Not saved', 'unknown sound field "voice"']);
      assert.equal(row().querySelector('.mv-pv-msg').textContent, '', 'the card\'s alert, not the row\'s line');
      assert.ok(bodies.includes('PATCH /api/providers/sound {"apiKey":"sk_typed_0123"}'));
      // A Save that goes through repaints the card: the new row's own Save takes the "Saved" state.
      routes['/api/providers/sound'] = {};
      row().querySelector('.mv-so-save').click();
      await settle();
      assert.equal(row().querySelector('.mv-so-save').dataset.fbState, 'done');
    } },
  ]);
});

test('Models is a page of its own: the catalog, the Engines card from GET /api/settings, a card deep link, its banner and leave-guard', async () => {
  // A bridged catalog row that is not signed in yet: its provider's sub-group says so once, and its fix goes to the
  // Providers tab (an OpenAI-compatible key); a Copilot one opens the setup assistant on Model access instead (AC-4.5).
  const CP = { id: 'oa-gpt', label: 'GPT (OpenAI-compatible)', efforts: ['medium'], upstream: { provider: 'openai', api: 'openai-chat', model: 'gpt-5' },
    bridged: 'openai', needsSignIn: true, signInReason: 'not_signed_in', signInMessage: 'not signed in' };
  const COPILOT = { id: 'cp-gpt', label: 'GPT (Copilot)', efforts: ['medium'], upstream: { provider: 'copilot', api: 'openai-chat', model: 'gpt-5' },
    bridged: 'copilot', needsSignIn: true, signInReason: 'not_signed_in', signInMessage: 'not signed in' };
  await checkRows([
    { name: 'a provider sub-group\'s Set key opens the Providers tab at its row; the OpenAI row\'s Import models… opens Add model at step 2 over the Catalogue, with the row\'s address', run: async () => {
      const { window, doc } = await boot({ routes: { '/api/models': { models: [CP], predefined: [], efforts: [] } } });
      await go(window, 'models');
      doc.querySelector('#models-list .mdl-fix[data-row="openai"]').click();
      await settle();
      assert.equal(window.location.hash, '#models/providers/openai');
      assert.deepEqual(shownView(doc), ['models']);
      assert.equal(doc.getElementById('models-tab-providers').hidden, false);
      const row = doc.querySelector('#providers-list .mv-pv-row[data-provider="openai"]');
      row.querySelector('.mv-pv-baseurl').value = 'http://box:8080/v1';
      row.querySelector('.mv-pv-browse').click();
      assert.equal(window.location.hash, '#models', 'the Catalogue at the click');
      await settle();
      assert.deepEqual(shownView(doc), ['models']);
      assert.equal(doc.getElementById('models-tab-catalogue').hidden, false, 'the Catalogue panel shows');
      assert.equal(doc.getElementById('model-editor-modal').classList.contains('hidden'), false, 'Add model opens over the catalog');
      const step2 = doc.querySelector('#mv-editor-host .mdl-add[data-step="2"]');
      assert.equal(step2.querySelector('.mdl-add-provider').value, 'openai', 'at step 2, on OpenAI-compatible');
      assert.equal(step2.querySelector('.mimp-base').value, 'http://box:8080/v1', 'the row\'s address');
    } },
    { name: 'an OpenRouter model\'s Set key opens the Providers tab at the OpenRouter row; a local endpoint\'s at the OpenAI-compatible row', run: async () => {
      const OR_BASE = 'https://openrouter.ai/api/v1';
      const entry = (baseUrl, extra = {}) => ({ id: 'glm', label: 'GLM', efforts: ['medium'], upstream: { provider: 'openai', api: 'openai-chat', model: 'z-ai/glm-4.6', baseUrl },
        bridged: 'openai', needsSignIn: true, signInReason: 'no_key', signInMessage: 'no API key', ...extra });
      // The global entry points at a local server, the plugin's at OpenRouter: one sub-group each, each with its fix.
      const models = { models: [entry('http://127.0.0.1:11434/v1')], plugin: [entry(OR_BASE, { id: 'glm-or', plugin: 'or-pack' })], predefined: [], efforts: [] };
      const { window, doc } = await boot({ routes: { '/api/models': models } });
      await go(window, 'models');
      doc.querySelector('#models-list .mdl-fix[data-row="openrouter"]').click();
      await settle();
      assert.equal(window.location.hash, '#models/providers/openrouter');
      assert.equal(doc.getElementById('models-tab-providers').hidden, false);
      await go(window, 'models');
      doc.querySelector('#models-list .mdl-fix[data-row="openai"]').click();
      await settle();
      assert.equal(window.location.hash, '#models/providers/openai', 'the global entry is on the OpenAI-compatible row');
    } },
    { name: 'a Copilot row\'s Sign in opens the setup assistant on Model access, and the page stays (AC-4.5, R-qa-4)', run: async () => {
      const { window, doc } = await boot({ routes: { '/api/models': { models: [COPILOT], predefined: [], efforts: [] } } });
      await go(window, 'models');
      doc.querySelector('#models-list .mdl-fix[data-row="copilot"]').click();
      await settle();
      assert.ok(doc.getElementById('setup-modal'), 'the assistant is up');
      assert.equal(doc.querySelector('#setup-modal h2#setup-title').textContent, 'Where should Worca get its models?');
      assert.equal(window.location.hash, '#models');
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
    { name: 'a failed GET /api/settings says so on the Jobs tab (its Roles and Engines cards come from it); a later load that works takes it back', run: async () => {
      let fail = true;
      const { window, doc } = await boot({ routes: { '/api/settings': () => (fail
        ? { ok: false, status: 500, json: async () => ({ error: 'disk full' }) }
        : { ok: true, status: 200, json: async () => ({ root: '/tmp/x', default: '/tmp/x' }) }) } });
      await go(window, 'models/jobs');
      const msg = doc.getElementById('models-jobs-msg');
      assert.ok(doc.getElementById('models-tab-jobs').contains(msg), 'the Jobs tab\'s own line');
      assert.equal(msg.textContent, 'Could not load settings: disk full');
      assert.equal(msg.className, 'form-msg err');
      // Another tab saved a setting: the page loads the settings again, and this time they come.
      const changed = async () => { WSStub.last._l.message.forEach((fn) => fn({ data: JSON.stringify({ type: 'settings-changed' }) })); await settle(); };
      fail = false;
      await changed();
      assert.equal(msg.textContent, '', 'the load that worked takes the message back');
      msg.textContent = 'Saved elsewhere.';
      await changed();
      assert.equal(msg.textContent, 'Saved elsewhere.', 'only its own message: anything else on the line stays');
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
    { name: 'signing out of Copilot on the Providers tab repaints its card there', run: async () => {
      let connected = true;
      const res = (body) => ({ ok: true, status: 200, json: async () => body });
      const pv = () => ({ copilot: { connected, login: 'ada', accountType: 'individual', maxConcurrent: 4 } });
      const { window, doc } = await boot({ routes: {
        '/api/providers/copilot/logout': () => { connected = false; return res(pv()); },
        '/api/providers': () => res(pv()),
      } });
      await go(window, 'models/providers');
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

// ── the Models page's three tabs (models-menu P1, Task 4): Catalogue, Jobs and Providers in one view ─────────
// The tab is the first part of the address (#models, #models/jobs, #models/providers/<row>); the old Providers page's
// addresses land on its tab. A switch between tabs fetches nothing and keeps what was typed on every tab.
test('Models tabs: one view, three panels; the old Providers page is its Providers tab', async () => {
  // Every showView also GETs /api/counts, and the Providers card GETs /api/openrouter/free-daily: the page's own reads only.
  const API = (calls) => calls.filter((c) => /^GET \/api\/(models|providers|settings|config|engines|credentials)\b/.test(c));
  const panel = (doc, t) => doc.getElementById(`models-tab-${t}`);
  const shownPanels = (doc) => ['catalogue', 'jobs', 'providers'].filter((t) => !panel(doc, t).hidden);
  const lit = (doc) => doc.querySelector('#models-tabs [aria-current="page"]')?.dataset.tab;
  const headActions = (doc) => doc.querySelector('[data-view="models"] .mv-head-actions');
  const pvRow = (doc, p) => doc.querySelector(`#providers-list .mv-pv-row[data-provider="${p}"]`);
  const pvCard = (doc, p) => pvRow(doc, p)?.closest('.mv-pv-card');
  // Throws in DOM listeners never fail a test (jsdom reports them on window): collect them.
  const errorsOf = (window) => { const list = []; window.addEventListener('error', (e) => list.push(e.message)); return list; };
  // The Copilot sign-in polls on a timer (interval 30 → 30000 ms): hold it, so a row runs the poll by hand and no
  // timer outlives the row.
  const holdPolls = () => {
    const orig = globalThis.setTimeout;
    const held = [];
    globalThis.setTimeout = (fn, ms, ...a) => (ms === 30000 ? held.push(fn) : orig(fn, ms, ...a));
    return { held, restore: () => { globalThis.setTimeout = orig; } };
  };
  // A /api/settings or /api/providers answer that waits for release(): a failure with a status of 400 or more, a
  // network failure when the body is an Error.
  const heldRoute = (body, status = 200) => {
    let release;
    const held = new Promise((r) => { release = r; });
    const answer = () => { if (body instanceof Error) throw body; return { ok: status < 400, status, json: async () => body }; };
    return { route: () => held.then(answer), release: () => release() };
  };
  await checkRows([
    { name: '#models: the Catalogue panel shows, Jobs and Providers are hidden; Catalogue is lit; the head actions show', run: async () => {
      const { doc, calls } = await boot({ hash: 'models' });
      assert.deepEqual(shownPanels(doc), ['catalogue']);
      assert.equal(lit(doc), 'catalogue');
      assert.equal(headActions(doc).hidden, false);
      assert.ok(panel(doc, 'catalogue').querySelector('#models-list') && panel(doc, 'catalogue').querySelector('#models-msg'));
      assert.equal(doc.querySelector('#providers-list .mv-providers'), null, 'the Providers card waits for its tab');
      assert.ok(!calls.includes('GET /api/openrouter/free-daily?refresh=1'), 'so does its free-requests read');
    } },
    { name: '#models/jobs: the Jobs panel shows the Roles and Engines cards; Jobs is lit; the head actions hide', run: async () => {
      const { doc } = await boot({ hash: 'models/jobs' });
      assert.deepEqual(shownPanels(doc), ['jobs']);
      assert.ok(panel(doc, 'jobs').querySelector('#model-roles-card') && panel(doc, 'jobs').querySelector('#engine-settings-card'));
      assert.equal(lit(doc), 'jobs');
      assert.equal(headActions(doc).hidden, true);
    } },
    { name: 'from Chat, one hash write to #models/providers draws the card in the Providers panel after one GET /api/providers', run: async () => {
      const { window, doc, calls } = await boot({ hash: 'chat' });
      const errors = errorsOf(window);
      calls.length = 0;
      window.location.hash = 'models/providers';
      await settle(12);
      assert.ok(doc.querySelector('#models-tab-providers #providers-list .mv-providers'), 'the card painted in its panel');
      assert.equal(calls.filter((c) => c === 'GET /api/providers').length, 1);
      assert.equal(lit(doc), 'providers');
      assert.deepEqual(shownPanels(doc), ['providers']);
      assert.deepEqual(errors, []);
    } },
    { name: '#providers, #providers/openai and #settings/providers/images land on the tab, one history entry each; the row is found', run: async () => {
      const { window, doc } = await boot();
      const errors = errorsOf(window);
      for (const [from, to] of [['providers', '#models/providers'], ['providers/openai', '#models/providers/openai'], ['settings/providers/images', '#models/providers/images']]) {
        const entries = window.history.length;
        await go(window, from);
        assert.equal(window.location.hash, to);
        assert.equal(window.history.length, entries + 1, `#${from}: the redirect replaced the entry`);
        assert.deepEqual(shownView(doc), ['models']);
      }
      assert.ok(pvCard(doc, 'images').classList.contains('is-found'), 'the Image generation row is found');
      assert.deepEqual(errors, []);
    } },
    { name: 'a reload on #providers/openai: #models/providers/openai, no entry added, Providers lit, the OpenAI row found once the card loads', run: async () => {
      const { window, doc } = await boot({ hash: 'providers/openai' });
      const errors = errorsOf(window);
      assert.equal(window.location.hash, '#models/providers/openai');
      assert.equal(window.history.length, 1);
      assert.equal(lit(doc), 'providers');
      await settle();
      assert.ok(pvCard(doc, 'openai').classList.contains('is-found'));
      assert.deepEqual(errors, []);
    } },
    { name: '#models/engine-settings-card: the Jobs panel, the Engines card found, its first field focused once the settings load', run: async () => {
      const { doc } = await boot({ hash: 'models/engine-settings-card' });
      assert.deepEqual(shownPanels(doc), ['jobs']);
      assert.ok(doc.getElementById('engine-settings-card').classList.contains('is-found'));
      await settle();
      assert.ok(doc.getElementById('engine-settings-card').contains(doc.activeElement), 'the post-load reveal focused a field in the card');
    } },
    { name: 'a Jobs card link from inside the open page (nothing loads) finds the card and focuses its first field', run: async () => {
      const { window, doc } = await boot({ hash: 'models' });
      await go(window, 'models/engine-settings-card');
      assert.deepEqual(shownPanels(doc), ['jobs']);
      assert.ok(doc.getElementById('engine-settings-card').classList.contains('is-found'));
      assert.ok(doc.getElementById('engine-settings-card').contains(doc.activeElement));
    } },
    { name: 'a Catalogue action that refreshes the page keeps a key typed on the Providers tab', run: async () => {
      // One built-in, so Claude Code's group draws its hide switch.
      const routes = { '/api/models': { models: [], predefined: [{ id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['high'] }], efforts: ['high'] } };
      const { window, doc, calls } = await boot({ hash: 'models/providers', routes });
      const errors = errorsOf(window);
      const card = doc.querySelector('#providers-list .mv-providers');
      const key = pvRow(doc, 'openai').querySelector('.mv-pv-key');
      key.value = 'sk-test';
      key.dispatchEvent(new window.Event('input', { bubbles: true }));
      await go(window, 'models');
      const cb = doc.querySelector('.mv-hide-builtin');
      calls.length = 0;
      cb.checked = !cb.checked;
      cb.dispatchEvent(new window.Event('change', { bubbles: true }));
      await settle(12);
      assert.ok(calls.includes('POST /api/settings'), 'the toggle saved');
      assert.ok(calls.includes('GET /api/providers'), 'the refresh read the providers');
      await go(window, 'models/providers');
      assert.equal(doc.querySelector('#providers-list .mv-providers'), card, 'the card was not drawn again');
      assert.equal(pvRow(doc, 'openai').querySelector('.mv-pv-key').value, 'sk-test');
      assert.deepEqual(errors, []);
    } },
    { name: 'tab switches fetch nothing and keep a typed key and a dirty Roles row', run: async () => {
      const { window, doc, calls } = await boot({ hash: 'models/providers' });
      const errors = errorsOf(window);
      const card = doc.querySelector('#providers-list .mv-providers');
      const key = pvRow(doc, 'openai').querySelector('.mv-pv-key');
      key.value = 'sk-test';
      key.dispatchEvent(new window.Event('input', { bubbles: true }));
      await go(window, 'models/jobs');
      const field = doc.querySelector('#model-roles-root .inherit-field');
      field.querySelector('select, input').dispatchEvent(new window.Event('change', { bubbles: true }));
      calls.length = 0;
      await go(window, 'models/providers');
      await go(window, 'models/jobs');
      await go(window, 'models/providers');
      assert.deepEqual(API(calls), []);
      assert.equal(doc.getElementById('modelRolesMsg').textContent, '1 unsaved change');
      assert.equal(doc.querySelector('#providers-list .mv-providers'), card, 'the card was not drawn again');
      assert.equal(pvRow(doc, 'openai').querySelector('.mv-pv-key').value, 'sk-test');
      assert.deepEqual(errors, []);
    } },
    { name: 'a window focus re-reads the providers (a broker is on); the next switch keeps the card and what was typed in it', run: async () => {
      const { window, doc, calls } = await boot({ hash: 'models/providers', routes: { '/api/credentials': { enabled: true } } });
      const card = doc.querySelector('#providers-list .mv-providers');
      const url = pvRow(doc, 'openai').querySelector('.mv-pv-baseurl');
      url.value = 'http://localhost:11434/v1';
      url.dispatchEvent(new window.Event('input', { bubbles: true }));
      const reads = calls.filter((c) => c === 'GET /api/providers').length;
      window.dispatchEvent(new window.Event('focus'));
      await settle();
      assert.equal(calls.filter((c) => c === 'GET /api/providers').length, reads + 1, 'the focus read the providers again');
      await go(window, 'models/jobs');
      await go(window, 'models/providers');
      assert.equal(doc.querySelector('#providers-list .mv-providers'), card, 'same content: the card was not drawn again');
      assert.equal(pvRow(doc, 'openai').querySelector('.mv-pv-baseurl').value, 'http://localhost:11434/v1');
    } },
    { name: 'a failed GET /api/providers says so on the Providers tab and draws no card; the next entry that loads takes it back', run: async () => {
      const routes = { '/api/providers': () => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) }) };
      const { window, doc } = await boot({ hash: 'models/providers', routes });
      assert.match(doc.getElementById('providers-msg').textContent, /boom/);
      assert.equal(doc.querySelector('#providers-list .mv-providers'), null);
      routes['/api/providers'] = {};
      await go(window, 'chat');
      await go(window, 'models/providers');
      assert.equal(doc.getElementById('providers-msg').textContent, '');
      const card = doc.querySelector('#providers-list .mv-providers');
      assert.ok(card);
      await go(window, 'chat');
      await go(window, 'models/providers');
      assert.notEqual(doc.querySelector('#providers-list .mv-providers'), card, 'each entry draws the card once, the same content too');
    } },
    { name: 'a network failure on the page\'s read says so on the Providers tab too', run: async () => {
      const { doc } = await boot({ hash: 'models/providers', routes: { '/api/providers': () => { throw new Error('offline'); } } });
      assert.equal(doc.getElementById('providers-msg').textContent, 'offline');
      assert.equal(doc.querySelector('#providers-list .mv-providers'), null);
    } },
    { name: 'a failed GET /api/models still draws the Providers card; the Catalogue says why', run: async () => {
      const routes = { '/api/models': () => ({ ok: false, status: 500, json: async () => ({ error: 'down' }) }) };
      const { window, doc, calls } = await boot({ hash: 'models/providers', routes });
      assert.ok(doc.querySelector('#providers-list .mv-providers'), 'the providers payload is set before the catalogue\'s early return');
      const reads = calls.filter((c) => c === 'GET /api/models').length;
      await go(window, 'models');
      assert.equal(doc.getElementById('models-msg').textContent, 'down');
      assert.ok(calls.filter((c) => c === 'GET /api/models').length > reads, 'no catalogue yet: a tab switch reads it again');
    } },
    { name: 'a tab switch hides an open info tip (the bubble lives on <body>)', run: async () => {
      const { window, doc } = await boot({ hash: 'models' });
      const tip = Object.assign(doc.createElement('button'), { type: 'button', className: 'info-tip', innerHTML: 'i<span class="tip-content hidden">A tip.</span>' });
      panel(doc, 'catalogue').append(tip);
      tip.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
      assert.equal(doc.getElementById('info-bubble').classList.contains('hidden'), false, 'the tip opened');
      await go(window, 'models/jobs');
      assert.equal(doc.getElementById('info-bubble').classList.contains('hidden'), true);
    } },
    { name: 'a Jobs card link whose settings land after the user moved to another tab flashes and focuses nothing there', run: async () => {
      let release;
      const held = new Promise((r) => { release = r; });
      const routes = { '/api/settings': () => held.then(() => ({ ok: true, status: 200, json: async () => ({ root: '/tmp/x', default: '/tmp/x' }) })) };
      const { window, doc } = await boot({ hash: 'models/engine-settings-card', routes });
      const card = doc.getElementById('engine-settings-card');
      await go(window, 'models/providers');
      card.classList.remove('is-found');   // the link's own flash, before the settings came
      release();
      await settle(40);
      assert.ok(doc.getElementById('engine-settings-root').querySelector('select, input'), 'the Engines card painted');
      // A focus inside a hidden panel is a no-op (jsdom and the browser alike): the flash is what would wait for the user.
      assert.equal(card.classList.contains('is-found'), false, 'no late flash on the hidden Jobs tab');
      assert.equal(card.contains(doc.activeElement), false, 'no focus inside the hidden Jobs tab');
    } },
    ...['models/jobs/model-roles-card', 'models/jobs'].map((to) => ({ name: `a Jobs card link whose settings land after the user moved on to #${to} flashes and focuses nothing in the old card`, run: async () => {
      const settings = heldRoute({ root: '/tmp/x', default: '/tmp/x' });
      const { window, doc } = await boot({ hash: 'models/jobs/engine-settings-card', routes: { '/api/settings': settings.route } });
      const card = doc.getElementById('engine-settings-card');
      await go(window, to);
      card.classList.remove('is-found');   // the link's own flash, before the settings came
      settings.release();
      await settle(40);
      assert.ok(doc.getElementById('engine-settings-root').querySelector('select, input'), 'the Engines card painted');
      assert.deepEqual(shownPanels(doc), ['jobs']);
      assert.equal(card.classList.contains('is-found'), false, 'no late flash on a card the address no longer names');
      assert.equal(card.contains(doc.activeElement), false, 'the focus stays where the user is');
    } })),
    { name: 'a reload on #models/model/my-gpt finds the row once the catalogue loads (one hash write, no second route)', run: async () => {
      const routes = { '/api/models': { models: [{ id: 'my-gpt', label: 'My GPT', efforts: ['high'], engine: 'claude', env: {} }], predefined: [], efforts: ['high'] } };
      const { doc } = await boot({ hash: 'models/model/my-gpt', routes });
      await settle();
      const row = doc.querySelector('#models-list .mdl-row[data-id="my-gpt"]');
      assert.ok(row, 'the row is drawn');
      assert.ok(row.classList.contains('is-found'), 'the post-load reveal found it');
    } },
    { name: 'a providers load that lands after the user moved to the Catalogue with the same rest flashes nothing on the hidden row', run: async () => {
      const routes = {};
      const { window, doc } = await boot({ hash: 'models/providers', routes });
      await go(window, 'chat');
      const providers = heldRoute({});
      routes['/api/providers'] = providers.route;
      await go(window, 'models/providers/openai');
      await go(window, 'models/openai');   // the Catalogue tab, with rest 'openai'
      const card = pvCard(doc, 'openai');
      card.classList.remove('is-found');   // the entry's own flash, from the card it had
      providers.release();
      await settle(12);
      assert.deepEqual(shownPanels(doc), ['catalogue']);
      assert.equal(card.classList.contains('is-found'), false);
    } },
    { name: 'a re-entry whose providers read fails takes the old card away; a focus re-read that works draws it at the next switch', run: async () => {
      const routes = { '/api/credentials': { enabled: true } };
      const { window, doc } = await boot({ hash: 'models/providers', routes });
      assert.ok(doc.querySelector('#providers-list .mv-providers'));
      await go(window, 'chat');
      routes['/api/providers'] = () => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) });
      await go(window, 'models/providers');
      assert.match(doc.getElementById('providers-msg').textContent, /boom/);
      assert.equal(doc.querySelector('#providers-list .mv-providers'), null, 'no card over a missing payload');
      delete routes['/api/providers'];
      window.dispatchEvent(new window.Event('focus'));   // the same content as the card that was taken away
      await settle();
      await go(window, 'models/jobs');
      await go(window, 'models/providers');
      assert.ok(doc.querySelector('#providers-list .mv-providers'));
    } },
    ...[['fails', { error: 'stale boom' }, 500], ['answers with other content', { stale: true }, 200], ['throws', new Error('stale offline')]].map(([how, body, status]) => ({ name: `an older entry's providers read that ${how} after a newer entry drew the card leaves the card, its line and what was typed in it, and flashes nothing`, run: async () => {
      const routes = {};
      const { window, doc } = await boot({ hash: 'chat', routes });
      const errors = errorsOf(window);
      const stale = heldRoute(body, status);
      routes['/api/providers'] = stale.route;
      await go(window, 'models/providers/openai');
      await go(window, 'chat');
      delete routes['/api/providers'];   // the newer entry's read answers at once
      await go(window, 'models/providers/openai');
      const card = doc.querySelector('#providers-list .mv-providers');
      assert.ok(card, 'the newer entry drew the card');
      pvCard(doc, 'openai').classList.remove('is-found');   // the newer entry's own flash
      const key = pvRow(doc, 'openai').querySelector('.mv-pv-key');
      key.value = 'sk-test';
      key.dispatchEvent(new window.Event('input', { bubbles: true }));
      stale.release();
      await settle(12);
      assert.equal(doc.querySelector('#providers-list .mv-providers'), card, 'the older read neither took the card away nor drew it again');
      assert.equal(doc.getElementById('providers-msg').textContent, '');
      assert.equal(pvRow(doc, 'openai').querySelector('.mv-pv-key').value, 'sk-test');
      assert.equal(pvCard(doc, 'openai').classList.contains('is-found'), false, 'the older entry revealed nothing');
      assert.deepEqual(errors, []);
    } })),
    ...[['models/providers/openai', (doc) => pvCard(doc, 'openai')], ['models/model/my-gpt', (doc) => doc.querySelector('#models-list .mdl-row[data-id="my-gpt"]')]].map(([hash, target]) => ({ name: `with a broker on, a reload on #${hash} still draws and finds its row (the boot's credentials re-read overtakes the entry's read)`, run: async () => {
      const routes = {
        '/api/credentials': { enabled: true },
        '/api/models': { models: [{ id: 'my-gpt', label: 'My GPT', efforts: ['high'], engine: 'claude', env: {} }], predefined: [], efforts: ['high'] },
      };
      const { doc, calls } = await boot({ hash, routes });
      await settle();
      assert.ok(calls.filter((c) => c === 'GET /api/providers').length > 1, 'the re-read did run');
      assert.ok(target(doc)?.classList.contains('is-found'), 'the entry revealed its row on the newest read');
    } })),
    { name: 'with a broker on, an entry read that throws while the boot\'s re-read is out waits for it, then draws and finds the row', run: async () => {
      const first = heldRoute(new Error('offline'));
      const second = heldRoute({});
      let n = 0;
      const routes = { '/api/credentials': { enabled: true }, '/api/providers': () => (++n === 1 ? first.route() : second.route()) };
      const { doc } = await boot({ hash: 'models/providers/openai', routes });
      assert.equal(n, 2, 'the entry\'s read and the boot\'s re-read are both out');
      first.release();
      await settle();
      second.release();
      await settle(12);
      assert.ok(pvCard(doc, 'openai')?.classList.contains('is-found'), 'the entry revealed its row on the newest read');
      assert.equal(doc.getElementById('providers-msg').textContent, '');
    } },
    { name: 'a Save\'s follow-up read that lands after a newer entry drew the card draws nothing over it', run: async () => {
      const routes = { '/api/providers/openai': { openai: { baseUrl: 'http://localhost:11434/v1' } } };
      const { window, doc, calls } = await boot({ hash: 'models/providers', routes });
      const errors = errorsOf(window);
      const stale = heldRoute({ openai: { baseUrl: 'http://localhost:11434/v1' } });
      routes['/api/providers'] = stale.route;
      pvRow(doc, 'openai').querySelector('.mv-pv-save').click();
      await settle();
      assert.ok(calls.includes('PATCH /api/providers/openai'), 'the Save went out');
      await go(window, 'chat');
      delete routes['/api/providers'];
      await go(window, 'models/providers');
      const card = doc.querySelector('#providers-list .mv-providers');
      const key = pvRow(doc, 'openai').querySelector('.mv-pv-key');
      key.value = 'sk-test';
      key.dispatchEvent(new window.Event('input', { bubbles: true }));
      stale.release();
      await settle(12);
      assert.equal(doc.querySelector('#providers-list .mv-providers'), card, 'the refresh did not draw the card again');
      assert.equal(pvRow(doc, 'openai').querySelector('.mv-pv-key').value, 'sk-test');
      assert.deepEqual(errors, []);
    } },
    { name: 'a focus re-read with new content leaves the card on screen as it is', run: async () => {
      const routes = { '/api/credentials': { enabled: true } };
      const { window, doc } = await boot({ hash: 'models/providers', routes });
      const card = doc.querySelector('#providers-list .mv-providers');
      routes['/api/providers'] = { openai: { baseUrl: 'http://localhost:11434/v1' } };
      window.dispatchEvent(new window.Event('focus'));
      await settle();
      assert.equal(doc.querySelector('#providers-list .mv-providers'), card);
    } },
    { name: 'a focus re-read that works on a Providers tab a failed read left blank draws the card at once and clears the line', run: async () => {
      const routes = { '/api/credentials': { enabled: true } };
      const { window, doc } = await boot({ hash: 'chat', routes });
      routes['/api/providers'] = () => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) });
      await go(window, 'models/providers');
      assert.equal(doc.querySelector('#providers-list .mv-providers'), null);
      assert.match(doc.getElementById('providers-msg').textContent, /boom/);
      delete routes['/api/providers'];
      window.dispatchEvent(new window.Event('focus'));
      await settle();
      assert.ok(doc.querySelector('#providers-list .mv-providers'), 'drawn without a tab switch');
      assert.equal(doc.getElementById('providers-msg').textContent, '');
    } },
    { name: 'a Save whose follow-up providers read fails draws no default card over the missing payload (its next Save would blank the base URL)', run: async () => {
      const routes = { '/api/providers/openai': { openai: { baseUrl: 'http://localhost:11434/v1' } } };
      const { window, doc, calls } = await boot({ hash: 'models/providers', routes });
      const errors = errorsOf(window);
      routes['/api/providers'] = () => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) });
      const url = pvRow(doc, 'openai').querySelector('.mv-pv-baseurl');
      url.value = 'http://localhost:11434/v1';
      url.dispatchEvent(new window.Event('input', { bubbles: true }));
      pvRow(doc, 'openai').querySelector('.mv-pv-save').click();
      await settle(12);
      assert.ok(calls.includes('PATCH /api/providers/openai'), 'the Save went out');
      assert.match(doc.getElementById('providers-msg').textContent, /boom/);
      assert.equal(doc.querySelector('#providers-list .mv-providers'), null);
      assert.deepEqual(errors, []);
    } },
    { name: 'a Copilot sign-in started on the Providers tab draws its code there at once', run: async () => {
      const { window, doc } = await boot({ hash: 'models/providers', routes: { '/api/providers/copilot/login': { deviceCode: 'd1', userCode: 'ABCD-1234', interval: 30 } } });
      const errors = errorsOf(window);
      const polls = holdPolls();
      try {
        doc.querySelector('#providers-list .mv-cp-signin').click();
        await settle();
      } finally { polls.restore(); }
      assert.equal(doc.querySelector('#providers-list .mv-cp-code')?.textContent, 'ABCD-1234');
      assert.equal(polls.held.length, 1, 'the first poll waits on its timer');
      assert.deepEqual(errors, []);
    } },
    { name: 'with a broker on, a Copilot sign-in whose refresh a window-focus re-read overtakes still draws the connected card', run: async () => {
      const routes = {
        '/api/credentials': { enabled: true },
        '/api/providers/copilot/login/': { ok: true, login: 'ada' },
        '/api/providers/copilot/login': { deviceCode: 'd1', userCode: 'ABCD-1234', interval: 30 },
        '/api/providers/copilot/models': { models: [] },
      };
      const { window, doc } = await boot({ hash: 'models/providers', routes });
      const errors = errorsOf(window);
      const polls = holdPolls();
      try {
        doc.querySelector('#providers-list .mv-cp-signin').click();
        await settle();
      } finally { polls.restore(); }
      assert.equal(doc.querySelector('#providers-list .mv-cp-code')?.textContent, 'ABCD-1234');
      const connected = { copilot: { connected: true, login: 'ada', accountType: 'individual', maxConcurrent: 4 } };
      const refresh = heldRoute(connected);
      let reads = 0;   // 1: the poll's reloadProviders, 2: the refresh's load (held), 3: the focus re-read
      routes['/api/providers'] = () => (++reads === 2 ? refresh.route() : { ok: true, status: 200, json: async () => connected });
      const poll = polls.held[0]();   // github.com approved the code
      await settle();
      assert.equal(reads, 2, 'the refresh\'s read is out');
      window.dispatchEvent(new window.Event('focus'));   // the user comes back to the worca tab
      await settle();
      assert.equal(reads, 3, 'the focus re-read ran and landed first');
      refresh.release();
      await poll;
      await settle(12);
      assert.equal(doc.querySelector('#providers-list .mv-cp-code'), null, 'the device code is gone');
      assert.ok(doc.querySelector('#providers-list .mv-cp-signout'), 'the card shows the connected state');
      assert.deepEqual(errors, []);
    } },
    { name: 'with a broker on, a Copilot sign-out whose refresh a window-focus re-read overtakes still draws the signed-out card', run: async () => {
      let connected = true;
      const res = (body) => ({ ok: true, status: 200, json: async () => body });
      const pv = () => ({ copilot: { connected, login: 'ada', accountType: 'individual', maxConcurrent: 4 } });
      const refresh = heldRoute({ copilot: { connected: false, login: 'ada', accountType: 'individual', maxConcurrent: 4 } });
      let holdNext = false;
      let reads = 0;
      const { window, doc } = await boot({ hash: 'models/providers', routes: {
        '/api/credentials': { enabled: true },
        '/api/providers/copilot/logout': () => { connected = false; holdNext = true; return res(pv()); },
        '/api/providers/copilot/models': { models: [] },
        '/api/providers': () => { if (holdNext) { holdNext = false; return refresh.route(); } reads++; return res(pv()); },
      } });
      const errors = errorsOf(window);
      assert.ok(doc.querySelector('#providers-list .mv-cp-signout'), 'signed in');
      doc.querySelector('#providers-list .mv-cp-signout').click();
      await settle();
      doc.getElementById('confirm-ok').click();
      await settle();
      assert.equal(holdNext, false, 'the refresh\'s read is out');
      const before = reads;
      window.dispatchEvent(new window.Event('focus'));
      await settle();
      assert.equal(reads, before + 1, 'the focus re-read ran and landed first');
      refresh.release();
      await settle(12);
      assert.equal(doc.querySelector('#providers-list .mv-cp-signout'), null, 'no Sign out button left');
      assert.ok(doc.querySelector('#providers-list .mv-cp-signin'), 'the card shows the signed-out state');
      assert.deepEqual(errors, []);
    } },
    { name: 'a sign-in error that lands while the Catalogue shows is on the card when Providers opens again', run: async () => {
      const routes = {
        '/api/providers/copilot/login/': { error: 'The code expired. Start the sign-in again.' },
        '/api/providers/copilot/login': { deviceCode: 'd1', userCode: 'ABCD-1234', interval: 30 },
      };
      const { window, doc } = await boot({ hash: 'models/providers', routes });
      const polls = holdPolls();
      try {
        doc.querySelector('#providers-list .mv-cp-signin').click();
        await settle();
      } finally { polls.restore(); }
      await go(window, 'models');
      await polls.held[0]();   // the poll answers with the error off the tab
      await settle();
      await go(window, 'models/providers');
      const status = doc.querySelector('#providers-list .mv-cp-status');
      assert.equal(status?.textContent, 'The code expired. Start the sign-in again.');
      assert.ok(status.classList.contains('err'));
    } },
    { name: 'a free-requests answer that lands while Jobs shows is on the OpenRouter row when Providers opens again', run: async () => {
      const free = heldRoute({ enabled: true, known: true, remaining: 37, limit: 50 });
      const { window, doc } = await boot({ hash: 'models/providers', routes: { '/api/openrouter/free-daily': free.route } });
      const card = doc.querySelector('#providers-list .mv-providers');
      await go(window, 'models/jobs');
      free.release();
      await settle();
      await go(window, 'models/providers');
      assert.equal(doc.querySelector('#providers-list .mv-providers'), card, 'the card was not drawn again');
      assert.equal(pvRow(doc, 'openrouter').querySelector('.mv-pv-msg').textContent, 'Free-model requests today: 37 of 50 left.');
      assert.equal(pvRow(doc, 'openai').querySelector('.mv-pv-msg').textContent, '');
    } },
    { name: 'the OpenRouter row\'s Save PATCHes its own block with the routing defaults (Saved on the button); the OpenAI row\'s Save still PATCHes its row', run: async () => {
      const routes = { '/api/providers/openrouter': {}, '/api/providers/openai': {} };
      const { window, doc } = await boot({ hash: 'models/providers', routes });
      const errors = errorsOf(window);
      const bodies = [];
      const inner = window.fetch;
      globalThis.fetch = window.fetch = (u, opts = {}) => { if (opts.method === 'PATCH') bodies.push(`${u} ${opts.body}`); return inner(u, opts); };
      const row = () => pvRow(doc, 'openrouter');
      row().querySelector('.mv-or-order').value = 'anthropic, google';
      row().querySelector('.mv-or-sort').value = 'price';
      row().querySelector('.mv-or-fallbacks').checked = false;
      row().querySelector('.mv-pv-save').click();
      await settle();
      assert.deepEqual(bodies, ['/api/providers/openrouter {"maxConcurrent":8,"order":["anthropic","google"],"sort":"price","allowFallbacks":false}']);
      assert.equal(row().querySelector('.mv-pv-save').dataset.fbState, 'done', 'the button reads Saved');
      pvRow(doc, 'openai').querySelector('.mv-pv-save').click();
      await settle();
      assert.deepEqual(bodies.slice(1), ['/api/providers/openai {"baseUrl":"","maxConcurrent":8}']);
      assert.deepEqual(errors, []);
    } },
    { name: 'the OpenRouter row\'s Import models… opens Add model at step 2 on OpenRouter over the Catalogue, and lists it', run: async () => {
      // The list arm first: the /api/providers body would answer every /api/providers/… request too (a prefix).
      const routes = {
        '/api/providers/openai/models': { server: 'openrouter', serverLabel: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', warnings: [], models: [] },
        '/api/providers': { openrouter: { keySet: true } },
      };
      const { window, doc, calls } = await boot({ hash: 'models/providers', routes });
      const errors = errorsOf(window);
      pvRow(doc, 'openrouter').querySelector('.mv-or-browse').click();
      assert.equal(window.location.hash, '#models', 'the Catalogue at the click');
      await settle();
      assert.equal(panel(doc, 'catalogue').hidden, false, 'the Catalogue panel shows');
      assert.equal(doc.getElementById('model-editor-modal').classList.contains('hidden'), false, 'Add model opens over the catalog');
      assert.equal(doc.querySelector('#mv-editor-host .mdl-add[data-step="2"] .mdl-add-provider').value, 'openrouter');
      assert.ok(calls.includes('GET /api/providers/openai/models?baseUrl=https%3A%2F%2Fopenrouter.ai%2Fapi%2Fv1'), 'OpenRouter\'s list asked for');
      assert.deepEqual(errors, []);
    } },
    { name: 'the OpenRouter row\'s Test asks its own route and toasts "OpenRouter connected"; a missing key gets no base-URL hint', run: async () => {
      // Prefix match, first key wins: the Test route before the PATCH route.
      const routes = {
        '/api/providers/openrouter/test': { ok: true, models: 3, detail: 'credit $1' },
        '/api/providers/openrouter': {},
      };
      const { window, doc, calls } = await boot({ hash: 'models/providers', routes });
      const errors = errorsOf(window);
      const bodies = [];
      const inner = window.fetch;
      globalThis.fetch = window.fetch = (u, opts = {}) => { if (String(u).startsWith('/api/providers/openrouter/test')) bodies.push(String(opts.body)); return inner(u, opts); };
      doc.getElementById('toasts').replaceChildren();
      pvRow(doc, 'openrouter').querySelector('.mv-pv-test').click();
      await settle();
      assert.ok(calls.includes('POST /api/providers/openrouter/test'));
      assert.deepEqual(lastToast(doc), { tone: 'ok', title: 'OpenRouter connected', detail: 'OpenRouter answered with 3 models. Key: credit $1.', action: '' });
      routes['/api/providers/openrouter/test'] = { ok: false, message: 'no API key configured — OpenRouter lists models without one, but every call needs it' };
      pvRow(doc, 'openrouter').querySelector('.mv-pv-key').value = 'sk-or-typed';
      pvRow(doc, 'openrouter').querySelector('.mv-pv-test').click();
      await settle();
      assert.deepEqual(bodies, ['{}', '{"apiKey":"sk-or-typed"}'], 'the key only when typed, and never a base URL');
      const alert = cardAlertOf(pvCard(doc, 'openrouter'));
      assert.equal(alert.title, 'OpenRouter: connection failed');
      assert.match(alert.detail, /^no API key configured — OpenRouter lists models without one, but every call needs it/);
      assert.doesNotMatch(alert.detail, /base URL/);
      assert.deepEqual(errors, []);
    } },
    { name: 'a Copilot import started on the Providers tab lands on the Catalogue', run: async () => {
      const routes = {
        '/api/providers/copilot/models': { models: [{ id: 'gpt-5', name: 'GPT-5', vendor: 'OpenAI' }] },
        '/api/providers/copilot/import-models': { created: ['copilot-gpt-5'], updated: [], skipped: [] },
        '/api/providers': { copilot: { connected: true, login: 'ada', accountType: 'individual', maxConcurrent: 4 } },
      };
      const { window, doc } = await boot({ hash: 'models/providers', routes });
      doc.querySelector('#providers-list .mv-cp-fetch-models').click();
      await settle();
      assert.equal(doc.querySelector('#mv-editor-host .mdl-add[data-step="2"] .mdl-add-provider').value, 'copilot', 'Add model, step 2, on Copilot');
      const cb = doc.querySelector('#mimp-body .mvi-cb');
      cb.checked = true;
      cb.dispatchEvent(new window.Event('change', { bubbles: true }));
      doc.getElementById('mimp-go').click();
      await settle(12);
      assert.equal(window.location.hash, '#models');
      assert.deepEqual(shownPanels(doc), ['catalogue']);
    } },
    ...['models', 'models/jobs', 'models/providers'].map((hash) => ({ name: `at Simple, #${hash} opens under the Models banner; the Roles card stays Simple`, run: async () => {
      const { doc } = await boot({ hash, level: 'simple' });
      assert.equal(doc.getElementById('level-banner').hidden, false);
      assert.equal(doc.getElementById('level-banner-text').textContent, 'Models is part of Expert mode, so it is not in your menu.');
      assert.equal(doc.getElementById('model-roles-card').dataset.minLevel, 'simple');
    } })),
    { name: 'app.js no longer routes to, checks or loads a Providers view', run: async () => {
      const src = readFileSync(appPath, 'utf8');
      assert.doesNotMatch(src, /showView\('providers'/);
      assert.doesNotMatch(src, /currentView\(\) [!=]== 'providers'/);
      assert.doesNotMatch(src, /loadProvidersView/);
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
      assert.deepEqual([...doc.querySelectorAll('#settings-tabs button[data-tab]')].map((b) => b.dataset.tab), ['general', 'tags', 'presets', 'runs', 'automations', 'experimental', 'ask', 'guardrails', 'memory']);
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
  assert.ok(files.includes('app.js'));
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
      // A Settings tab button (markup or a JS selector); the Models page's panels carry data-tab too, but are no Settings tab.
      /currentSettingsTab [!=]== '(plugins|mcp|models|providers)'/g, /(?:<button\b[^>]*\s|button\[)data-tab="(plugins|mcp|models|providers)"/g]) {
      for (const m of src.matchAll(re)) offenders.push(`${f}: ${m[0]}`);
    }
  }
  assert.deepEqual(offenders, []);
});

/** The files the copy sweeps read: the app, the server, the user docs and each plugin's README. */
function copyFiles() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const walk = (dir) => readdirSync(root + dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory()
    ? (e.name === 'vendor' ? [] : walk(`${dir}/${e.name}`)) : [`${dir}/${e.name}`]));
  const docs = ['README.md', 'THIRD_PARTY_NOTICES.md', '.claude/skills/creating-worca-cc-plugins/SKILL.md',
    ...readdirSync(root + 'docs').filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`),
    ...readdirSync(root + 'plugins').map((d) => `plugins/${d}/README.md`).filter((f) => { try { readFileSync(root + f); return true; } catch { return false; } })];
  const files = [...walk('ui/public'), ...walk('src'), SERVER_MJS].filter((f) => /\.(m?js|html|css)$/.test(f)).concat(docs);
  return { root, files, docs };
}
const readCopy = (root, f) => (f === SERVER_MJS ? readServerSource() : readFileSync(root + f, 'utf8'));

// U7: the four pages are named as pages ("the Providers page", "Connectors › Skills"); no string, prompt,
// comment or user doc still sends anyone to a Settings tab that is gone. (docs/superpowers, docs/plans and
// docs/changelog are history: they keep the words of their day.)
test('no copy in the app, the server or the docs points at Settings › Plugins / Sets / Models / Providers', () => {
  const { root, files, docs } = copyFiles();
  assert.ok(files.length > 50 && docs.length > 10, 'the sweep reads the tree');
  const offenders = [];
  for (const f of files) {
    const src = readCopy(root, f);
    for (const m of src.matchAll(/Settings\s*[›>→▸]\s*(Plugins|Sets|Models|Providers)\b/g)) offenders.push(`${f}: ${m[0]}`);
    // A path through the old Plugins place ("worca → Plugins → <plugin> → Settings"); "Plugins → Marketplace" names the rename.
    for (const m of src.matchAll(/\bPlugins\s*[›>→▸]\s*(?!Marketplace\b)\S+/g)) offenders.push(`${f}: ${m[0]}`);
  }
  assert.deepEqual(offenders, []);
});

// P7 (final sweep): nothing names the Marketplace page's old sections — the Available list, a plugin card, a plugin's
// Settings reached straight from the page (it lives under Installed now).
test('no copy points at the Marketplace page\'s old Available list, plugin cards or a Settings path past Installed', () => {
  const { root, files } = copyFiles();
  const offenders = [];
  for (const f of files) {
    const src = readCopy(root, f);
    for (const re of [/Marketplace\s*[›>→▸]\s*Available\b/g, /\bAvailable list\b/g, /\*\*Available\*\*/g, /\bMarketplace card\b/g,
      /Marketplace\s*[›>→▸]\s*(?!Installed\b|Browse\b|Marketplaces\b|Add marketplace\b)\S+\s*[›>→▸]\s*Settings\b/g,
      /Marketplace page:\s*(?!Installed\b)\S+\s*›\s*Settings\b/g]) {
      for (const m of src.matchAll(re)) offenders.push(`${f}: ${m[0]}`);
    }
  }
  assert.deepEqual(offenders, []);
});

// ── the sidebar's Add-ons group (CONTRACT §3) ─────────────────────────────────
test('the sidebar\'s Add-ons group sits between Workflows and Manage: a label and three rows, each with its level', () => {
  const doc = new JSDOM(html).window.document;
  const sect = [...doc.querySelectorAll('.nav > .nav-sect')].find((s) => s.textContent.trim() === 'Add-ons');
  assert.ok(sect, 'the Add-ons label');
  assert.equal(sect.dataset.minLevel, 'advanced', 'the label hides with its Advanced rows');
  assert.equal(sect.previousElementSibling.dataset.nav, 'requirements', 'right after the last Build row (Requirements follows Workflows)');
  const rows = [];
  for (let n = sect.nextElementSibling; n && n.tagName === 'BUTTON'; n = n.nextElementSibling) rows.push(n);
  assert.deepEqual(rows.map((b) => [b.dataset.nav, b.dataset.minLevel, b.querySelector(':scope > span').textContent]), [
    ['marketplace', 'advanced', 'Marketplace'], ['connectors', 'advanced', 'Connectors'],
    ['models', 'expert', 'Models'],
  ]);
  for (const b of rows) assert.equal(b.firstElementChild.tagName.toLowerCase(), 'svg', `${b.dataset.nav}: the icon comes first`);
  assert.equal(rows.at(-1).nextElementSibling.textContent.trim(), 'Manage');
});

test('an Add-ons row opens its page, lights itself and names the page in the top bar; at Simple the open page keeps its row', async () => {
  const rows = [['marketplace', 'Marketplace'], ['connectors', 'Connectors'], ['models', 'Models']];
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
      // The Marketplace and Models pages' own tab strips mark their selected tab too (marketplace CONTRACT §5, models C1);
      // the sidebar lights one row.
      assert.deepEqual([...doc.querySelectorAll('[aria-current="page"]:not(.mk-tab):not(.mdl-tab)')].map((n) => n === row), [true], 'only the open page is lit: Settings is not');
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
  const LOAD = { marketplace: 'POST /api/marketplaces/refresh', connectors: 'GET /api/mcp/sets', models: 'GET /api/models' };
  const OLD = { marketplace: 'settings/plugins', connectors: 'settings/mcp', models: 'settings/models' };
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

// The Providers tab (models-menu P3): fold rows over today's row bodies, glued on in app.js. Rows start folded and
// stay as the person left them through a redraw; a link to a row unfolds it; what was typed survives a redraw while a
// Save shows the server's values; Copilot saves with its button; the broker hides keys; the summaries count models.
test('Providers tab: fold state, reveal, and repaint that keeps typing', async () => {
  /** GET /api/providers with every block: Copilot signed in (Individual, 2 at a time), images on OpenAI, no broker. */
  const P = {
    copilot: { connected: true, login: 'octo', accountType: 'individual', maxConcurrent: 2, tokenSource: 'stored', tokenRef: null, quota: { used: 12, entitlement: 300, unlimited: false, resetDate: '2026-10-01' } },
    openrouter: { keySet: true, keySource: 'stored', keyRef: null, keyMasked: '••••••1234', legacyKey: false, maxConcurrent: 8, order: ['anthropic'], sort: 'price', allowFallbacks: true },
    openai: { configured: true, keyOptional: false, keySet: true, keySource: 'stored', keyRef: null, keyMasked: '••••••abcd', baseUrl: 'https://gw.example/v1', maxConcurrent: 8 },
    anthropic: { configured: true, keyOptional: false, keySet: true, keySource: 'stored', keyRef: null, keyMasked: '••••••wxyz', baseUrl: 'https://api.anthropic.com', maxConcurrent: 8 },
    speech: {
      stt: { engine: 'browser', baseUrl: '', model: 'whisper-1', language: 'auto', configured: false, keySet: false, keySource: null, keyMasked: null, keyRef: null, keyMissing: false },
      tts: { engine: 'browser', baseUrl: '', model: 'tts-1', voice: 'af_heart', speed: 1, configured: false, keySet: false, keySource: null, keyMasked: null, keyRef: null, keyMissing: false },
    },
    images: { service: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-image-2.6-flare', price: 0.04, configured: true, keySet: true, keySource: 'stored', keyRef: null, keyMasked: '••••••efgh', keyMissing: false },
    sound: { keySet: true, keySource: 'stored', keyRef: null, keyMasked: '••••••cdef', keyMissing: false, configured: true },
    broker: { enabled: false },
  };
  /** The same with the credential broker on: Copilot signed out (so its Sign in is drawn), a key page known. */
  const BROKER = { ...P, copilot: { connected: false, accountType: 'individual', maxConcurrent: 4 }, broker: { enabled: true, keyPage: 'https://keys.example/', providers: {} } };
  const item = (doc, name) => doc.querySelector(`#providers-list .mv-pv-card[data-row="${name}"]`);
  const head = (doc, name) => item(doc, name).querySelector(':scope > .mdl-fold');
  const body = (doc, name) => item(doc, name).querySelector(':scope > .mdl-fold-body');
  const type = (window, input, value) => { input.value = value; input.dispatchEvent(new window.Event('input', { bubbles: true })); };
  const errorsOf = (window) => { const list = []; window.addEventListener('error', (e) => list.push(e.message)); return list; };
  /** Records every PATCH as "<url> <body>" (installed after boot, before the clicks). */
  const patches = (window) => {
    const bodies = [];
    const inner = window.fetch;
    globalThis.fetch = window.fetch = (u, opts = {}) => { if (opts.method === 'PATCH') bodies.push(`${u} ${opts.body}`); return inner(u, opts); };
    return bodies;
  };
  const heldRoute = (answer) => {
    let release;
    const held = new Promise((r) => { release = r; });
    return { route: () => held.then(() => ({ ok: true, status: 200, json: async () => answer })), release: () => release() };
  };
  await checkRows([
    { name: 'every row starts folded; a head click unfolds one, and a redraw keeps it open (and folded again once folded)', run: async () => {
      const { window, doc } = await boot({ hash: 'models/providers', routes: { '/api/providers': P } });
      const errors = errorsOf(window);
      assert.deepEqual([...doc.querySelectorAll('#providers-list .mdl-fold-body')].map((b) => b.hidden), [true, true, true, true, true, true, true]);
      head(doc, 'openai').click();
      assert.deepEqual([body(doc, 'openai').hidden, head(doc, 'openai').getAttribute('aria-expanded')], [false, 'true']);
      const drawn = item(doc, 'openai');
      window.__np.repaintProviders();
      assert.notEqual(item(doc, 'openai'), drawn, 'the tab was drawn again');
      assert.equal(body(doc, 'openai').hidden, false, 'the open row stays open');
      assert.equal(body(doc, 'anthropic').hidden, true);
      head(doc, 'openai').click();
      window.__np.repaintProviders();
      assert.equal(body(doc, 'openai').hidden, true, 'folded again, it stays folded');
      assert.deepEqual(errors, []);
    } },
    { name: 'a key typed in a row and a switch turned off survive folding the row and a redraw', run: async () => {
      const { window, doc } = await boot({ hash: 'models/providers', routes: { '/api/providers': P } });
      head(doc, 'openai').click();
      const key = item(doc, 'openai').querySelector('.mv-pv-key');
      type(window, key, 'sk-typed');
      head(doc, 'openai').click();
      const fallbacks = item(doc, 'openrouter').querySelector('.mv-or-fallbacks');
      fallbacks.checked = false;
      fallbacks.dispatchEvent(new window.Event('change', { bubbles: true }));
      window.__np.repaintProviders();
      const now = item(doc, 'openai').querySelector('.mv-pv-key');
      assert.notEqual(now, key, 'a new field');
      assert.equal(now.value, 'sk-typed');
      assert.equal(body(doc, 'openai').hidden, true, 'still folded');
      assert.equal(item(doc, 'openrouter').querySelector('.mv-or-fallbacks').checked, false, 'the switch stays off');
    } },
    { name: 'a listed image model picked over a stored typed one comes back picked from the list after a redraw', run: async () => {
      const typed = { ...P, images: { ...P.images, model: 'gpt-image-custom' } };
      const { window, doc } = await boot({ hash: 'models/providers', routes: { '/api/providers': typed } });
      const images = () => item(doc, 'images');
      head(doc, 'images').click();
      assert.equal(images().querySelector('.mv-im-model').value, 'gpt-image-custom', 'drawn typed: the id is not on the list');
      images().querySelector('.mv-im-model-list').click();   // "Pick from list"
      const pick = images().querySelector('.mv-im-model-pick');
      pick.value = 'gpt-image-2.5-flare';
      pick.dispatchEvent(new window.Event('change', { bubbles: true }));
      doc.activeElement.blur();
      window.__np.repaintProviders();
      assert.equal(images().querySelector('.mv-im-model'), null);
      assert.equal(images().querySelector('.mv-im-model-pick')?.value, 'gpt-image-2.5-flare');
      assert.equal(doc.activeElement, doc.body, 'the redraw moved no cursor');
    } },
    { name: 'a redraw keeps a changed image service, a picked or typed image model and a speech engine, with the fields they decide, and moves no cursor', run: async () => {
      const { window, doc } = await boot({ hash: 'models/providers', routes: { '/api/providers': P } });
      const errors = errorsOf(window);
      const change = (node, value) => { node.value = value; node.dispatchEvent(new window.Event('change', { bubbles: true })); };
      const images = () => item(doc, 'images');
      head(doc, 'images').click();
      head(doc, 'speech').click();
      change(images().querySelector('.mv-im-service'), 'xai');
      change(images().querySelector('.mv-im-model-pick'), 'grok-imagine-image');
      change(item(doc, 'speech').querySelector('.mv-sp-engine[data-kind="stt"]'), 'server');
      window.__np.repaintProviders();
      assert.equal(images().querySelector('.mv-im-service').value, 'xai');
      assert.equal(images().querySelector('.mv-im-field[data-field="baseUrl"]').value, 'https://api.x.ai/v1', 'the service set its address');
      assert.equal(images().querySelector('.mv-im-model-pick')?.value, 'grok-imagine-image', 'a listed id is picked from xAI\'s list');
      assert.equal(item(doc, 'speech').querySelector('.mv-sp-engine[data-kind="stt"]').value, 'server');
      assert.equal(item(doc, 'speech').querySelector('.mv-sp-server[data-kind="stt"]').hidden, false, 'the engine showed its server fields');
      // An id that is not on the list comes back typed, the way "Other model…" draws it.
      change(images().querySelector('.mv-im-model-pick'), '__other__');
      type(window, images().querySelector('.mv-im-model'), 'grok-custom');
      doc.activeElement.blur();
      window.__np.repaintProviders();
      assert.equal(images().querySelector('.mv-im-model-pick'), null);
      assert.equal(images().querySelector('.mv-im-model').value, 'grok-custom');
      assert.equal(doc.activeElement, doc.body, 'the redraw moved no cursor');
      assert.deepEqual(errors, []);
    } },
    { name: 'a redraw puts each typed value back in its own field: the TTS engine (not STT\'s), the image price (not its Base URL)', run: async () => {
      const { window, doc } = await boot({ hash: 'models/providers', routes: { '/api/providers': P } });
      const errors = errorsOf(window);
      const speech = () => item(doc, 'speech');
      const images = () => item(doc, 'images');
      head(doc, 'speech').click();
      const tts = speech().querySelector('.mv-sp-engine[data-kind="tts"]');
      tts.value = 'server';
      tts.dispatchEvent(new window.Event('change', { bubbles: true }));
      head(doc, 'images').click();
      images().querySelector('.mdl-disc').click();   // Advanced
      type(window, images().querySelector('.mv-im-field[data-field="price"]'), '0.07');
      window.__np.repaintProviders();
      // The two engines share their classes and differ by data-kind; Base URL and Price differ by data-field.
      assert.equal(speech().querySelector('.mv-sp-engine[data-kind="stt"]').value, 'browser', 'STT keeps its own engine');
      assert.equal(speech().querySelector('.mv-sp-engine[data-kind="tts"]').value, 'server');
      assert.equal(speech().querySelector('.mv-sp-server[data-kind="tts"]').hidden, false, 'the TTS engine showed its server fields');
      assert.equal(speech().querySelector('.mv-sp-server[data-kind="stt"]').hidden, true);
      assert.equal(images().querySelector('.mv-im-field[data-field="baseUrl"]').value, 'https://api.openai.com/v1', 'the address is untouched');
      assert.equal(images().querySelector('.mv-im-field[data-field="price"]').value, '0.07');
      assert.deepEqual(errors, []);
    } },
    { name: 'only edited fields carry over: another row\'s Save shows the server\'s new address in an untouched field and keeps a typed key', run: async () => {
      const moved = { ...P, openai: { ...P.openai, baseUrl: 'https://moved.example/v1' } };
      // Prefix match, first key wins: the PATCH route before the read.
      const routes = { '/api/providers/anthropic': moved, '/api/providers': P };
      const { window, doc } = await boot({ hash: 'models/providers', routes });
      const errors = errorsOf(window);
      const bodies = patches(window);
      routes['/api/providers'] = moved;   // the Save's follow-up read
      type(window, item(doc, 'openai').querySelector('.mv-pv-key'), 'sk-new');
      item(doc, 'anthropic').querySelector('.mv-pv-save').click();
      await settle(12);
      assert.deepEqual(bodies, ['/api/providers/anthropic {"baseUrl":"https://api.anthropic.com","maxConcurrent":8}']);
      assert.equal(item(doc, 'openai').querySelector('.mv-pv-baseurl').value, 'https://moved.example/v1', 'the untouched field shows the server\'s value');
      assert.equal(item(doc, 'openai').querySelector('.mv-pv-key').value, 'sk-new', 'the typed key stays');
      assert.deepEqual(errors, []);
    } },
    { name: 'a Save shows the server\'s values in its own row: the typed key gives way to its masked echo', run: async () => {
      const saved = { ...P, openrouter: { ...P.openrouter, keyMasked: '••••••5678' } };
      const routes = { '/api/providers/openrouter': saved, '/api/providers': P };
      const { window, doc } = await boot({ hash: 'models/providers', routes });
      const bodies = patches(window);
      routes['/api/providers'] = saved;
      type(window, item(doc, 'openrouter').querySelector('.mv-pv-key'), 'sk-or-new');
      item(doc, 'openrouter').querySelector('.mv-pv-save').click();
      await settle(12);
      assert.equal(bodies.length, 1);
      assert.match(bodies[0], /^\/api\/providers\/openrouter \{"apiKey":"sk-or-new",/);
      assert.equal(item(doc, 'openrouter').querySelector('.mv-pv-key').value, '••••••5678');
      assert.equal(item(doc, 'openrouter').querySelector('.mv-pv-save').dataset.fbState, 'done', 'the new Save reads Saved');
    } },
    { name: 'a fresh load on #models/providers/images (the tab not yet painted) unfolds the row, flashes it and focuses its key', run: async () => {
      const { window, doc } = await boot({ hash: 'models/providers/images', routes: { '/api/providers': P } });
      const errors = errorsOf(window);
      await settle();
      assert.equal(body(doc, 'images').hidden, false);
      assert.ok(item(doc, 'images').classList.contains('is-found'));
      assert.equal(doc.activeElement, item(doc, 'images').querySelector('.mv-pv-key'), 'the focus is inside the card, on its key');
      assert.equal(body(doc, 'openai').hidden, true, 'the other rows stay folded');
      window.__np.repaintProviders();
      assert.equal(body(doc, 'images').hidden, false, 'the row is open in the state, not only on screen');
      assert.deepEqual(errors, []);
    } },
    { name: 'a link to a row that is already open leaves it open', run: async () => {
      const { window, doc } = await boot({ hash: 'models/providers', routes: { '/api/providers': P } });
      head(doc, 'images').click();
      window.location.hash = 'models/providers/images';   // one hash write: one route, one reveal
      await settle(12);
      assert.equal(body(doc, 'images').hidden, false);
      assert.ok(item(doc, 'images').classList.contains('is-found'));
    } },
    { name: 'a link whose address moved on before the providers answered leaves its row folded and unmarked', run: async () => {
      const routes = { '/api/providers': () => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) }) };
      const { window, doc } = await boot({ hash: 'models/jobs', routes });
      await go(window, 'chat');
      const providers = heldRoute(P);
      routes['/api/providers'] = providers.route;
      window.location.hash = 'models/providers/images';   // an entry: its read is held, no row to reveal yet
      await settle(12);
      window.location.hash = 'models/providers';           // moved on inside the page: no new read
      await settle(12);
      providers.release();
      await settle(12);
      assert.ok(item(doc, 'images'), 'the tab drew once the read answered');
      assert.equal(body(doc, 'images').hidden, true);
      assert.equal(item(doc, 'images').classList.contains('is-found'), false);
      window.__np.repaintProviders();
      assert.equal(body(doc, 'images').hidden, true, 'the stale link opened nothing in the state either');
    } },
    { name: 'a link focuses the first field a person can use: a signed-in Copilot\'s Account (not the info tip before it), Speech\'s engine (not the key in its hidden server fields)', run: async () => {
      const { window, doc } = await boot({ hash: 'models/providers/copilot', routes: { '/api/providers': P } });
      await settle();
      assert.equal(body(doc, 'copilot').hidden, false);
      assert.equal(doc.activeElement, item(doc, 'copilot').querySelector('.mv-cp-account'));
      window.location.hash = 'models/providers/speech';
      await settle(12);
      assert.equal(doc.activeElement, item(doc, 'speech').querySelector('.mv-sp-engine[data-kind="stt"]'));
    } },
    { name: 'Copilot saves with its button: changing Account and the cap sends nothing, Save sends both', run: async () => {
      const routes = { '/api/providers/copilot/models': { models: [] }, '/api/providers/copilot': P, '/api/providers': P };
      const { window, doc } = await boot({ hash: 'models/providers', routes });
      const errors = errorsOf(window);
      const bodies = patches(window);
      const row = item(doc, 'copilot');
      for (const [sel, value] of [['.mv-cp-account', 'enterprise'], ['.mv-pv-conc', '4']]) {
        const field = row.querySelector(sel);
        field.value = value;
        field.dispatchEvent(new window.Event('input', { bubbles: true }));
        field.dispatchEvent(new window.Event('change', { bubbles: true }));
      }
      await settle();
      assert.deepEqual(bodies, [], 'a change saves nothing');
      row.querySelector('.mv-pv-save').click();
      await settle(12);
      assert.deepEqual(bodies, ['/api/providers/copilot {"accountType":"enterprise","maxConcurrent":4}']);
      assert.deepEqual(errors, []);
    } },
    { name: 'the Copilot row\'s Import models… opens Add model at step 2 on Copilot over the Catalogue', run: async () => {
      const routes = { '/api/providers/copilot/models': { models: [{ id: 'gpt-5', name: 'GPT-5', vendor: 'OpenAI' }] }, '/api/providers': P };
      const { window, doc } = await boot({ hash: 'models/providers', routes });
      item(doc, 'copilot').querySelector('.mv-cp-fetch-models').click();
      assert.equal(window.location.hash, '#models', 'the Catalogue at the click');
      await settle();
      assert.equal(doc.getElementById('models-tab-catalogue').hidden, false, 'the Catalogue panel shows');
      assert.equal(doc.getElementById('model-editor-modal').classList.contains('hidden'), false, 'the dialog is open');
      assert.equal(doc.querySelector('#mv-editor-host .mdl-add[data-step="2"] .mdl-add-provider').value, 'copilot');
      assert.ok(doc.querySelector('#mimp-body .mvi-cb[value="gpt-5"]'), 'its list');
    } },
    { name: 'with the broker on, keys, the Copilot sign-in and the provider Tests are hidden; the media Tests and the note show', run: async () => {
      const { window, doc } = await boot({ hash: 'models/providers', routes: { '/api/providers': BROKER } });
      doc.head.insertAdjacentHTML('beforeend', `<style>${readStyleCss()}</style>`);
      const display = (n) => window.getComputedStyle(n).display;
      const keyFields = [...doc.querySelectorAll('#providers-list [data-row] .mv-field')].filter((f) => f.querySelector('.mv-pv-key'));
      assert.ok(keyFields.length >= 5, 'every row\'s key field is drawn');
      assert.deepEqual(keyFields.map(display).filter((d) => d !== 'none'), [], 'every key field is hidden');
      assert.equal(display(doc.querySelector('#providers-list .mv-cp-signin')), 'none');
      assert.equal(display(item(doc, 'openai').querySelector('.mv-pv-test')), 'none');
      assert.notEqual(display(doc.querySelector('#providers-list .mv-im-test')), 'none');
      const note = doc.querySelector('#providers-list .mv-broker-note');
      assert.ok(note && display(note) !== 'none', 'the note shows');
      assert.match(note.textContent, /held by the credential broker/);
      assert.equal(note.querySelector('a.mv-broker-link').getAttribute('href'), 'https://keys.example/');
    } },
    { name: 'with the broker on, a link to a row passes over what the broker hides: the OpenAI-compatible address, Copilot\'s Account', run: async () => {
      const { window, doc } = await boot({ hash: 'models/providers/openai', routes: { '/api/providers': BROKER } });
      await settle();
      assert.ok(item(doc, 'openai').classList.contains('is-found'));
      assert.equal(doc.activeElement, item(doc, 'openai').querySelector('.mv-pv-baseurl'), 'not the hidden key field');
      window.location.hash = 'models/providers/copilot';
      await settle(12);
      assert.equal(doc.activeElement, item(doc, 'copilot').querySelector('.mv-cp-account'), 'not the hidden Sign in');
    } },
    { name: 'a catalogue change redraws the summaries: one OpenRouter model reads " · 1 model" when the tab shows again', run: async () => {
      // One built-in from the start, so Claude Code's group draws its hide switch before the catalogue changes.
      const OPUS = { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['high'] };
      const routes = { '/api/providers': P, '/api/models': { models: [], predefined: [OPUS], efforts: [] } };
      const { window, doc } = await boot({ hash: 'models/providers', routes });
      const summary = () => item(doc, 'openrouter').querySelector('.mdl-fold-sum').textContent;
      assert.equal(summary(), 'openrouter.ai · 8 requests at a time');
      routes['/api/models'] = { models: [{ id: 'or-gpt', label: 'OR GPT', efforts: [], engine: 'claude', env: {}, upstream: { provider: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-5', api: 'openai-chat' } }],
        predefined: [OPUS], efforts: [] };
      await go(window, 'models');
      const cb = doc.querySelector('.mv-hide-builtin');
      cb.checked = !cb.checked;
      cb.dispatchEvent(new window.Event('change', { bubbles: true }));   // saves, then reads the catalogue again
      await settle(12);
      await go(window, 'models/providers');
      assert.equal(summary(), 'openrouter.ai · 8 requests at a time · 1 model');
    } },
    { name: 'the old card builder is gone from bridge-view.mjs', run: async () => {
      const name = ['renderProviders', 'Card'].join('');
      assert.equal(name in await import('../ui/public/bridge-view.mjs'), false);
    } },
    { name: 'Image generation on Other with no price: Save says so in the row and sends nothing', run: async () => {
      const other = { ...P, images: { service: 'other', baseUrl: 'http://127.0.0.1:7860/v1', model: 'sdxl', price: null, configured: false, keySet: false, keySource: null, keyRef: null, keyMasked: null, keyMissing: false } };
      const routes = { '/api/providers/images': {}, '/api/providers': other };
      const { window, doc } = await boot({ hash: 'models/providers', routes });
      const bodies = patches(window);
      item(doc, 'images').querySelector('.mv-im-save').click();
      await settle();
      const line = item(doc, 'images').querySelector('.mv-pv-msg');
      assert.deepEqual([line.textContent, line.classList.contains('err')], ['Enter a price; 0 for a free server', true]);
      assert.deepEqual(bodies, []);
    } },
    { name: 'a refused Save on a folded row unfolds it and shows the card\'s alert', run: async () => {
      const routes = { '/api/providers/openai': () => ({ ok: false, status: 400, json: async () => ({ error: 'bad key' }) }), '/api/providers': P };
      const { window, doc } = await boot({ hash: 'models/providers', routes });
      assert.equal(body(doc, 'openai').hidden, true);
      item(doc, 'openai').querySelector('.mv-pv-save').click();
      await settle();
      assert.equal(body(doc, 'openai').hidden, false);
      assert.deepEqual(cardAlertOf(item(doc, 'openai')), { title: 'Not saved', detail: 'bad key' });
      window.__np.repaintProviders();
      assert.equal(body(doc, 'openai').hidden, false, 'open in the state too');
    } },
    { name: 'a Save that goes through leaves a folded row folded: its opening clear unfolds nothing', run: async () => {
      const routes = { '/api/providers/openai': P, '/api/providers': P };
      const { doc } = await boot({ hash: 'models/providers', routes });
      item(doc, 'openai').querySelector('.mv-pv-save').click();
      await settle(12);
      assert.equal(body(doc, 'openai').hidden, true);
      assert.equal(cardAlertOf(item(doc, 'openai')), null);
    } },
  ]);
});
