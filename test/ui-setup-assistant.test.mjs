// test/ui-setup-assistant.test.mjs
// ui/public/setup-assistant.mjs — the seven-step setup dialog (plans/setup-assistant-design.md D11, D18, D19):
// the pure diff / gate helpers, then the dialog itself in jsdom with no app.js boot. Every dialog gets a
// routed fake fetchJson that records each request, manual timers the test flushes, and an injected clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import {
  SETUP_STEPS, TEST_PASS_MS, LOGIN_RETRY_STEPS, proxyKey, initialAnswers, rolePatch, diffRows, buildApplyBody, nextGate,
  stepOfField, setupStepForSignIn, safeHttpUrl, openSetupAssistant,
} from '../ui/public/setup-assistant.mjs';
import { checkRows } from './helpers/rows.mjs';
import { backdropClick, pressEscape, discardPrompt, keepEditing } from './helpers/popups.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const UNREACHABLE = 'Worca could not be reached. Check that it is still running.';

// ── fixtures ──
const SETTINGS = { uiLevel: 'simple', pipelineCostLimitUsd: 5, totalCostLimitUsd: null, costLimitResetPeriod: 'monthly',
  autoGeneratePrDescription: true, smartNaming: { suggestTitle: true, suggestBranch: true }, runEngine: null, modelRoles: {} };
const PROXY_OFF = { settings: { enabled: false }, login: null, state: 'off' };
const PROXY_ON = { settings: { enabled: true, upstream: 'http://proxy.acme.example:8080', auth: 'auto', noProxy: [] }, login: { domain: 'ACME', user: 'jdoe' }, state: 'ready' };
const PROVIDERS = { copilot: { connected: false, termsCurrent: false, accountType: 'individual', login: null },
  openai: { configured: false, baseUrl: '' }, anthropic: { configured: false, baseUrl: '' }, broker: { enabled: false } };
const CATALOG = [{ id: 'claude-opus-5-5', label: 'Opus 5.5' }, { id: 'claude-haiku-5-5', label: 'Haiku 5.5' }];
const check = (id, state, extra = {}) => ({ id, label: id, state, line: `${id} line`, ...extra });
const DETECT = { checks: [check('claude', 'ok'), check('git', 'ok'), check('direct', 'ok')] };
const DETECT_PROXY = { checks: [check('claude', 'ok'), check('proxyEnv', 'ok', { facts: { host: 'proxy.acme.example:8080' } }), check('direct', 'no')] };
const saved = ({ settings = SETTINGS, proxy = PROXY_OFF, providers = PROVIDERS } = {}) => ({ settings, proxy, providers, catalog: CATALOG });

// ── the jsdom harness ──
const tick = () => new Promise((r) => setImmediate(r));
const settle = async (n = 12) => { for (let i = 0; i < n; i++) await tick(); };
const reply = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, data });
function deferred() { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; }

/**
 * Open the dialog over routed fakes. `routes`: url (exact, or a prefix ending in '/') → an answer, or
 * (opts, n) => answer | Promise | throw. Returns the handle, the request log, timers and the clock.
 */
async function open({ entry = 'first', step = 'check', settings = SETTINGS, proxy = PROXY_OFF, providers = PROVIDERS, detect = DETECT, routes = {}, level = 'simple' } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><button id="opener">open</button></body></html>', { url: 'http://localhost/' });
  const { window } = dom; const doc = window.document;
  if (level) doc.documentElement.dataset.level = level;
  const log = []; const counts = new Map();
  const table = {
    '/api/settings': reply(settings), '/api/proxy/status': reply(proxy), '/api/providers': reply(providers),
    '/api/config': reply({ models: CATALOG }), '/api/setup/detect': detect ? reply(detect) : reply({ error: 'no' }, 500),
    '/api/proxy/test': reply({ ok: true, results: [{ host: 'api.anthropic.com', ok: true, ms: 12 }] }),
    ...routes,
  };
  const fetchJson = async (url, opts = {}) => {
    log.push({ url, method: opts.method || 'GET', body: opts.body === undefined ? undefined : structuredClone(opts.body) });
    const key = Object.prototype.hasOwnProperty.call(table, url) ? url : Object.keys(table).find((k) => k.endsWith('/') && url.startsWith(k));
    if (!key) return reply({ error: `no route ${url}` }, 404);
    const n = (counts.get(key) || 0) + 1; counts.set(key, n);
    const r = table[key];
    return typeof r === 'function' ? r(opts, n) : structuredClone(r);
  };
  const queue = []; let seq = 0;
  const timers = {
    setTimeout: (f, ms) => { const id = ++seq; queue.push({ id, f, ms }); return id; },
    clearTimeout: (id) => { const i = queue.findIndex((t) => t.id === id); if (i >= 0) queue.splice(i, 1); },
  };
  const clock = { t: 1_000_000 };
  const closes = [];
  const handle = openSetupAssistant({ doc, fetchJson, entry, step, timers, now: () => clock.t, onClose: (how) => closes.push(how) });
  await settle();
  const $ = (sel) => doc.querySelector(`#setup-modal ${sel}`);
  const h = {
    window, doc, handle, log, closes, clock, queue, $,
    $$: (sel) => [...doc.querySelectorAll(`#setup-modal ${sel}`)],
    field: (name) => [...doc.querySelectorAll('#setup-modal [data-sa-field]')].find((n) => n.dataset.saField === name),
    title: () => $('#setup-title').textContent,
    status: () => $('.sa-status'),
    next: () => $('.sa-next'),
    /** Run every queued timer once (the ones they queue wait for the next flush). */
    async flush() { const due = queue.splice(0); for (const t of due) await t.f(); await settle(); },
    async click(sel) { const n = typeof sel === 'string' ? $(sel) : sel; assert.ok(n, `no ${sel}`); n.click(); await settle(); },
    async type(sel, value) {
      const n = typeof sel === 'string' ? (h.field(sel) || $(sel)) : sel; assert.ok(n, `no ${sel}`);
      n.value = value; n.dispatchEvent(new window.Event('input', { bubbles: true })); await settle();
    },
    async pick(sel, value) {
      const n = typeof sel === 'string' ? (h.field(sel) || $(sel)) : sel; assert.ok(n, `no ${sel}`);
      n.value = value; n.dispatchEvent(new window.Event('change', { bubbles: true })); await settle();
    },
    async toggle(sel) {
      const n = $(sel); assert.ok(n, `no ${sel}`);
      n.checked = !n.checked; n.dispatchEvent(new window.Event('change', { bubbles: true })); await settle();
    },
    async goTo(id) { handle.goTo(id); await settle(); },
    applies: () => log.filter((r) => r.url === '/api/setup/apply' && r.method === 'POST'),
    close() { handle.close(); window.close(); },
  };
  return h;
}

/** From an open re-run: per-run limit 5 → 7, Review, Apply changes. */
async function applyLimit(h, value = '7') {
  await h.goTo('work');
  await h.type('work.pipelineCostLimitUsd', value);
  await h.goTo('review');
  await h.click('.sa-next');
}
const STEPS3 = [{ id: 'proxy-swap', label: 'Proxy' }, { id: 'copilot-signin', label: 'Copilot' }, { id: 'role-test.deep', label: 'Deep thinking' }];

/** Model access: Copilot on, notice accepted, device flow through to "connected". `pollAnswers`: one per poll. */
async function signInCopilot(h, { pollAnswers = [reply({ ok: true, login: 'jdoe' })] } = {}) {
  if (!h.$('.sa-src-copilot').checked) await h.toggle('.sa-src-copilot');
  assert.equal(h.$('.sa-cp-signin').disabled, true, 'Sign in waits for the notice');
  await h.toggle('.sa-cp-ack');
  assert.equal(h.$('.sa-cp-signin').disabled, false);
  await h.click('.sa-cp-signin');
  assert.equal(h.$('.mv-cp-code').textContent, 'ABCD-1234');
  for (let i = 0; i < pollAnswers.length; i++) await h.flush();
}
const COPILOT_ROUTES = (pollAnswers = [reply({ ok: true, login: 'jdoe' })]) => ({
  '/api/providers/copilot/acknowledge': reply({}),
  '/api/providers/copilot/login': reply({ deviceCode: 'd1', userCode: 'ABCD-1234', interval: 0 }),
  '/api/providers/copilot/login/': (_o, n) => { const a = pollAnswers[Math.min(n, pollAnswers.length) - 1]; if (a === 'throw') throw new Error('down'); return a; },
  '/api/providers/copilot/models': reply({ models: [{ id: 'claude-opus-5-5', name: 'Claude Opus 5.5', catalogId: 'copilot-claude-opus-5-5', inCatalog: false }] }),
});

// ── 1. pure functions ──

test('pure helpers: proxyKey, initialAnswers, buildApplyBody, rolePatch, diffRows, nextGate, safeHttpUrl, small helpers', async () => {
  const n = { host: 'proxy.acme.example', port: '8080', auth: 'auto', noProxy: '' };
  await checkRows([
    { name: 'proxyKey: same four values, same key; any one changed, another key', run: () => {
      assert.equal(proxyKey(n), proxyKey({ ...n }));
      for (const change of [{ host: 'p2.acme.example' }, { port: '8081' }, { auth: 'basic' }, { noProxy: '.corp' }]) assert.notEqual(proxyKey({ ...n, ...change }), proxyKey(n));
    } },
    { name: 'initialAnswers: a re-run keeps the saved proxy over detection; a first start fills a blank from HTTPS_PROXY; fix › access turns Copilot on', run: () => {
      const rerun = initialAnswers({ saved: saved({ proxy: PROXY_ON }), detect: { checks: [check('proxyEnv', 'ok', { facts: { host: 'other.example:3128' } })] }, entry: 'rerun' });
      assert.equal(rerun.network.host, 'proxy.acme.example');
      const first = initialAnswers({ saved: saved(), detect: DETECT_PROXY, entry: 'first' });
      assert.equal(first.network.mode, 'proxy'); assert.equal(first.network.host, 'proxy.acme.example'); assert.equal(first.network.port, '8080');
      assert.equal(first.found.proxy, 'proxy.acme.example:8080');
      assert.equal(initialAnswers({ saved: saved(), entry: 'fix', step: 'access' }).access.copilot, true);
    } },
    { name: 'buildApplyBody: nothing changed → {}; only the per-run limit → { work: { pipelineCostLimitUsd: 7 } }; a blank key never rides', run: () => {
      const s = saved(); const a = initialAnswers({ saved: s, entry: 'rerun' });
      assert.deepEqual(buildApplyBody(s, a), {});
      a.work.pipelineCostLimitUsd = 7;
      assert.deepEqual(buildApplyBody(s, a), { work: { pipelineCostLimitUsd: 7 } });
      for (const key of ['', '   ']) {
        const b = initialAnswers({ saved: s, entry: 'rerun' }); b.access.openai = true; b.access.openaiUrl = 'https://llm.acme.example/v1'; b.access.openaiKey = key;
        assert.equal(buildApplyBody(s, b).access.openai.apiKey, undefined);
      }
    } },
    { name: 'rolePatch: a cleared saved role is null; unchanged roles → {} and no models group', run: () => {
      const roles = { claude: { quick: { model: 'claude-haiku-5-5', effort: 'low' } } };
      assert.deepEqual(rolePatch(roles, { claude: { quick: null } }), { claude: { quick: null } });
      assert.deepEqual(rolePatch(roles, structuredClone(roles)), {});
      const s = saved({ settings: { ...SETTINGS, modelRoles: roles } });
      assert.equal(buildApplyBody(s, initialAnswers({ saved: s, entry: 'rerun' })).models, undefined);
    } },
    { name: 'diffRows: the cost-limit change marks exactly one row', run: () => {
      const s = saved(); const a = initialAnswers({ saved: s, entry: 'rerun' }); a.work.pipelineCostLimitUsd = 7;
      assert.deepEqual(diffRows(s, a).filter((r) => r.changed).map((r) => r.group), ['work']);
    } },
    { name: 'nextGate(network): a fresh pass for exactly the shown values, under TEST_PASS_MS; the saved proxy needs one too', run: () => {
      const s = saved({ proxy: PROXY_ON }); const a = initialAnswers({ saved: s, entry: 'rerun' }); const now = 5_000_000;
      const gate = (answers, tested, t = now) => nextGate('network', answers, { saved: s, tested, now: t });
      assert.deepEqual(gate(a, null), { ok: false, reason: 'Test the connection to continue' });
      const tested = { key: proxyKey(a.network), at: now };
      assert.equal(gate(a, tested).ok, true);
      assert.equal(gate(a, { ...tested, at: now - TEST_PASS_MS }).ok, false);
      for (const change of [{ host: 'p2.acme.example' }, { port: '8081' }, { auth: 'basic' }, { noProxy: '.corp' }]) {
        assert.equal(gate({ ...a, network: { ...a.network, ...change } }, tested).ok, false, JSON.stringify(change));
      }
    } },
    { name: 'nextGate(review): nothing changed is "Nothing changed." on a re-run and Finish on a first start', run: () => {
      const s = saved(); const a = initialAnswers({ saved: s, entry: 'rerun' });
      assert.deepEqual(nextGate('review', a, { saved: s, entry: 'rerun' }), { ok: false, reason: 'Nothing changed.' });
      const f = nextGate('review', a, { saved: s, entry: 'first' });
      assert.equal(f.ok, true); assert.equal(f.finish, true);
    } },
    { name: 'nextGate(access): consent first even when connected; acknowledgeTerms rides only as true from the switch', run: () => {
      const s = saved({ providers: { ...PROVIDERS, copilot: { ...PROVIDERS.copilot, connected: true } } });
      const a = initialAnswers({ saved: s, entry: 'rerun' });
      assert.equal(a.access.copilot, true); assert.equal(a.access.copilotAck, false);
      assert.deepEqual(nextGate('access', a, { saved: s }), { ok: false, reason: 'Accept the GitHub Copilot notice to continue' });
      a.access.copilotAccount = 'business';
      assert.equal('acknowledgeTerms' in buildApplyBody(s, a).access.copilot, false);
      a.access.copilotAck = true;
      assert.equal(buildApplyBody(s, a).access.copilot.acknowledgeTerms, true);
    } },
    { name: 'safeHttpUrl: http(s) only', run: () => {
      assert.equal(safeHttpUrl('https://keys.acme.example/'), 'https://keys.acme.example/');
      assert.equal(safeHttpUrl('http://localhost:4317/x'), 'http://localhost:4317/x');
      for (const bad of ['javascript:x', ' javascript:alert(1)', 'data:text/html,x', '//evil.example', '']) assert.equal(safeHttpUrl(bad), null, bad);
    } },
    { name: 'stepOfField, setupStepForSignIn, the step list and the login retry steps', run: () => {
      assert.equal(stepOfField('work.pipelineCostLimitUsd'), 'work');
      assert.equal(stepOfField('network.networkProxy'), 'network');
      assert.equal(stepOfField('nope'), 'review');
      assert.equal(setupStepForSignIn({ dataset: { provider: 'copilot' } }), 'access');
      assert.equal(setupStepForSignIn({ dataset: { provider: 'openai' } }), null);
      assert.equal(SETUP_STEPS.length, 7);
      assert.deepEqual([...LOGIN_RETRY_STEPS], ['proxy-swap', 'proxy-login']);
    } },
  ]);
});

// ── 2. the dialog ──

test('corporate Copilot path: proxy test → notice → device sign-in → roles → Apply, in one dialog (AC-4.2, AC-4.3)', async () => {
  const h = await open({ detect: DETECT_PROXY, routes: { ...COPILOT_ROUTES(), '/api/setup/apply': reply({ id: 'stp_1', steps: STEPS3 }, 202) } });
  try {
    assert.ok(h.doc.querySelector('#setup-modal .card.setup-card.dlg'), 'the card is laid out by layoutDialog');
    assert.equal(h.$('.sa-step-of').textContent, 'Step 1 of 7');
    await h.click('.sa-next');                               // Start
    assert.equal(h.title(), 'How does this machine reach the internet?');
    assert.match(h.$('.sa-found').textContent, /Found in your environment: proxy\.acme\.example:8080/);
    assert.equal(h.next().disabled, true);
    assert.equal(h.status().textContent, 'Test the connection to continue');
    await h.click('.sa-test');
    assert.equal(h.next().disabled, false, 'a pass for the shown values');
    await h.click('.sa-change');
    await h.type('network.networkProxy.port', '8081');
    assert.equal(h.next().disabled, true);
    assert.equal(h.status().textContent, 'Test the connection to continue');
    await h.click('.sa-test');
    await h.click('.sa-next');                               // → Model access
    assert.equal(h.title(), 'Where should Worca get its models?');
    await signInCopilot(h);
    assert.match(h.$('.sa-copilot').textContent, /Connected as @jdoe/);
    await h.click('.sa-next');                               // → Models
    await h.pick(h.$('.inherit-field[data-setting="models.claude.roles.deep"] .inherit-model'), 'copilot-claude-opus-5-5');
    await h.click('.sa-next'); await h.click('.sa-next');    // → How you work → Review
    assert.equal(h.next().textContent, 'Apply setup');
    await h.click('.sa-next');
    const urls = h.log.map((r) => r.url);
    assert.ok(urls.indexOf('/api/providers/copilot/acknowledge') < urls.indexOf('/api/providers/copilot/login'), 'acknowledge first');
    assert.equal(h.log.some((r) => r.url === '/api/settings' && r.method === 'POST'), false, 'no POST /api/settings');
    assert.equal(h.doc.documentElement.dataset.level, 'simple');
    const body = h.applies()[0].body;
    assert.equal(body.access.copilot.signIn, true);
    assert.equal(body.access.copilot.acknowledgeTerms, true);
    assert.ok(body.access.copilot.importModels.includes('claude-opus-5-5'));
    assert.equal(body.work?.uiLevel, undefined);
    assert.equal(body.network.networkProxy.upstream, 'http://proxy.acme.example:8081');
    assert.equal(h.title(), 'Setting up Worca…');
  } finally { h.close(); }
});

test('Network gate: each of host, port, Login and Go direct to re-locks Next after a pass; the pass expires on screen (qa-1-1, ux-2-4)', async () => {
  const h = await open({ entry: 'fix', step: 'network', proxy: PROXY_ON });
  try {
    assert.equal(h.title(), 'How does this machine reach the internet?');
    const edits = [
      ['host', () => h.type('network.networkProxy', 'p2.acme.example')],
      ['port', () => h.type('network.networkProxy.port', '3128')],
      ['login', () => h.pick('network.networkProxy.auth', 'basic')],
      ['go direct to', () => h.type('network.networkProxy.noProxy', '.corp.acme.example')],
    ];
    for (const [name, edit] of edits) {
      await h.click('.sa-test');
      assert.equal(h.next().disabled, false, `${name}: passed`);
      await edit();
      assert.equal(h.next().disabled, true, `${name}: re-locked`);
      assert.equal(h.status().textContent, 'Test the connection to continue', name);
    }
    await h.click('.sa-test');
    assert.equal(h.next().disabled, false);
    h.clock.t += TEST_PASS_MS;
    await h.flush();                                         // the pass timer repaints the foot, no input
    assert.equal(h.next().disabled, true);
    assert.equal(h.status().textContent, 'Test the connection to continue');
  } finally { h.close(); }
});

test('Network gate: changing a field back to the tested value without a new test keeps Next locked', async () => {
  const h = await open({ entry: 'fix', step: 'network', proxy: PROXY_ON });
  try {
    await h.click('.sa-test');
    assert.equal(h.next().disabled, false);
    await h.type('network.networkProxy', 'p2.acme.example');
    await h.type('network.networkProxy', 'proxy.acme.example');
    assert.equal(h.next().disabled, true);
    assert.equal(h.status().textContent, 'Test the connection to continue');
    await h.pick('network.networkProxy.auth', 'basic');
    await h.pick('network.networkProxy.auth', 'auto');
    assert.equal(h.next().disabled, true, 'Login back to the tested value');
  } finally { h.close(); }
});

test('keyboard: a step change moves focus into the dialog, and Tab / Shift+Tab wrap inside it', async () => {
  const h = await open({ entry: 'rerun' });
  try {
    const inside = () => h.$('.setup-card').contains(h.doc.activeElement);
    h.next().focus();
    await h.click('.sa-next');                               // Start → Network
    assert.equal(h.title(), 'How does this machine reach the internet?');
    assert.ok(inside(), `focus is on ${h.doc.activeElement?.tagName}`);
    await h.click('.sa-back');
    assert.ok(inside(), 'Back keeps focus inside');
    const tab = (shiftKey) => {
      const e = new h.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
      h.doc.activeElement.dispatchEvent(e);
      return e.defaultPrevented;
    };
    await h.click('.sa-next');
    const list = h.$$('button:not([disabled]), input:not([disabled]), select:not([disabled])');
    list.at(-1).focus();
    assert.equal(tab(false), true);
    assert.equal(h.doc.activeElement, list[0], 'Tab on the last control wraps to the first');
    assert.equal(tab(true), true);
    assert.equal(h.doc.activeElement, list.at(-1), 'Shift+Tab on the first wraps to the last');
  } finally { h.close(); }
});

test('re-run gate: the saved proxy still needs a Test; Skip keeps it and the body has no network (product-1-1)', async () => {
  const h = await open({ entry: 'rerun', proxy: PROXY_ON, routes: { '/api/setup/apply': reply({ id: 'stp_1', steps: STEPS3 }, 202) } });
  try {
    await h.click('.sa-next');
    assert.equal(h.next().disabled, true);
    assert.equal(h.status().textContent, 'Test the connection to continue');
    await h.click('.sa-skip');
    assert.equal(h.title(), 'Where should Worca get its models?');
    await applyLimit(h);
    const body = h.applies()[0].body;
    assert.equal(body.network, undefined);
    assert.deepEqual(body, { work: { pipelineCostLimitUsd: 7 } });
  } finally { h.close(); }
});

test('a failing Test on the collapsed "Found" row opens the fields', async () => {
  const h = await open({ detect: DETECT_PROXY, routes: { '/api/proxy/test': reply({ ok: false, results: [{ host: 'api.anthropic.com', ok: false, error: 'refused' }] }) } });
  try {
    await h.click('.sa-next');
    assert.equal(h.field('network.networkProxy'), undefined, 'collapsed');
    await h.click('.sa-test');
    assert.ok(h.field('network.networkProxy'), 'the host input shows');
    assert.equal(h.next().disabled, true);
  } finally { h.close(); }
});

test('UNTESTED: a 400 returns to Network with the error, and Next stays locked once an input clears it (qa-1-1)', async () => {
  const err = { field: 'network.networkProxy', code: 'UNTESTED', error: 'Test these proxy settings first…' };
  const h = await open({ entry: 'fix', step: 'network', proxy: PROXY_ON, routes: { '/api/setup/apply': reply(err, 400) } });
  try {
    await h.type('network.networkProxy.port', '3128');
    await h.click('.sa-test');
    for (let i = 0; i < 4; i++) await h.click('.sa-next');  // → access → models → work → review
    assert.equal(h.title(), 'Check and apply');
    await h.click('.sa-next');
    assert.equal(h.title(), 'How does this machine reach the internet?');
    assert.equal(h.status().textContent, err.error);
    assert.ok(h.status().classList.contains('err'));
    assert.equal(h.field('network.networkProxy').getAttribute('aria-invalid'), 'true');
    await h.type('network.networkProxy.noProxy', '');
    assert.equal(h.next().disabled, true);
    assert.equal(h.status().textContent, 'Test the connection to continue');
  } finally { h.close(); }
});

test('Apply rows: one per step, a spinner on the first unfinished one, frames fill them, Continue / Retry / Back to review (AC-4.6)', async () => {
  await checkRows([
    { name: 'three steps, running then waiting; a frame marks Done and moves the spinner; done ok → Continue → onClose(done)', run: async () => {
      const h = await open({ entry: 'rerun', routes: { '/api/setup/apply': reply({ id: 'stp_1', steps: STEPS3 }, 202) } });
      try {
        await applyLimit(h);
        assert.equal(h.$('.sa-step-of').textContent, 'Step 7 of 7');
        let rows = h.$$('.sa-apply li.sa-row');
        assert.equal(rows.length, 3);
        assert.equal(rows[0].dataset.state, 'running'); assert.ok(rows[0].querySelector('.mk-phase-spin'));
        assert.deepEqual(rows.slice(1).map((r) => r.dataset.state), ['pending', 'pending']);
        assert.ok(rows[1].querySelector('.mk-phase-dot'));
        assert.equal(h.$('.confirm-actions').children.length, 0, 'no button while it runs');
        assert.equal(h.status().textContent, 'Working…');
        h.handle.onFrame({ type: 'setup-apply', id: 'stp_1', result: { id: 'proxy-swap', state: 'ok', line: 'Saved. New connections use it now.' } });
        rows = h.$$('.sa-apply li.sa-row');
        assert.equal(rows[0].querySelector('.badge').textContent, 'Done');
        assert.match(rows[0].textContent, /Saved\. New connections use it now\./);
        assert.equal(rows[1].dataset.state, 'running');
        h.handle.onFrame({ type: 'setup-apply', id: 'stp_1', done: true, ok: true });
        assert.equal(h.title(), 'Worca is ready');
        await h.click('.sa-continue');
        assert.deepEqual(h.closes, ['done']);
        assert.equal(h.doc.getElementById('setup-modal'), null);
      } finally { h.close(); }
    } },
    { name: 'a failed step with retry → Retry posts the kept body with fromStep; retry null → Back to review', run: async () => {
      const h = await open({ entry: 'rerun', routes: { '/api/setup/apply': (_o, n) => reply({ id: `stp_${n}`, steps: STEPS3 }, 202) } });
      try {
        await applyLimit(h);
        h.handle.onFrame({ type: 'setup-apply', id: 'stp_1', result: { id: 'copilot-signin', state: 'failed', line: 'Sign-in failed.' } });
        h.handle.onFrame({ type: 'setup-apply', id: 'stp_1', done: true, ok: false, retry: 'copilot-signin' });
        assert.equal(h.title(), 'Setup stopped');
        assert.equal(h.$('.badge.red').textContent, 'Failed');
        assert.ok(h.$('.sa-close'));
        await h.click('.sa-retry');
        assert.deepEqual(h.applies()[1].body, { work: { pipelineCostLimitUsd: 7 }, fromStep: 'copilot-signin' });
        h.handle.onFrame({ type: 'setup-apply', id: 'stp_1', done: true, ok: false, retry: null });
        assert.equal(h.$('.sa-back-review'), null, 'the old job id is ignored');
      } finally { h.close(); }
      const g = await open({ entry: 'rerun', routes: { '/api/setup/apply': reply({ id: 'stp_1', steps: STEPS3 }, 202) } });
      try {
        await applyLimit(g);
        g.handle.onFrame({ type: 'setup-apply', id: 'stp_1', done: true, ok: false, retry: null });
        assert.ok(g.$('.sa-back-review'));
        await g.click('.sa-back-review');
        assert.equal(g.title(), 'Check and apply');
      } finally { g.close(); }
    } },
    { name: 'frames that beat the 202 are replayed for their id only (qa-1-2)', run: async () => {
      const held = deferred();
      const h = await open({ entry: 'rerun', routes: { '/api/setup/apply': () => held.promise } });
      try {
        await applyLimit(h);
        h.handle.onFrame({ type: 'setup-apply', id: 'stp_1', result: { id: 'proxy-swap', state: 'ok', line: 'early line' } });
        h.handle.onFrame({ type: 'setup-apply', id: 'stp_other', result: { id: 'role-test.deep', state: 'failed', line: 'other job' } });
        h.handle.onFrame({ type: 'setup-apply', id: 'stp_1', done: true, ok: true });
        held.resolve(reply({ id: 'stp_1', steps: STEPS3 }, 202)); await settle();
        assert.ok(h.$('.sa-continue'));
        assert.match(h.$('.sa-apply li[data-step="proxy-swap"]').textContent, /early line/);
        assert.doesNotMatch(h.$('.sa-apply').textContent, /other job/);
      } finally { h.close(); }
    } },
    { name: 'the poll fallback: no frames, GET /api/setup/apply/:id done ok → Continue', run: async () => {
      const h = await open({ entry: 'rerun', routes: { '/api/setup/apply': reply({ id: 'stp_1', steps: STEPS3 }, 202),
        '/api/setup/apply/': reply({ id: 'stp_1', done: true, ok: true, results: STEPS3.map((s) => ({ ...s, state: 'ok', line: 'ok' })) }) } });
      try {
        await applyLimit(h);
        assert.equal(h.queue[0]?.ms, 2000);
        await h.flush();
        assert.ok(h.log.some((r) => r.url === '/api/setup/apply/stp_1'));
        assert.ok(h.$('.sa-continue'));
        assert.equal(h.$$('.sa-apply .badge.green').length, 3);
      } finally { h.close(); }
    } },
    { name: 'a Retry POST held open shows only Working…; frames for the new id buffer until its 202 (qa-2-1, ux-2-2)', run: async () => {
      const held = deferred();
      const h = await open({ entry: 'rerun', routes: { '/api/setup/apply': (_o, n) => (n === 1 ? reply({ id: 'stp_1', steps: STEPS3 }, 202) : held.promise) } });
      try {
        await applyLimit(h);
        h.handle.onFrame({ type: 'setup-apply', id: 'stp_1', done: true, ok: false, retry: 'copilot-signin' });
        await h.click('.sa-retry');
        assert.equal(h.$('.confirm-actions').children.length, 0);
        assert.equal(h.status().textContent, 'Working…');
        h.handle.onFrame({ type: 'setup-apply', id: 'stp_2', result: { id: 'copilot-signin', state: 'ok', line: 'Signed in.' } });
        h.handle.onFrame({ type: 'setup-apply', id: 'stp_2', done: true, ok: true });
        held.resolve(reply({ id: 'stp_2', steps: STEPS3.slice(1) }, 202)); await settle();
        assert.ok(h.$('.sa-continue'));
      } finally { h.close(); }
    } },
    { name: '409 SETUP_RUNNING polls the running id at once and paints its rows (architect-2-3)', run: async () => {
      const h = await open({ entry: 'rerun', routes: { '/api/setup/apply': reply({ code: 'SETUP_RUNNING', id: 'stp_9', error: 'busy' }, 409),
        '/api/setup/apply/': reply({ id: 'stp_9', done: false, results: [{ id: 'proxy-swap', label: 'Proxy', state: 'ok', line: 'running job row' }] }) } });
      try {
        await applyLimit(h);
        assert.equal(h.queue[0]?.ms, 0);
        await h.flush();
        assert.ok(h.log.some((r) => r.url === '/api/setup/apply/stp_9'));
        assert.match(h.$('.sa-apply').textContent, /running job row/);
      } finally { h.close(); }
    } },
    { name: 'five failed polls in a row: lost job, Close and Back to review, not busy (ux-2-3)', run: async () => {
      const h = await open({ entry: 'rerun', routes: { '/api/setup/apply': reply({ id: 'stp_1', steps: STEPS3 }, 202),
        '/api/setup/apply/': reply({ error: 'No such setup apply.' }, 404) } });
      try {
        await applyLimit(h);
        for (let i = 0; i < 5; i++) await h.flush();
        assert.equal(h.status().textContent, 'Worca lost track of this setup. Check the rows, then go back to review.');
        assert.ok(h.$('.sa-close')); assert.ok(h.$('.sa-back-review'));
        assert.equal(h.$('.setup-card').dataset.fbState, undefined);
        pressEscape(h.window); await settle();
        assert.deepEqual(h.closes, ['later'], 'Escape closes a finished Apply');
        assert.equal(discardPrompt(h.doc), null);
      } finally { h.close(); }
    } },
  ]);
});

test('secrets: scrubbed after the 202; a login Retry asks for the password again and sends it once (security-1-1, security-2-1)', async () => {
  const run = async (retryAt) => {
    const h = await open({ entry: 'fix', step: 'network', proxy: PROXY_ON, routes: { '/api/setup/apply': (_o, n) => reply({ id: `stp_${n}`, steps: STEPS3 }, 202) } });
    try {
      await h.type('network.login.password', 'pw-1');
      await h.click('.sa-test');
      await h.click('.sa-next');                             // → access
      await h.toggle('.sa-src-openai');
      await h.type('access.openai.baseUrl', 'https://llm.acme.example/v1');
      await h.type('access.openai.apiKey', 'sk-secret');
      await h.goTo('review');
      await h.click('.sa-next');
      const first = h.applies()[0].body;
      assert.equal(first.network.login.password, 'pw-1');
      assert.equal(first.access.openai.apiKey, 'sk-secret');
      h.handle.onFrame({ type: 'setup-apply', id: 'stp_1', done: true, ok: false, retry: retryAt });
      await h.click('.sa-retry');
      if (LOGIN_RETRY_STEPS.includes(retryAt)) {
        assert.equal(h.applies().length, 1, 'Retry posts nothing yet');
        assert.equal(h.title(), 'How does this machine reach the internet?');
        assert.equal(h.field('network.login.password').value, '', 'the password was scrubbed');
        assert.equal(h.field('network.networkProxy').disabled, true, 'the planned proxy values are read-only');
        assert.equal(h.status().textContent, 'Type the proxy password again to retry');
        assert.equal(h.next().textContent, 'Retry');
        assert.equal(h.next().disabled, true);
        await h.type('network.login.password', 'pw-2');
        assert.equal(h.next().disabled, false);
        await h.click('.sa-next');
        const again = h.applies()[1].body;
        assert.equal(again.fromStep, retryAt);
        assert.equal(again.network.login.password, 'pw-2');
        assert.equal(again.access?.openai?.apiKey, undefined);
        const bodies = h.log.map((r) => JSON.stringify(r.body ?? null));
        assert.deepEqual(bodies.map((b, i) => (b.includes('pw-1') ? i : -1)).filter((i) => i >= 0), [h.log.indexOf(h.applies()[0])]);
        assert.deepEqual(bodies.map((b, i) => (b.includes('pw-2') ? i : -1)).filter((i) => i >= 0), [h.log.indexOf(h.applies()[1])]);
        assert.equal(h.title(), 'Setting up Worca…');
      } else {
        const again = h.applies()[1].body;
        assert.equal(again.fromStep, 'copilot-signin');
        assert.equal(again.network?.login, undefined);
        assert.equal(again.access?.openai?.apiKey, undefined);
      }
    } finally { h.close(); }
  };
  await checkRows([
    { name: 'retry at proxy-swap', run: () => run('proxy-swap') },
    { name: 'retry at proxy-login', run: () => run('proxy-login') },
    { name: 'retry at copilot-signin posts at once', run: () => run('copilot-signin') },
    { name: 'Back in login-retry mode returns to the failed Apply screen', run: async () => {
      const h = await open({ entry: 'fix', step: 'network', proxy: PROXY_ON, routes: { '/api/setup/apply': reply({ id: 'stp_1', steps: STEPS3 }, 202) } });
      try {
        await h.type('network.login.password', 'pw-1');
        await h.click('.sa-test');
        await h.goTo('review');
        await h.click('.sa-next');
        h.handle.onFrame({ type: 'setup-apply', id: 'stp_1', done: true, ok: false, retry: 'proxy-login' });
        await h.click('.sa-retry');
        await h.click('.sa-back');
        assert.equal(h.title(), 'Setup stopped');
        assert.ok(h.$('.sa-close')); assert.ok(h.$('.sa-retry'));
      } finally { h.close(); }
    } },
  ]);
});

test('a 400 field error returns to its step, marks the input and shows the server line', async () => {
  const h = await open({ entry: 'rerun', routes: { '/api/setup/apply': reply({ field: 'work.pipelineCostLimitUsd', error: 'x' }, 400) } });
  try {
    await applyLimit(h);
    assert.equal(h.title(), 'How do you want to work?');
    assert.equal(h.status().textContent, 'x');
    assert.ok(h.status().classList.contains('err'));
    assert.equal(h.field('work.pipelineCostLimitUsd').getAttribute('aria-invalid'), 'true');
    assert.equal(h.$('.setup-card').dataset.fbState, undefined);
    await h.type('work.pipelineCostLimitUsd', '7');
    assert.equal(h.status().textContent, '');
    assert.equal(h.field('work.pipelineCostLimitUsd').hasAttribute('aria-invalid'), false, 'the cleared error leaves no aria-invalid');
  } finally { h.close(); }
});

test('rejected requests: a failed load offers Try again; a rejected apply clears busy and says Worca is unreachable (ux-1-2, ux-2-1)', async () => {
  await checkRows([
    { name: 'load fails, Try again succeeds, the error clears', run: async () => {
      const h = await open({ routes: { '/api/settings': (_o, n) => { if (n === 1) throw new Error('down'); return reply(SETTINGS); } } });
      try {
        assert.equal(h.$('.badge.red').textContent, 'Couldn\'t load your settings.');
        assert.match(h.status().textContent, /^Couldn't load your settings\. Worca could not be reached/);
        assert.equal(h.next().disabled, true);
        await h.click('.sa-reload');
        assert.equal(h.title(), 'Let’s set up Worca');
        assert.ok(h.$('.sa-check'));
        assert.equal(h.status().textContent, '');
        assert.equal(h.next().disabled, false);
      } finally { h.close(); }
    } },
    { name: 'a rejected apply POST', run: async () => {
      const h = await open({ entry: 'rerun', routes: { '/api/setup/apply': () => { throw new Error('down'); } } });
      try {
        await applyLimit(h);
        assert.equal(h.$('.setup-card').dataset.fbState, undefined);
        assert.ok(h.next());
        assert.equal(h.status().textContent, UNREACHABLE);
      } finally { h.close(); }
    } },
  ]);
});

test('re-run: saved values in the fields, only changed rows on Review, nothing changed disables Apply (AC-4.4)', async () => {
  const h = await open({ entry: 'rerun' });
  try {
    await h.goTo('review');
    assert.equal(h.$$('.sa-review li').length, 0);
    assert.equal(h.next().disabled, true);
    assert.equal(h.status().textContent, 'Nothing changed.');
    assert.equal(h.next().textContent, 'Apply changes');
    await h.goTo('work');
    assert.equal(h.field('work.pipelineCostLimitUsd').value, '5');
    await h.type('work.pipelineCostLimitUsd', '7');
    await h.goTo('review');
    const rows = h.$$('.sa-review li');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].querySelector('.badge.amber').textContent, 'Changed');
    await h.click(rows[0].querySelector('.sa-change'));
    assert.equal(h.title(), 'How do you want to work?');
  } finally { h.close(); }
});

test('a first start with nothing to apply ends on Finish, without a POST (A23)', async () => {
  const h = await open();
  try {
    await h.goTo('review');
    assert.equal(h.next().textContent, 'Finish');
    assert.equal(h.status().textContent, 'Nothing to change: your current setup already works.');
    await h.click('.sa-next');
    assert.deepEqual(h.closes, ['done']);
    assert.equal(h.applies().length, 0);
  } finally { h.close(); }
});

test('the head: Step N of 7, the title and the subtitle on every step (ux-1-3)', async () => {
  const titles = ['Let’s set up Worca', 'How does this machine reach the internet?', 'Where should Worca get its models?', 'Which models should do the work?', 'How do you want to work?', 'Check and apply'];
  const subs = { first: ['Worca checks this machine, then asks only what it could not find.', 'Worca’s agents use this route for every model call.',
    'Turn on every source you can use. You need at least one.', 'Each role sets the model for every job that has none of its own.', 'You can change all of these later in Settings.',
    'Worca will save these settings, sign in, import the models and test each one.'] };
  subs.rerun = [...subs.first]; subs.rerun[0] = 'Your current setup is loaded. Change what you need; the rest stays as it is.'; subs.rerun[5] = 'Only the rows marked Changed will be written.';
  for (const entry of ['first', 'rerun']) {
    const h = await open({ entry, routes: { '/api/setup/apply': reply({ id: 'stp_1', steps: STEPS3 }, 202) } });
    try {
      for (let i = 0; i < 6; i++) {
        await h.goTo(SETUP_STEPS[i].id);
        assert.equal(h.$('.sa-step-of').textContent, `Step ${i + 1} of 7`);
        assert.equal(h.title(), titles[i]);
        assert.equal(h.$('p.sa-sub').textContent, subs[entry][i], `${entry} ${SETUP_STEPS[i].id}`);
      }
      await applyLimit(h);
      assert.equal(h.$('.sa-step-of').textContent, 'Step 7 of 7');
      assert.equal(h.title(), 'Setting up Worca…');
      assert.equal(h.$('p.sa-sub').textContent, 'Each change runs in order and shows its result.');
    } finally { h.close(); }
  }
});

test('entry steps and the handle: fix › network, fix › access with Copilot on, goTo(access) turns Copilot on, never mid-apply (AC-4.5)', async () => {
  let h = await open({ entry: 'fix', step: 'network' });
  try { assert.equal(h.title(), 'How does this machine reach the internet?'); assert.equal(h.$('.sa-later'), null); assert.equal(h.$('.sa-back').textContent, 'Back'); } finally { h.close(); }
  h = await open({ entry: 'fix', step: 'access' });
  try { assert.equal(h.$('.sa-src-copilot').checked, true); } finally { h.close(); }
  h = await open({ entry: 'rerun', routes: { '/api/setup/apply': reply({ id: 'stp_1', steps: STEPS3 }, 202) } });
  try {
    assert.equal(h.$('.sa-later').textContent, 'Cancel');
    await h.goTo('access');
    assert.equal(h.title(), 'Where should Worca get its models?');
    assert.equal(h.$('.sa-src-copilot').checked, true);
    await h.click('.sa-skip');                                // keep access as saved
    await applyLimit(h);
    await h.goTo('network');
    assert.equal(h.title(), 'Setting up Worca…', 'goTo is a no-op on Apply');
  } finally { h.close(); }
});

test('Copilot: Skip on Models drops picked imports (qa-2-2); a status-0 poll is tried again (ux-2-5)', async () => {
  const h = await open({ routes: { ...COPILOT_ROUTES(['throw', reply({ ok: true, login: 'jdoe' })]), '/api/setup/apply': reply({ id: 'stp_1', steps: STEPS3 }, 202) } });
  try {
    await h.goTo('access');
    await signInCopilot(h, { pollAnswers: ['throw', 'ok'] });
    assert.equal(h.log.filter((r) => r.url.startsWith('/api/providers/copilot/login/')).length, 2, 'the unreachable poll was re-armed');
    assert.match(h.$('.sa-copilot').textContent, /Connected as @jdoe/);
    await h.click('.sa-next');                                // → Models
    await h.pick(h.$('.inherit-field[data-setting="models.claude.roles.deep"] .inherit-model'), 'copilot-claude-opus-5-5');
    await h.click('.sa-skip');
    await h.goTo('review');
    await h.click('.sa-next');
    const body = h.applies()[0].body;
    assert.equal(body.access.copilot.signIn, true);
    assert.equal(body.access.copilot.importModels, undefined);
    assert.equal(body.models, undefined);
  } finally { h.close(); }
});

test('server text renders as text: a Copilot login, a result line and a detect line (security-2-5)', async () => {
  const evil = '<img src=x onerror=1>';
  const h = await open({ detect: { checks: [{ id: 'claude', label: 'Claude Code', state: 'ok', line: evil }] },
    routes: { ...COPILOT_ROUTES([reply({ ok: true, login: evil })]), '/api/setup/apply': reply({ id: 'stp_1', steps: STEPS3 }, 202) } });
  try {
    assert.match(h.$('.sa-check').textContent, /<img src=x onerror=1>/);
    await h.goTo('access');
    await signInCopilot(h);
    assert.match(h.$('.sa-copilot').textContent, /@<img src=x onerror=1>/);
    await h.goTo('review');
    await h.click('.sa-next');
    h.handle.onFrame({ type: 'setup-apply', id: 'stp_1', result: { id: 'proxy-swap', state: 'ok', line: evil } });
    assert.match(h.$('.sa-apply').textContent, /<img src=x onerror=1>/);
    assert.equal(h.doc.querySelectorAll('#setup-modal img').length, 0);
  } finally { h.close(); }
});

test('close rules: Set up later closes at once; Escape on an edit asks; a backdrop click never closes (AC-4.1)', async () => {
  let h = await open();
  try {
    assert.equal(h.$('.sa-later').textContent, 'Set up later');
    await h.click('.sa-later');
    assert.deepEqual(h.closes, ['later']);
    assert.equal(discardPrompt(h.doc), null);
    assert.equal(h.doc.getElementById('setup-modal'), null);
  } finally { h.close(); }
  h = await open({ entry: 'rerun' });
  try {
    await h.goTo('work');
    await h.type('work.pipelineCostLimitUsd', '9');
    pressEscape(h.window); await settle();
    assert.ok(discardPrompt(h.doc), 'Discard changes?');
    keepEditing(h.doc); await settle();
    assert.equal(h.title(), 'How do you want to work?');
    backdropClick(h.window, h.doc.getElementById('setup-modal')); await settle();
    assert.ok(h.doc.getElementById('setup-modal'), 'a backdrop click never closes it');
    assert.deepEqual(h.closes, []);
  } finally { h.close(); }
});

test('credential broker: no key input, no Copilot sign-in, the key page link only for http(s) (security-1-2, security-1-3)', async () => {
  for (const [keyPage, href] of [['https://keys.acme.example/', 'https://keys.acme.example/'], ['javascript:x', null], ['data:text/html,x', null], ['//evil.example', null]]) {
    const providers = { ...PROVIDERS, openai: { configured: true, baseUrl: 'https://llm.acme.example/v1' }, anthropic: { configured: true, baseUrl: 'https://a.acme.example' },
      broker: { enabled: true, keyPage } };
    const h = await open({ entry: 'fix', step: 'access', providers });
    try {
      assert.equal(h.$('.sa-src-openai').checked, true); assert.equal(h.$('.sa-src-anthropic').checked, true);
      assert.equal(h.$$('.sa-key').length, 0, 'no API key input');
      assert.equal(h.field('access.openai.apiKey'), undefined);
      assert.equal(h.$('.sa-cp-signin'), null, 'no Copilot sign-in');
      const links = h.$$('.sa-broker a.link');
      if (href) {
        assert.equal(links.length, 3);
        for (const a of links) { assert.equal(a.getAttribute('href'), href); assert.equal(a.rel, 'noopener noreferrer'); assert.equal(a.target, '_blank'); }
      } else assert.equal(links.length, 0, keyPage);
    } finally { h.close(); }
  }
});

// ── source checks ──

test('CSS: 290px layout, --ink-2 scoping and no ink-3 under .setup- (AC-4.7, fit-1-1)', () => {
  const css = read('ui/public/style.css');
  assert.match(css, /\.setup-card \.sa-row\{[^}]*flex-wrap:wrap[^}]*min-width:0[^}]*\}/);
  assert.ok(css.includes('.setup-card .sa-pair{display:flex;flex-wrap:wrap;gap:8px;}'));
  assert.ok(css.includes('.setup-card .sa-pair > *{flex:1 1 100px;min-width:0;}'));
  assert.ok(css.includes('.setup-card .dlg-foot .confirm-actions{flex-wrap:wrap;}'));
  assert.ok(css.includes('.setup-modal .card.setup-card{width:min(640px,100%);}'));
  assert.ok(css.includes('.setup-card .hint{color:var(--ink-2);}'));
  assert.ok(css.includes('.setup-card .input::placeholder{color:var(--ink-2);}'));
  assert.ok(css.includes('.setup-card .input[aria-invalid="true"].input::placeholder{color:var(--ink-2);}'));
  assert.equal(/sa-muted/.test(css), false);
  const setupRules = css.replace(/\/\*[\s\S]*?\*\//g, '').split('}').filter((r) => /(^|\n)\s*\.setup-/.test(r));
  assert.ok(setupRules.length >= 16);
  for (const r of setupRules) assert.equal(r.includes('ink-3'), false, r);
  for (const cls of ['sa-step-of', 'sa-sub', 'sa-step', 'sa-rows', 'sa-row', 'sa-row-main', 'sa-row-line', 'sa-pair', 'sa-broker', 'sa-status']) {
    assert.ok(new RegExp(`\\.setup-card \\.${cls}[{ ]`).test(css), cls);
  }
});

test('module source: no HTML sinks, no CSS.escape; built on layoutDialog and guardModal; the docs name the dialog', () => {
  const src = read('ui/public/setup-assistant.mjs');
  for (const bad of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'CSS.escape']) assert.equal(src.includes(bad), false, bad);
  assert.match(src, /import \{ layoutDialog \} from '\.\/dialog-layout\.mjs'/);
  assert.ok(src.includes('guardModal('));
  assert.ok(src.includes("kind: 'form'"));
  assert.ok(read('docs/setup-assistant.md').includes('## The dialog'));
  const gs = read('docs/getting-started.md');
  assert.ok(gs.includes('Set up later')); assert.ok(gs.includes('Run setup again'));
});
