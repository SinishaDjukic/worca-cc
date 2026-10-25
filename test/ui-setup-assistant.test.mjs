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
  stepOfField, setupStepForSignIn, safeHttpUrl, openSetupAssistant, teamNotice,
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
const TEAM_NONE = { file: { found: false }, homes: [] };
async function open({ entry = 'first', step = 'check', settings = SETTINGS, proxy = PROXY_OFF, providers = PROVIDERS, detect = DETECT, routes = {}, level = 'simple',
  team = TEAM_NONE, teamHome = null } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><button id="opener">open</button></body></html>', { url: 'http://localhost/' });
  const { window } = dom; const doc = window.document;
  if (level) doc.documentElement.dataset.level = level;
  const log = []; const counts = new Map();
  const table = {
    '/api/settings': reply(settings), '/api/proxy/status': reply(proxy), '/api/providers': reply(providers),
    '/api/config': reply({ models: CATALOG }), '/api/setup/detect': detect ? reply(detect) : reply({ error: 'no' }, 500),
    '/api/proxy/test': reply({ ok: true, results: [{ host: 'api.anthropic.com', ok: true, ms: 12 }] }),
    '/api/setup/team': reply(team),
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
  const handle = openSetupAssistant({ doc, fetchJson, entry, step, team: teamHome, timers, now: () => clock.t, onClose: (how) => closes.push(how) });
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
    settle,
    applies: () => log.filter((r) => r.url === '/api/setup/apply' && r.method === 'POST'),
    writes: () => log.filter((r) => r.method !== 'GET'),
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
const NET_STEPS = [{ id: 'proxy-swap', label: 'Network proxy' }, { id: 'proxy-login', label: 'Proxy login' }];

/**
 * The server side of "Network applies on Next": a network-only apply answers 202 'stp_net…' and, once its done
 * frame arrived, GET /api/proxy/status returns the applied values. Any other apply answers 202 'stp_1'.
 */
function netServer({ proxy = PROXY_OFF } = {}) {
  const st = { proxy, applied: [], ids: [] };
  const routes = {
    '/api/proxy/status': () => reply(st.proxy),
    '/api/setup/apply': (o, n) => {
      if (!o.body.network) return reply({ id: 'stp_1', steps: STEPS3 }, 202);
      st.applied.push(o.body.network); st.ids.push(`stp_net${n}`);
      return reply({ id: st.ids.at(-1), steps: NET_STEPS }, 202);
    },
  };
  /** The done frame for apply `n` (1-based): ok, or failed at `failAt` with `line`. */
  async function done(h, { n = st.applied.length, ok = true, failAt = null, line = 'It failed.' } = {}) {
    const id = st.ids[n - 1];
    if (ok) {
      const np = st.applied[n - 1].networkProxy;
      if (np) {
        st.proxy = np.enabled ? { settings: { enabled: true, upstream: np.upstream, auth: np.auth, noProxy: np.noProxy ? [np.noProxy] : [] },
          login: st.applied[n - 1].login ? { domain: st.applied[n - 1].login.domain, user: st.applied[n - 1].login.user } : st.proxy.login, state: 'ready' }
          : { ...PROXY_OFF, login: st.proxy.login };
      }
      for (const r of NET_STEPS) h.handle.onFrame({ type: 'setup-apply', id, result: { ...r, state: 'ok', line: 'Saved.' } });
    } else h.handle.onFrame({ type: 'setup-apply', id, result: { id: failAt, label: failAt, state: 'failed', line, retry: failAt } });
    h.handle.onFrame({ type: 'setup-apply', id, done: true, ok, retry: ok ? null : failAt });
    await h.settle();
  }
  return { st, routes, done };
}

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
    { name: 'proxyKey: same values, same key; any one changed (the account too), another key', run: () => {
      assert.equal(proxyKey(n), proxyKey({ ...n }));
      for (const change of [{ host: 'p2.acme.example' }, { port: '8081' }, { auth: 'basic' }, { noProxy: '.corp' }, { domain: 'ACME' }, { user: 'jdoe' }]) assert.notEqual(proxyKey({ ...n, ...change }), proxyKey(n));
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

test('corporate Copilot path: proxy test → Next applies the network → notice → device sign-in → roles → Apply, in one dialog (AC-4.2, AC-4.3)', async () => {
  const net = netServer();
  const h = await open({ detect: DETECT_PROXY, routes: { ...COPILOT_ROUTES(), ...net.routes } });
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
    await h.type('network.login.domain', 'ACME');
    await h.type('network.login.user', 'jdoe');
    await h.type('network.login.password', 'S3cret!');
    h.$('.sa-test').focus();
    await h.click('.sa-test');
    assert.equal(h.doc.activeElement, h.$('.sa-test'), 'the repaint keeps focus on Test, not the first control at the top');
    const testBody = h.log.filter((r) => r.url === '/api/proxy/test').at(-1).body;
    assert.deepEqual(testBody.login, { domain: 'ACME', user: 'jdoe', password: 'S3cret!' }, 'the Test carries the typed login');
    await h.click('.sa-next');                               // Next on Network: a network-only apply
    assert.equal(h.applies().length, 1);
    assert.deepEqual(Object.keys(h.applies()[0].body), ['network'], 'only the network group');
    assert.equal(h.applies()[0].body.network.networkProxy.upstream, 'http://proxy.acme.example:8081');
    assert.equal(h.applies()[0].body.network.login.password, 'S3cret!');
    assert.equal(h.title(), 'How does this machine reach the internet?', 'it waits on Network');
    assert.equal(h.status().textContent, 'Working…');
    assert.equal(h.$$('.sa-net-apply li.sa-row').length, 2, 'its progress shows inline');
    assert.equal(h.field('network.login.password').value, '', 'the password is scrubbed after the 202');
    await net.done(h);
    assert.equal(h.title(), 'Where should Worca get its models?');
    assert.equal(h.$('.sa-net-saved').textContent, 'The corporate proxy is saved and on.');
    assert.equal(h.log.filter((r) => r.url === '/api/proxy/status').length, 2, 'the saved values were reloaded');
    await signInCopilot(h);
    assert.match(h.$('.sa-copilot').textContent, /Connected as @jdoe/);
    await h.click('.sa-next');                               // → Models
    await h.pick(h.$('.inherit-field[data-setting="models.claude.roles.deep"] .inherit-model'), 'copilot-claude-opus-5-5');
    await h.click('.sa-next'); await h.click('.sa-next');    // → How you work → Review
    const netRow = h.$('.sa-review li[data-group="network"]');
    assert.match(netRow.textContent, /Saved/);
    assert.doesNotMatch(netRow.textContent, /Changed/);
    assert.equal(h.next().textContent, 'Apply setup');
    await h.click('.sa-next');
    const urls = h.log.map((r) => r.url);
    assert.ok(urls.indexOf('/api/providers/copilot/acknowledge') < urls.indexOf('/api/providers/copilot/login'), 'acknowledge first');
    assert.ok(h.log.indexOf(h.applies()[0]) < urls.indexOf('/api/providers/copilot/acknowledge'), 'the network applied before the Copilot calls');
    assert.equal(h.log.some((r) => r.url === '/api/settings' && r.method === 'POST'), false, 'no POST /api/settings');
    assert.equal(h.doc.documentElement.dataset.level, 'simple');
    const body = h.applies()[1].body;
    assert.equal(body.access.copilot.signIn, true);
    assert.equal(body.access.copilot.acknowledgeTerms, true);
    assert.ok(body.access.copilot.importModels.includes('claude-opus-5-5'));
    assert.equal(body.work?.uiLevel, undefined);
    assert.equal(body.network, undefined, 'the final Apply sends no network group');
    assert.equal(h.title(), 'Setting up Worca…');
  } finally { h.close(); }
});
test('Network gate: each of host, port, Login and No proxy hosts re-locks Next after a pass; the pass expires on screen (qa-1-1, ux-2-4)', async () => {
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

test('the second button: none when the step is as saved, Discard changes once it differs, which puts it back', async () => {
  const h = await open({ entry: 'rerun' });
  try {
    await h.goTo('work');
    assert.equal(h.$('.sa-skip'), null, 'nothing to discard and Next is open: Back and Next only');
    await h.type('work.pipelineCostLimitUsd', '9');
    assert.equal(h.$('.sa-skip').textContent, 'Discard changes');
    await h.click('.sa-skip');
    assert.equal(h.title(), 'Check and apply');
    await h.goTo('work');
    assert.equal(h.$('[data-sa-field="work.pipelineCostLimitUsd"]').value, '5', 'the saved limit is back');
    assert.equal(h.$('.sa-skip'), null);
  } finally { h.close(); }
});

test('Network › More: timeouts show their defaults and only a changed one is sent; the port note only with a running proxy', async () => {
  const value = (h, k) => h.$(`[data-sa-field="network.networkProxy.timeouts.${k}"]`).value;
  let h = await open({ entry: 'rerun', proxy: { ...PROXY_ON, running: false } });
  try {
    await h.goTo('network');
    await h.click('.sa-more');
    assert.deepEqual(['connectMs', 'authMs', 'idleMs'].map((k) => value(h, k)), ['60', '60', '300']);
    assert.equal(h.$('.sa-step').textContent.includes('Leave it empty and Worca picks a free port each time it starts.'), true, 'what empty means, always');
    assert.equal(h.$('[data-sa-field="network.networkProxy.fixedPort"]').placeholder, 'Automatic');
    assert.equal(h.$('.sa-step').textContent.includes('Programs already using the old port'), false, 'nothing running: no switch note');
    await h.type('network.networkProxy.timeouts.idleMs', '300');                 // the default again: not sent
    await h.type('network.networkProxy.timeouts.connectMs', '90');
    await h.click('.sa-test');
    const sent = h.log.filter((r) => r.url === '/api/proxy/test').at(-1).body.networkProxy;
    assert.deepEqual(sent.timeouts, { connectMs: 90000 });
  } finally { h.close(); }
  h = await open({ entry: 'rerun', proxy: { ...PROXY_ON, running: true } });
  try {
    await h.goTo('network');
    await h.click('.sa-more');
    assert.equal(h.$('.sa-step').textContent.includes('Takes effect at once. Programs already using the old port keep it until Worca restarts.'), true, 'a running proxy: the switch note');
  } finally { h.close(); }
});

test('Network: Reset to defaults puts login mode, no proxy hosts, local port and timeouts back; host and account stay', async () => {
  const saved = { ...PROXY_ON, settings: { ...PROXY_ON.settings, auth: 'basic', noProxy: ['intranet.example.com'], fixedPort: 18080, timeouts: { connectMs: 90000 } } };
  const h = await open({ entry: 'rerun', proxy: saved });
  try {
    await h.goTo('network');
    await h.click('.sa-more');
    await h.click('.sa-reset');
    const v = (f) => h.$(`[data-sa-field="${f}"]`).value;
    assert.equal(v('network.networkProxy.auth'), 'auto');
    assert.equal(v('network.networkProxy.noProxy'), '');
    assert.equal(v('network.networkProxy.fixedPort'), '');
    assert.equal(v('network.networkProxy.timeouts.connectMs'), '60');
    assert.equal(v('network.networkProxy'), 'proxy.acme.example', 'the proxy address has no default');
    assert.equal(v('network.login.user'), 'jdoe', 'nor does the account');
    assert.equal(h.next().disabled, true, 'like any edit, the reset needs a new Test');
  } finally { h.close(); }
});

test('Network: Auto-detect fills host, port and a manual bypass list, says where they came from, and needs a new Test', async () => {
  const found = { found: true, source: 'manual', host: 'proxy.example.com', port: 3128, noProxy: ['*.corp.example.com'], also: [], line: 'From your macOS proxy settings.' };
  const h = await open({ entry: 'rerun', proxy: PROXY_ON, routes: { '/api/proxy/detect': reply(found) } });
  try {
    await h.goTo('network');
    await h.click('.sa-detect');
    const v = (f) => h.$(`[data-sa-field="${f}"]`).value;
    assert.deepEqual([v('network.networkProxy'), v('network.networkProxy.port'), v('network.networkProxy.noProxy')], ['proxy.example.com', '3128', '*.corp.example.com']);
    assert.equal(h.$('.sa-detect-line').textContent, 'From your macOS proxy settings.');
    assert.equal(h.next().disabled, true, 'detected values still need a Test');
  } finally { h.close(); }
  const none = await open({ entry: 'rerun', proxy: PROXY_ON, routes: { '/api/proxy/detect': reply({ found: false, source: 'none', line: 'No proxy is set in your macOS settings.' }) } });
  try {
    await none.goTo('network');
    await none.click('.sa-detect');
    assert.equal(none.$('[data-sa-field="network.networkProxy"]').value, 'proxy.acme.example', 'nothing found: the address stays');
    assert.equal(none.$('.sa-detect-line').textContent, 'No proxy is set in your macOS settings.');
  } finally { none.close(); }
});

test('re-run gate: the saved proxy still needs a Test; Skip keeps it and the body has no network (product-1-1)', async () => {
  const h = await open({ entry: 'rerun', proxy: PROXY_ON, routes: { '/api/setup/apply': reply({ id: 'stp_1', steps: STEPS3 }, 202) } });
  try {
    await h.click('.sa-next');
    assert.equal(h.next().disabled, true);
    assert.equal(h.status().textContent, 'Test the connection to continue');
    assert.equal(h.$('.sa-skip').textContent, 'Skip for now', 'Next is blocked: the way past keeps the saved proxy');
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

test('UNTESTED: Next on Network stays on Network with the error, and Next stays locked once an input clears it (qa-1-1)', async () => {
  const err = { field: 'network.networkProxy', code: 'UNTESTED', error: 'Test these proxy settings first…' };
  const h = await open({ entry: 'fix', step: 'network', proxy: PROXY_ON, routes: { '/api/setup/apply': reply(err, 400) } });
  try {
    await h.type('network.networkProxy.port', '3128');
    await h.click('.sa-test');
    await h.click('.sa-next');
    assert.equal(h.applies().length, 1);
    assert.equal(h.title(), 'How does this machine reach the internet?');
    assert.equal(h.status().textContent, err.error);
    assert.ok(h.status().classList.contains('err'));
    assert.equal(h.field('network.networkProxy').getAttribute('aria-invalid'), 'true');
    assert.equal(h.$('.setup-card').dataset.fbState, undefined);
    await h.type('network.networkProxy.noProxy', '');
    assert.equal(h.next().disabled, true);
    assert.equal(h.status().textContent, 'Test the connection to continue');
  } finally { h.close(); }
});

test('Network applies on Next: unchanged values post nothing (D19); Direct after a saved proxy applies; a typed account needs its own Test', async () => {
  await checkRows([
    { name: 're-run, saved proxy unchanged: Test, Next moves on with no apply', run: async () => {
      const h = await open({ entry: 'rerun', step: 'network', proxy: PROXY_ON });
      try {
        await h.click('.sa-test');
        await h.click('.sa-next');
        assert.equal(h.title(), 'Where should Worca get its models?');
        assert.equal(h.applies().length, 0);
        assert.equal(h.$('.sa-net-saved'), null, 'nothing new was saved');
      } finally { h.close(); }
    } },
    { name: 're-run, Direct unchanged: Next moves on with no apply', run: async () => {
      const h = await open({ entry: 'rerun', step: 'network' });
      try {
        await h.click('.sa-next');
        assert.equal(h.title(), 'Where should Worca get its models?');
        assert.equal(h.applies().length, 0);
      } finally { h.close(); }
    } },
    { name: 'Direct after a saved proxy: Next posts { enabled: false }; Review finishes with the saved row', run: async () => {
      const net = netServer({ proxy: PROXY_ON });
      const h = await open({ entry: 'rerun', step: 'network', proxy: PROXY_ON, routes: net.routes });
      try {
        await h.click('.seg button[data-value="direct"]');
        await h.click('.sa-next');
        assert.deepEqual(h.applies()[0].body, { network: { networkProxy: { enabled: false } } });
        await net.done(h);
        assert.equal(h.title(), 'Where should Worca get its models?');
        assert.equal(h.$('.sa-net-saved').textContent, 'Direct connection saved.');
        await h.goTo('review');
        const li = h.$('.sa-review li[data-group="network"]');
        assert.ok(li, 'a re-run lists the saved network row');
        assert.match(li.textContent, /Saved/);
        assert.equal(h.next().textContent, 'Finish');
        assert.equal(h.status().textContent, 'Direct connection saved. Nothing else to change.');
      } finally { h.close(); }
    } },
    { name: 'editing the domain, user or password after a pass needs a new Test', run: async () => {
      const h = await open({ entry: 'fix', step: 'network', proxy: PROXY_ON });
      try {
        for (const [f, v] of [['network.login.domain', 'OTHER'], ['network.login.user', 'jane'], ['network.login.password', 'x']]) {
          await h.click('.sa-test');
          assert.equal(h.next().disabled, false, f);
          await h.type(f, v);
          assert.equal(h.next().disabled, true, `${f}: re-locked`);
        }
      } finally { h.close(); }
    } },
    { name: 'Set up later after Network applied: the dialog says the proxy is saved and on', run: async () => {
      const net = netServer();
      const h = await open({ entry: 'first', step: 'network', routes: net.routes });
      try {
        await h.click('.seg button[data-value="proxy"]');
        await h.type('network.networkProxy', 'proxy.acme.example');
        await h.click('.sa-test');
        await h.click('.sa-next');
        await net.done(h);
        await h.click('.sa-back');                            // back to Network: the line stays
        assert.equal(h.$('.sa-net-saved').textContent, 'The corporate proxy is saved and on.');
        await h.click('.sa-next');                            // unchanged now: no second apply
        assert.equal(h.applies().length, 1);
        assert.equal(h.$('.sa-net-saved').textContent, 'The corporate proxy is saved and on.');
      } finally { h.close(); }
    } },
  ]);
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

test('secrets: scrubbed after the 202; a failed network apply stays on Network and its Retry asks for the password again (security-1-1, security-2-1)', async () => {
  const run = async (retryAt) => {
    const net = netServer({ proxy: PROXY_ON });
    const h = await open({ entry: 'fix', step: 'network', proxy: PROXY_ON, routes: net.routes });
    try {
      await h.type('network.networkProxy.port', '3128');
      await h.type('network.login.password', 'pw-1');
      await h.click('.sa-test');
      await h.click('.sa-next');
      const first = h.applies()[0].body;
      assert.equal(first.network.login.password, 'pw-1');
      assert.equal(h.field('network.login.password').value, '', 'the password was scrubbed');
      await net.done(h, { ok: false, failAt: retryAt, line: 'The proxy refused it.' });
      assert.equal(h.title(), 'How does this machine reach the internet?', 'a failure stays on Network');
      assert.equal(h.status().textContent, 'The proxy refused it.');
      assert.ok(h.status().classList.contains('err'));
      assert.match(h.$('.sa-net-apply').textContent, /The proxy refused it\./);
      assert.equal(h.field('network.networkProxy').disabled, true, 'the planned proxy values are read-only');
      assert.equal(h.next().textContent, 'Retry');
      assert.equal(h.next().disabled, true);
      await h.type('network.login.password', 'pw-2');
      assert.equal(h.next().disabled, false);
      await h.click('.sa-next');
      const again = h.applies()[1].body;
      assert.equal(again.fromStep, retryAt);
      assert.equal(again.network.login.password, 'pw-2');
      assert.equal(again.network.networkProxy.upstream, 'http://proxy.acme.example:3128');
      const bodies = h.log.map((r) => JSON.stringify(r.body ?? null));
      const tests = h.log.filter((r) => r.url === '/api/proxy/test').map((r) => h.log.indexOf(r));
      assert.deepEqual(bodies.map((b, i) => (b.includes('pw-1') ? i : -1)).filter((i) => i >= 0), [...tests, h.log.indexOf(h.applies()[0])].sort((a, b) => a - b));
      assert.deepEqual(bodies.map((b, i) => (b.includes('pw-2') ? i : -1)).filter((i) => i >= 0), [h.log.indexOf(h.applies()[1])]);
      await net.done(h, { n: 2 });
      assert.equal(h.title(), 'Where should Worca get its models?');
    } finally { h.close(); }
  };
  await checkRows([
    { name: 'retry at proxy-swap', run: () => run('proxy-swap') },
    { name: 'retry at proxy-login', run: () => run('proxy-login') },
    { name: 'the final Apply: keys scrubbed after the 202; Retry at copilot-signin posts at once without them', run: async () => {
      const h = await open({ entry: 'rerun', step: 'access', routes: { '/api/setup/apply': (_o, n) => reply({ id: `stp_${n}`, steps: STEPS3 }, 202) } });
      try {
        await h.toggle('.sa-src-openai');
        await h.type('access.openai.baseUrl', 'https://llm.acme.example/v1');
        await h.type('access.openai.apiKey', 'sk-secret');
        await h.goTo('review');
        await h.click('.sa-next');
        assert.equal(h.applies()[0].body.access.openai.apiKey, 'sk-secret');
        h.handle.onFrame({ type: 'setup-apply', id: 'stp_1', done: true, ok: false, retry: 'copilot-signin' });
        await h.click('.sa-retry');
        const again = h.applies()[1].body;
        assert.equal(again.fromStep, 'copilot-signin');
        assert.equal(again.network, undefined);
        assert.equal(again.access?.openai?.apiKey, undefined);
      } finally { h.close(); }
    } },
    { name: 'Skip after a failed network apply re-reads what is saved and moves on', run: async () => {
      const net = netServer({ proxy: PROXY_ON });
      const h = await open({ entry: 'fix', step: 'network', proxy: PROXY_ON, routes: net.routes });
      try {
        await h.type('network.networkProxy.port', '3128');
        await h.click('.sa-test');
        await h.click('.sa-next');
        await net.done(h, { ok: false, failAt: 'proxy-swap' });
        const reads = h.log.filter((r) => r.url === '/api/proxy/status').length;
        await h.click('.sa-skip');
        assert.equal(h.log.filter((r) => r.url === '/api/proxy/status').length, reads + 1);
        assert.equal(h.title(), 'Where should Worca get its models?');
        assert.equal(h.applies().length, 1);
      } finally { h.close(); }
    } },
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
  subs.rerun = [...subs.first]; subs.rerun[0] = 'Status of your local setup.'; subs.rerun[5] = 'Only the rows marked Changed will be written.';
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

test('Model access › Claude: Sign in again shows the terminal steps; Check again reads past the cache', async () => {
  let signedIn = true;
  const recheck = () => reply({ checks: [check('claude', signedIn ? 'ok' : 'no'), check('git', 'ok'), check('direct', 'ok')] });
  const h = await open({ entry: 'rerun', routes: { '/api/setup/detect?recheck=1': () => recheck() } });
  try {
    await h.goTo('access');
    assert.match(h.$('.sa-claude').textContent, /Claude Code is signed in/);
    await h.click('.sa-claude-relogin');
    assert.match(h.$('.sa-claude').textContent, /run claude, then \/logout and \/login/);
    await h.click('.sa-recheck');
    assert.ok(h.log.some((r) => r.url === '/api/setup/detect?recheck=1'));
    assert.match(h.$('.sa-claude').textContent, /Checked again just now\./);
    assert.equal(h.$('.sa-recheck'), null, 'the steps close once it is signed in');
    signedIn = false;
    await h.click('.sa-claude-relogin');
    await h.click('.sa-recheck');
    assert.match(h.$('.sa-claude').textContent, /Run claude, then \/login, in a terminal/, 'signed out now: the usual Check row');
  } finally { h.close(); }
});

test('Model access › Copilot: Use another account asks first, signs out, then runs the device sign-in here', async () => {
  const providers = { ...PROVIDERS, copilot: { connected: true, termsCurrent: true, accountType: 'individual', login: 'jdoe' } };
  const h = await open({ entry: 'rerun', providers, routes: { ...COPILOT_ROUTES([reply({ ok: true, login: 'acme-dev' })]), '/api/providers/copilot/logout': reply({ ok: true }) } });
  try {
    await h.goTo('access');
    assert.match(h.$('.sa-cp').textContent, /Connected as @jdoe/);
    await h.click('.sa-cp-switch');
    assert.match(h.$('.sa-cp').textContent, /Models bridged through Copilot stop working until you sign in again\./);
    assert.equal(h.log.some((r) => r.url === '/api/providers/copilot/logout'), false, 'nothing happens before the confirm');
    await h.click('.sa-cp-switch-go');
    assert.ok(h.log.some((r) => r.url === '/api/providers/copilot/logout' && r.method === 'POST'));
    assert.equal(h.$('.mv-cp-code').textContent, 'ABCD-1234', 'the device sign-in starts in the dialog');
    await h.flush();
    assert.match(h.$('.sa-cp').textContent, /Connected as @acme-dev/);
  } finally { h.close(); }
});

test('Model access › a saved API key: the field says how to replace it', async () => {
  const providers = { ...PROVIDERS, openai: { configured: true, baseUrl: 'https://llm.example.com/v1', keyMasked: 'sk-…1234' } };
  const h = await open({ entry: 'rerun', providers });
  try {
    await h.goTo('access');
    if (!h.$('.sa-src-openai').checked) await h.toggle('.sa-src-openai');
    assert.match(h.$('.sa-key').closest('.field').textContent, /A key is saved\. Type a new one to replace it\./);
    assert.equal(h.$('.sa-key').placeholder, 'sk-…1234');
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
  assert.ok(css.includes('.setup-card .dlg-foot .confirm-actions{flex-wrap:wrap;}'));   // Share and Continue stack at 290px
  // The head and foot rules always show in the wizard, not only while content scrolls under them.
  assert.ok(css.includes('.setup-card.dlg > .dlg-head::after,.setup-card.dlg > .dlg-foot::before{opacity:1;}'));
  // Wizard foot: the first button (Back / Cancel / Close / Share) on the left, Skip and the primary on the right.
  assert.ok(css.includes('.setup-card .dlg-foot .confirm-actions > :first-child:not(:last-child){margin-right:auto;}'));
  assert.ok(css.includes('.badge.team{background:var(--blue-bg);color:var(--blue-ink-strong);}'));
  assert.ok(css.includes('.setup-card .sa-team-line{display:flex;align-items:center;gap:8px;flex-wrap:wrap;color:var(--ink-2);}'));
  assert.ok(css.includes('.setup-modal .card.setup-card{width:min(640px,100%);}'));
  assert.ok(css.includes('.setup-card .hint{color:var(--ink-2);}'));
  // An error line stays red: .setup-card .hint comes after .hint.err with the same specificity (webui-4).
  assert.ok(css.indexOf('.setup-card .hint.err{color:var(--red-ink);}') > css.indexOf('.setup-card .hint{color:var(--ink-2);}'));
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
  assert.ok(gs.includes('Set up later')); assert.ok(gs.includes('Setup assistant › **Run setup**'));
});

const bodyOf = (w) => (typeof w.body === 'string' ? JSON.parse(w.body) : w.body);
const TEAM_FILE = { file: { found: true, ok: true, path: '~/.worca-cc/team-setup.json', hash: 'aaaa', warnings: [], unmapped: [],
  values: { work: { pipelineCostLimitUsd: 8, uiLevel: 'advanced' } }, keys: ['work.pipelineCostLimitUsd', 'work.uiLevel'] }, homes: [] };

const TEAM_CHECK = { id: 'teamSetup', label: 'Team setup', state: 'ok', line: 'Found a team setup in ~/.worca-cc/team-setup.json.' };

test('AC-5.4: a first start pre-fills blanks from the team file and marks the rows Team', async () => {
  // Both team keys must be blank in what is saved, or D19 keeps the saved values (qa-2-2).
  const h = await open({ entry: 'first', team: TEAM_FILE, settings: { ...SETTINGS, uiLevel: null, pipelineCostLimitUsd: null },
    detect: { ...DETECT, checks: [...DETECT.checks, TEAM_CHECK] } });
  try {
    assert.equal(h.$('.sa-check tr[data-check="teamSetup"] .badge.team').textContent, 'Team');
    assert.equal(h.$('.sa-check tr[data-check="claude"] .badge.team'), null);          // only the teamSetup ok row
    await h.goTo('review');
    const work = h.$('.sa-review li[data-group="work"]');
    assert.equal(work.querySelector('.badge.team').textContent, 'Team');
    assert.match(work.textContent, /Advanced interface · per run \$8/);
  } finally { h.close(); }
});

test('AC-5.4: blank means "not in settings.json": defaulted keys of a fresh home take the team values (webui-1)', async () => {
  // A fresh home: GET /api/settings fills in defaults, so uiLevel and networkWait are not null, but savedKeys is empty.
  const team = { ...TEAM_FILE, savedKeys: [], file: { ...TEAM_FILE.file,
    values: { work: { pipelineCostLimitUsd: 8, uiLevel: 'advanced', networkWait: { enabled: true, maxWaitMin: 60 } } },
    keys: ['work.pipelineCostLimitUsd', 'work.uiLevel', 'work.networkWait'] } };
  const h = await open({ entry: 'first', team, settings: { ...SETTINGS, pipelineCostLimitUsd: null, networkWait: { enabled: true, maxWaitMin: 240 } },
    routes: { '/api/setup/apply': reply({ id: 'stp_1', steps: [] }, 202) } });
  try {
    await h.goTo('review');
    assert.match(h.$('.sa-review li[data-group="work"]').textContent, /Advanced interface · per run \$8/);
    await h.click('.sa-next');
    const work = bodyOf(h.applies()[0]).work;
    assert.equal(work.uiLevel, 'advanced');
    assert.equal(work.pipelineCostLimitUsd, 8);
    assert.deepEqual(work.networkWait, { enabled: true, maxWaitMin: 60 });
  } finally { h.close(); }
  // A key the person saved keeps its value even when the team names it.
  const kept = await open({ entry: 'first', team: { ...team, savedKeys: ['uiLevel'] }, settings: { ...SETTINGS, pipelineCostLimitUsd: null } });
  try {
    await kept.goTo('review');
    assert.match(kept.$('.sa-review li[data-group="work"]').textContent, /Simple interface · per run \$8/);
  } finally { kept.close(); }
});

test('AC-5.7: a partial team record merges over the saved one, so a matching record is no change (webui-3)', () => {
  const s = saved({ settings: { ...SETTINGS, sync: { beforeRun: true, remote: 'origin', refreshMinutes: 10, onDiverged: 'ask' } } });
  const team = { values: { work: { sync: { onDiverged: 'ask' } } }, keys: ['work.sync'], unmapped: [] };
  const same = initialAnswers({ saved: s, entry: 'team', team });
  assert.equal(buildApplyBody(s, same).work, undefined);
  assert.equal(nextGate('review', same, { saved: s, entry: 'team' }).finish, true);
  const diff = initialAnswers({ saved: s, entry: 'team', team: { ...team, values: { work: { sync: { onDiverged: 'rebase' } } } } });
  assert.deepEqual(buildApplyBody(s, diff).work, { sync: { beforeRun: true, remote: 'origin', refreshMinutes: 10, onDiverged: 'rebase' } });
});

test('the Check step: one table row per check, then one sub-row per engine under Engines', async () => {
  const engines = check('harnesses', 'warn', { label: 'Engines', line: '1 of 2 engines are ready.', facts: { engines: [
    { name: 'claude', label: 'Claude', ready: true, line: 'Ready.' },
    { name: 'goose', label: 'Goose', ready: false, line: 'Install the Goose CLI.' }] } });
  const h = await open({ entry: 'first', detect: { checks: [check('claude', 'ok'), engines, check('git', 'ok')] } });
  try {
    const rows = h.$$('.sa-check tbody tr');
    assert.deepEqual(rows.map((r) => r.dataset.check || `engine:${r.dataset.engine}`), ['claude', 'harnesses', 'engine:claude', 'engine:goose', 'git']);
    const goose = h.$('.sa-check tr.sa-check-sub[data-engine="goose"]');
    assert.equal(goose.querySelector('.sa-check-mark .badge.grey').textContent, 'No');
    assert.equal(goose.querySelector('.sa-check-name').textContent, 'Goose');
    assert.equal(goose.querySelector('.sa-check-line').textContent, 'Install the Goose CLI.');
    assert.equal(h.$('.sa-check tr[data-check="harnesses"] .sa-check-line').textContent, '1 of 2 engines are ready.');
  } finally { h.close(); }
});

test('the Check step: the Team setup row shows only with something to report', async () => {
  const none = { id: 'teamSetup', label: 'Team setup', state: 'no', line: 'No team setup file was found.' };
  let h = await open({ entry: 'rerun', detect: { checks: [...DETECT.checks, none] } });
  try { assert.equal(h.$('.sa-check tr[data-check="teamSetup"]'), null, 'no file and no policy home: no row'); } finally { h.close(); }
  const homes = [{ home: 'acme/gateway', hash: 'bbbb', unmapped: [], values: { work: { totalCostLimitUsd: 40 } }, keys: ['work.totalCostLimitUsd'] }];
  h = await open({ entry: 'rerun', team: { file: { found: false }, homes }, detect: { checks: [...DETECT.checks, none] } });
  try {
    const tr = h.$('.sa-check tr[data-check="teamSetup"]');
    assert.equal(tr.querySelector('.sa-check-mark .badge.green').textContent, 'OK');
    assert.equal(tr.querySelector('.sa-check-line').textContent, 'Your team policy recommends a setup (acme/gateway).');
    assert.equal(tr.querySelector('.badge.team').textContent, 'Team');
  } finally { h.close(); }
  h = await open({ entry: 'rerun', detect: { checks: [...DETECT.checks, TEAM_CHECK] } });
  try { assert.match(h.$('.sa-check tr[data-check="teamSetup"]').textContent, /Found a team setup/); } finally { h.close(); }
});

test('the Check step: a refused team file gets the amber Check badge and no Team chip', async () => {
  const warn = { ...TEAM_CHECK, state: 'warn', line: 'The team setup in ~/.worca-cc/team-setup.json was not used: A team setup never carries network settings: “networkProxy”. Remove it and try again.' };
  const h = await open({ entry: 'first', detect: { ...DETECT, checks: [...DETECT.checks, warn] } });
  try {
    const li = h.$('.sa-check tr[data-check="teamSetup"]');
    assert.equal(li.querySelector('.badge.amber').textContent, 'Check');
    assert.equal(li.querySelector('.badge.team'), null);
    assert.match(li.textContent, /“networkProxy”/);
  } finally { h.close(); }
});

test('AC-5.4: saved values win on a first start: the team fills only what is blank', async () => {
  const h = await open({ entry: 'first', team: TEAM_FILE, settings: { ...SETTINGS, pipelineCostLimitUsd: 3 } });
  try {
    await h.goTo('review');
    assert.match(h.$('.sa-review li[data-group="work"]').textContent, /per run \$3/);
  } finally { h.close(); }
});

test('AC-5.7: entry team opens on Review, lists only changed rows and writes nothing before Apply', async () => {
  const team = { file: { found: false }, homes: [{ home: 'acme/gateway', hash: 'bbbb', unmapped: [], values: { work: { totalCostLimitUsd: 40 } }, keys: ['work.totalCostLimitUsd'] }] };
  const h = await open({ entry: 'team', step: 'review', teamHome: 'acme/gateway', team, routes: { '/api/setup/apply': reply({ id: 'stp_1', steps: [] }, 202) } });
  try {
    const rows = h.$$('.sa-review li');
    assert.deepEqual(rows.map((r) => r.dataset.group), ['work']);
    assert.equal(rows[0].querySelector('.badge.amber').textContent, 'Changed');
    assert.equal(rows[0].querySelector('.badge.team').textContent, 'Team');
    assert.equal(h.next().textContent, 'Apply changes');
    assert.deepEqual(h.writes(), []);                 // no POST /api/settings, no POST /api/setup/apply
    await h.click('.sa-next');
    assert.deepEqual(h.writes().map((w) => w.url), ['/api/setup/apply']);
    assert.deepEqual(bodyOf(h.writes()[0]).work, { totalCostLimitUsd: 40 });
    assert.equal(bodyOf(h.writes()[0]).network, undefined);
  } finally { h.close(); }
});

test('AC-5.7: entry team with nothing differing says it already matches and offers an enabled Finish', async () => {
  const team = { file: { found: false }, homes: [{ home: 'acme/gateway', hash: 'cccc', unmapped: [], values: { work: { pipelineCostLimitUsd: 5 } }, keys: ['work.pipelineCostLimitUsd'] }] };
  const h = await open({ entry: 'team', step: 'review', teamHome: 'acme/gateway', team });
  try {
    assert.equal(h.$$('.sa-review li').length, 0);
    assert.equal(h.$('.sa-review-empty').textContent, "Your setup already matches your team's recommendation.");
    assert.equal(h.next().textContent, 'Finish'); assert.equal(h.next().disabled, false);
    await h.click('.sa-next');
    assert.deepEqual(h.closes, ['done']);
    assert.deepEqual(h.writes(), []);
  } finally { h.close(); }
});

test('nextGate: team entry finishes when nothing differs; rerun still says Nothing changed', () => {
  const s = saved();
  const a = initialAnswers({ saved: s, entry: 'team' });
  assert.deepEqual(nextGate('review', a, { saved: s, entry: 'team' }), { ok: true, finish: true, reason: "Your setup already matches your team's recommendation." });
  assert.deepEqual(nextGate('review', a, { saved: s, entry: 'rerun' }), { ok: false, reason: 'Nothing changed.' });
});

test('an unmapped team role says none of your sources offer it on Models and on Review', async () => {
  const team = { ...TEAM_FILE, file: { ...TEAM_FILE.file, unmapped: [{ harness: 'claude', role: 'deep', upstream: 'claude-opus-5-5', line: 'None of your sources offer it.' }] } };
  // With the person's own Deep thinking model, the line says it is kept.
  const mine = await open({ entry: 'first', team, settings: { ...SETTINGS, modelRoles: { claude: { deep: { model: 'claude-sonnet-5-5' } } } } });
  try {
    for (const step of ['models', 'review']) {
      await mine.goTo(step);
      const li = mine.$('.sa-team-unmapped li');
      assert.equal(li.querySelector('.sa-row-main > div').textContent, 'Deep thinking · claude-opus-5-5', step);
      assert.equal(li.querySelector('.sa-row-line').textContent, 'None of your sources offer it. Your pick is kept.', step);
    }
  } finally { mine.close(); }
  // Without one, nothing is "kept" (ux-2-1).
  const none = await open({ entry: 'first', team });
  try {
    await none.goTo('models');
    assert.equal(none.$('.sa-team-unmapped li .sa-row-line').textContent, 'None of your sources offer it.');
  } finally { none.close(); }
});

test('entry team with a vanished home says so and offers an enabled Finish', async () => {
  const h = await open({ entry: 'team', step: 'review', teamHome: 'acme/gone', team: TEAM_NONE });
  try {
    assert.equal(h.$('.sa-review-empty').textContent, "Your team's setup is no longer available.");
    assert.equal(h.next().textContent, 'Finish'); assert.equal(h.next().disabled, false);
    await h.click('.sa-next');
    assert.deepEqual(h.closes, ['done']); assert.deepEqual(h.writes(), []);
  } finally { h.close(); }
});

test('teamNotice: once per hash, "has" for a new home and "updated" for a changed one', () => {
  const homes = [{ home: 'acme/gateway', hash: 'h2', keys: ['work.uiLevel'] }];
  assert.equal(teamNotice(homes, {}).label, 'Your team has a recommended setup');
  assert.equal(teamNotice(homes, { 'acme/gateway': 'h1' }).label, 'Your team updated the recommended setup');
  assert.equal(teamNotice(homes, { 'acme/gateway': 'h2' }), null);
  assert.equal(teamNotice([{ home: 'x', hash: 'h', keys: [] }], {}), null);
  // the ?homes=1 shape (policy keys) is enough
  assert.equal(teamNotice([{ home: 'acme/gateway', hash: 'h3', keys: ['setup.uiLevel'] }], { 'acme/gateway': 'h2' }).hash, 'h3');
});

test('AC-5.6: Share as team setup downloads the draft as team-setup.json; it is disabled while fetching', async () => {
  const held = deferred();
  const h = await open({ entry: 'rerun', routes: {
    '/api/setup/apply': reply({ id: 'stp_1', steps: STEPS3 }, 202),
    '/api/setup/team/draft': () => held.promise,
  } });
  try {
    await applyLimit(h);
    h.handle.onFrame({ type: 'setup-apply', id: 'stp_1', done: true, ok: true });
    const kids = [...h.$('.confirm-actions').children].map((b) => b.textContent);
    assert.deepEqual(kids, ['Share as team setup', 'Continue']);
    const clicks = []; h.window.HTMLAnchorElement.prototype.click = function () { clicks.push(this.download); };
    const revoked = [];
    h.window.URL.createObjectURL = () => 'blob:x'; h.window.URL.revokeObjectURL = (u) => { revoked.push(u); };
    await h.click('.sa-share');
    assert.equal(h.status().textContent, 'Preparing the team setup…');
    assert.equal(h.$('.sa-share').disabled, true);           // a double click cannot download twice
    held.resolve(reply({ doc: { schema: 1, fields: {} }, text: '{"schema":1}\n', warnings: [] }));
    await settle();
    assert.deepEqual(clicks, ['team-setup.json']);
    assert.equal(h.status().textContent, 'Saved team-setup.json. It has no network settings, model sources or keys.');
    assert.equal(h.$('.sa-share').disabled, false);
    assert.equal(h.window.document.activeElement, h.$('.sa-share'));      // focus survives the foot repaint (ux-2-2)
    assert.equal(h.status().getAttribute('role'), 'status');
    assert.equal(h.log.filter((r) => r.url === '/api/setup/team/draft').length, 1);
    assert.deepEqual(revoked, []);            // not at once: Firefox can cancel a download whose URL is revoked at once
    await new Promise((r) => setTimeout(r, 1100));
    assert.deepEqual(revoked, ['blob:x']);
  } finally { h.close(); }
});

test('Share: a failed draft shows the server error in the err class', async () => {
  const h = await open({ entry: 'rerun', routes: {
    '/api/setup/apply': reply({ id: 'stp_1', steps: STEPS3 }, 202),
    '/api/setup/team/draft': reply({ error: 'Worca could not prepare the team setup. Try again.' }, 500),
  } });
  try {
    await applyLimit(h);
    h.handle.onFrame({ type: 'setup-apply', id: 'stp_1', done: true, ok: true });
    await h.click('.sa-share');
    assert.equal(h.status().textContent, 'Worca could not prepare the team setup. Try again.');
    assert.ok(h.status().classList.contains('err'));
  } finally { h.close(); }
});
