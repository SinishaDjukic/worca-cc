// test/ui-settings-network-proxy.test.mjs — the Settings › Network proxy card
// (ui/public/settings-network-proxy.mjs) mounted on the real index.html markup, with a recording fetchJson.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { mountNetworkProxyCard, AUTH_OPTIONS, SAVED_TEXT, NOT_SAVED_TEXT, TESTING_TEXT } from '../ui/public/settings-network-proxy.mjs';
import { BUTTON_DONE_MS } from '../ui/public/feedback.mjs';

const HTML = readFileSync(new URL('../ui/public/index.html', import.meta.url), 'utf8');
const READY_LINE = 'ready: via proxy.acme.example:8080 (NTLMv2) as ACME\\jdoe.';
const STATUS = {
  state: 'ready', text: 'ready', line: READY_LINE, upstream: 'proxy.acme.example:8080', running: true, restartNeeded: false,
  login: { id: 'a1', domain: 'ACME', user: 'jdoe', label: 'ACME\\jdoe', savedAt: '2026-10-23T10:00:00.000Z', rejected: null },
  settings: { upstream: 'http://proxy.acme.example:8080', auth: 'auto', timeouts: { connectMs: 30000 } },
};
const TEST_OK = { ok: false, upstream: 'proxy.acme.example:8080', results: [
  { host: 'github.com', ok: true, via: 'upstream', ms: 120 },
  { host: 'api.anthropic.com', ok: false, via: 'upstream', ms: 80, error: 'the corporate proxy answered 403 for api.anthropic.com:443' },
] };

const tick = () => new Promise((r) => setImmediate(r));

/** A fresh page and card; `answers` maps "METHOD url" to { ok, status, data }. */
function mount(answers = {}, { onOpenSetup } = {}) {
  const dom = new JSDOM(HTML);
  const doc = dom.window.document;
  const calls = [];
  // An answer may be a function (called, and awaited, per request).
  const fetchJson = async (url, { method = 'GET', body } = {}) => {
    calls.push({ method, url, body });
    const a = answers[`${method} ${url}`];
    return (typeof a === 'function' ? await a() : a) || { ok: true, status: 200, data: STATUS };
  };
  const off = mountNetworkProxyCard({ doc, fetchJson, ...(onOpenSetup ? { onOpenSetup } : {}) });
  const $ = (id) => doc.getElementById(id);
  const close = () => { off(); dom.window.close(); };
  return { dom, doc, calls, $, close };
}

test('the fields, a status fetch, and the status line is the payload line as is (no flag needed)', async (t) => {
  const p = mount();
  t.after(p.close);
  await tick();
  assert.ok(p.$('npHost') && p.$('npTest'));
  assert.equal(p.$('npPassword').type, 'password');
  assert.ok(p.$('npAuth').parentElement.classList.contains('select-wrap'));
  assert.deepEqual(p.calls.map((c) => `${c.method} ${c.url}`), ['GET /api/proxy/status']);
  assert.equal(p.$('npStatus').textContent, READY_LINE);
  assert.equal(p.$('npHost').value, 'proxy.acme.example');
  assert.equal(p.$('npPort').value, '8080');
  assert.equal(p.$('npConnectS').value, '30');
  assert.equal(p.$('npUser').value, 'jdoe');
  assert.equal(p.$('npEnabled').checked, false, 'settings without enabled: the switch is off');
});

test('Test posts once and lists one row per host', async (t) => {
  const p = mount({ 'POST /api/proxy/test': { ok: true, status: 200, data: TEST_OK } });
  t.after(p.close);
  await tick();
  p.$('npTest').click();
  await tick(); await tick();
  assert.equal(p.calls.filter((c) => c.url === '/api/proxy/test' && c.method === 'POST').length, 1);
  const rows = p.$('npTestResults').querySelectorAll('li');
  assert.equal(rows.length, 2);
  assert.equal(p.doc.querySelector('[data-host="github.com"][data-ok="true"]').textContent, 'github.com: OK (120 ms)');
  assert.match(p.doc.querySelector('[data-host="api.anthropic.com"][data-ok="false"]').textContent, /FAIL/);
});

test('a 409 refusal shows the server sentence and no rows', async (t) => {
  const error = 'no corporate proxy is set up: enter its host and port, then Test';
  const p = mount({ 'POST /api/proxy/test': { ok: false, status: 409, data: { code: 'NOT_CONFIGURED', error } } });
  t.after(p.close);
  await tick();
  p.$('npTest').click();
  await tick(); await tick();
  assert.equal(p.$('npStatus').textContent, error);
  assert.equal(p.$('npTestResults').children.length, 0);
});

test('Log in posts domain, user and password, then clears the password', async (t) => {
  const p = mount({});
  t.after(p.close);
  await tick();
  p.$('npDomain').value = 'ACME';
  p.$('npUser').value = 'jdoe';
  p.$('npPassword').value = 'S3cret!';
  p.$('npLogin').click();
  await tick(); await tick();
  const post = p.calls.find((c) => c.url === '/api/proxy/login');
  assert.deepEqual(post.body, { domain: 'ACME', user: 'jdoe', password: 'S3cret!' });
  assert.equal(p.$('npPassword').value, '');
});

test('Basic disables Log in with a hint; auto enables it again', async (t) => {
  const p = mount({});
  t.after(p.close);
  await tick();
  const pick = (v) => { p.$('npAuth').value = v; p.$('npAuth').dispatchEvent(new p.dom.window.Event('change')); };
  pick('basic');
  assert.equal(p.$('npLogin').disabled, true);
  assert.equal(p.$('npBasicNote').hidden, false);
  assert.match(p.$('npBasicNote').textContent, /HTTPS_PROXY/);
  pick('auto');
  assert.equal(p.$('npLogin').disabled, false);
  assert.equal(p.$('npBasicNote').hidden, true);
});

test('Basic chosen while Log in shows "Logged in": it stays disabled once the button goes idle', async (t) => {
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.timers.reset());
  const p = mount({});
  t.after(p.close);
  await tick();
  p.$('npUser').value = 'jdoe';
  p.$('npPassword').value = 'S3cret!';
  p.$('npLogin').click();
  await tick(); await tick();
  p.$('npAuth').value = 'basic';
  p.$('npAuth').dispatchEvent(new p.dom.window.Event('change'));
  mock.timers.tick(BUTTON_DONE_MS + 10);
  assert.equal(p.$('npLogin').disabled, true);
});

test('the status line never says to restart, and an enabled setting turns the switch on', async (t) => {
  const line = 'no login saved: via p:8080 (no login). Log in with your domain, user name and password.';
  const p = mount({ 'GET /api/proxy/status': { ok: true, status: 200, data: { ...STATUS, state: 'no-login', login: null, line, settings: { ...STATUS.settings, enabled: true } } } });
  t.after(p.close);
  await tick();
  assert.doesNotMatch(p.$('npStatus').textContent, /Restart Worca/);
  assert.equal(p.$('npStatus').dataset.state, 'no-login');
  assert.equal(p.$('npEnabled').checked, true);
});

test('app.js mounts the card', () => {
  const app = readFileSync(new URL('../ui/public/app.js', import.meta.url), 'utf8');
  assert.ok(app.includes('mountNetworkProxyCard('));
});

test('Local proxy port: filled from settings, Save sends fixedPort, an empty field sends null', async (t) => {
  const p = mount({ 'GET /api/proxy/status': { ok: true, status: 200, data: { ...STATUS, settings: { ...STATUS.settings, fixedPort: 3128 } } } });
  t.after(p.close);
  await tick();
  assert.ok(p.$('npFixedPort'));
  assert.equal(p.$('npFixedPort').value, '3128');
  p.$('npSave').click();
  await tick(); await tick();
  assert.equal(p.calls.find((c) => c.method === 'PUT').body.networkProxy.fixedPort, 3128);
  p.calls.length = 0;
  await new Promise((r) => setTimeout(r, BUTTON_DONE_MS + 20));
  p.$('npFixedPort').value = '';
  p.$('npSave').click();
  await tick(); await tick();
  assert.equal(p.calls.find((c) => c.method === 'PUT').body.networkProxy.fixedPort, null);
});

test('Digest disables Log in with its own hint', async (t) => {
  const p = mount({});
  t.after(p.close);
  await tick();
  p.$('npAuth').value = 'digest';
  p.$('npAuth').dispatchEvent(new p.dom.window.Event('change'));
  assert.equal(p.$('npAuth').value, 'digest', 'Digest is an option');
  assert.equal(p.$('npLogin').disabled, true);
  assert.equal(p.$('npBasicNote').hidden, false);
  assert.match(p.$('npBasicNote').textContent, /Digest cannot use a saved login/);
});

test('AC-2.8: the card is Simple level, has no flag gate, and folds timeouts and the local port under More', async () => {
  const m = mount();
  await tick();
  const card = m.$('network-proxy-settings-card');
  assert.equal(card.dataset.minLevel, 'simple');
  assert.equal(card.hasAttribute('data-flag'), false);
  assert.ok(m.$('npEnabled'), 'the switch renders without any flag');
  const more = card.querySelector('details.np-more');
  assert.equal(more.open, false);
  assert.equal(more.querySelector('summary').textContent.trim(), 'More');
  for (const id of ['npFixedPort', 'npConnectS', 'npAuthS', 'npIdleS']) assert.ok(more.contains(m.$(id)), `${id} is under More`);
  for (const id of ['npHost', 'npPort', 'npAuth', 'npNoProxy']) assert.equal(more.contains(m.$(id)), false, `${id} stays visible`);
  assert.equal(m.$('npFixedPortNote').textContent, 'Takes effect at once. Programs already using the old port keep it until Worca restarts.');
  m.close();
});

test('Save: an UNTESTED refusal runs Test with the form values, then saves; a failed test saves nothing', async () => {
  let puts = 0;
  const m = mount({
    'PUT /api/proxy/settings': () => (++puts === 1 ? { ok: false, status: 409, data: { code: 'UNTESTED', error: 'Test these proxy settings first…' } }
      : { ok: true, status: 200, data: { networkProxy: {}, restartNeeded: false, pending: [], notes: {} } }),
    'POST /api/proxy/test': { ok: true, status: 200, data: { ok: true, upstream: 'proxy.acme.example:8080', results: [{ host: 'github.com', ok: true, via: 'upstream', ms: 12 }] } },
  });
  await tick();
  m.$('npEnabled').checked = true;
  m.$('npHost').value = 'proxy.acme.example'; m.$('npPort').value = '8080';
  m.$('npSave').click();
  for (let i = 0; i < 10; i++) await tick();
  const test = m.calls.find((c) => c.url === '/api/proxy/test');
  assert.deepEqual(test.body.networkProxy.upstream, 'http://proxy.acme.example:8080');
  assert.equal(test.body.networkProxy.enabled, true);
  assert.equal(m.calls.filter((c) => c.url === '/api/proxy/settings').length, 2);
  assert.equal(m.$('npStatus').textContent, 'Saved. New connections use it now.');
  assert.equal(m.$('npTestResults').children.length, 1);
  m.close();
});

test('Save: a failed test after UNTESTED saves nothing and says so', async () => {
  const m = mount({
    'PUT /api/proxy/settings': { ok: false, status: 409, data: { code: 'UNTESTED', error: 'Test these proxy settings first…' } },
    'POST /api/proxy/test': { ok: true, status: 200, data: { ok: false, upstream: 'proxy.acme.example:8080', results: [{ host: 'github.com', ok: false, error: 'connect ECONNREFUSED' }] } },
  });
  await tick();
  m.$('npEnabled').checked = true;
  m.$('npHost').value = 'proxy.acme.example'; m.$('npPort').value = '8080';
  m.$('npSave').click();
  for (let i = 0; i < 10; i++) await tick();
  assert.equal(m.calls.filter((c) => c.url === '/api/proxy/settings').length, 1, 'one PUT only');
  assert.equal(m.$('npStatus').textContent, NOT_SAVED_TEXT);
  assert.equal(m.$('npTestResults').children[0].dataset.ok, 'false');
  m.close();
});

test('Save: #npStatus reads Testing… while the test after UNTESTED is still running (ux-2-1)', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  let puts = 0;
  const m = mount({
    'PUT /api/proxy/settings': () => (++puts === 1 ? { ok: false, status: 409, data: { code: 'UNTESTED', error: 'Test these proxy settings first…' } }
      : { ok: true, status: 200, data: { networkProxy: {}, restartNeeded: false, pending: [], notes: {} } }),
    'POST /api/proxy/test': () => gate.then(() => ({ ok: true, status: 200, data: { ok: true, upstream: 'proxy.acme.example:8080', results: [] } })),
  });
  await tick();
  m.$('npEnabled').checked = true;
  m.$('npHost').value = 'proxy.acme.example'; m.$('npPort').value = '8080';
  m.$('npSave').click();
  for (let i = 0; i < 5; i++) await tick();
  assert.equal(m.$('npStatus').textContent, TESTING_TEXT, 'the deferred test has not answered yet');
  release();
  for (let i = 0; i < 10; i++) await tick();
  assert.equal(m.$('npStatus').textContent, SAVED_TEXT);
  m.close();
});

test('Save: an upstreamError answer shows the server sentence and flags the host field (ux-2-3)', async () => {
  const m = mount({ 'PUT /api/proxy/settings': { ok: true, status: 200, data: { networkProxy: {}, restartNeeded: false, pending: [], notes: {}, upstreamError: 'networkProxy.upstream: "http://:0" has no host' } } });
  await tick();
  m.$('npEnabled').checked = true;
  m.$('npSave').click();
  for (let i = 0; i < 5; i++) await tick();
  assert.match(m.$('npStatus').textContent, /has no host/);
  assert.equal(m.$('npHost').getAttribute('aria-invalid'), 'true');
  m.close();
});

test('Save: turning off says connections go direct', async () => {
  const m = mount({ 'PUT /api/proxy/settings': { ok: true, status: 200, data: { networkProxy: { enabled: false }, restartNeeded: false, pending: [], notes: {} } } });
  await tick();
  m.$('npEnabled').checked = false;
  m.$('npSave').click();
  for (let i = 0; i < 5; i++) await tick();
  assert.equal(m.$('npStatus').textContent, 'Saved. New connections go direct now.');
  m.close();
});

test('Test keeps the typed values: only the status line repaints (ux-1-1)', async () => {
  const m = mount({
    'GET /api/proxy/status': { ok: true, status: 200, data: { state: 'ready', line: 'ready: saved proxy', settings: { enabled: true, upstream: 'http://saved.acme.example:8080' } } },
    'POST /api/proxy/test': { ok: true, status: 200, data: { ok: true, upstream: 'typed.acme.example:3128', results: [{ host: 'github.com', ok: true, via: 'upstream', ms: 9 }] } },
  });
  await tick();
  m.$('npHost').value = 'typed.acme.example'; m.$('npPort').value = '3128';
  m.$('npTest').click();
  for (let i = 0; i < 10; i++) await tick();
  assert.equal(m.calls.find((c) => c.url === '/api/proxy/test').body.networkProxy.upstream, 'http://typed.acme.example:3128');
  assert.equal(m.$('npHost').value, 'typed.acme.example');
  assert.equal(m.$('npPort').value, '3128');
  m.close();
});

test('the switch is labelled and the More chevron is hidden from screen readers', async () => {
  const m = mount();
  await tick();
  assert.equal(m.$('npEnabled').closest('label').textContent.trim(), 'Use a corporate proxy');
  assert.equal(m.$('network-proxy-settings-card').querySelector('details.np-more .adv-chev').getAttribute('aria-hidden'), 'true');
  m.close();
});

test('Save: a port change says it applies at the next start', async () => {
  const m = mount({ 'PUT /api/proxy/settings': { ok: true, status: 200, data: { networkProxy: {}, restartNeeded: true, pending: ['fixedPort'], notes: { fixedPort: 'Applies at the next start' } } } });
  await tick();
  m.$('npEnabled').checked = true;
  m.$('npSave').click();
  for (let i = 0; i < 5; i++) await tick();
  assert.equal(m.$('npStatus').textContent, 'Saved. New connections use it now. The local proxy port applies at the next start.');
  m.close();
});

test('needs-login shows Fix in setup assistant, which opens the assistant on Network; ready, or no onOpenSetup, hides it (AC-4.5)', async (t) => {
  const NEEDS = { ...STATUS, state: 'needs-login', line: 'Log in again (worca proxy login)' };
  const opened = [];
  const p = mount({ 'GET /api/proxy/status': { ok: true, status: 200, data: NEEDS } }, { onOpenSetup: (step) => opened.push(step) });
  t.after(p.close);
  await tick();
  const fix = p.$('npSetup');
  assert.equal(fix.textContent, 'Fix in setup assistant');
  assert.equal(fix.hidden, false);
  assert.equal(p.$('npLogin').textContent, 'Log in', 'the card\'s own button keeps its label');
  fix.click();
  assert.deepEqual(opened, ['network']);
  const ready = mount({}, { onOpenSetup: () => {} });
  t.after(ready.close);
  await tick();
  assert.equal(ready.$('npSetup').hidden, true, 'ready');
  const bare = mount({ 'GET /api/proxy/status': { ok: true, status: 200, data: NEEDS } });
  t.after(bare.close);
  await tick();
  assert.equal(bare.$('npSetup').hidden, true, 'no onOpenSetup');
  assert.equal(AUTH_OPTIONS.length, 4);
});

test('Auto-detect fills host, port and a manual bypass list, and shows where they came from; nothing is saved', async (t) => {
  const found = { found: true, source: 'pac', host: 'proxy.example.com', port: 3128, noProxy: [], also: [], line: "From your system's PAC file (wpad.example.com)." };
  const p = mount({ 'GET /api/proxy/detect': { ok: true, status: 200, data: found } });
  t.after(p.close);
  await tick();
  const noProxyBefore = p.$('npNoProxy').value;
  p.$('npDetect').click();
  await tick(); await tick();
  assert.deepEqual([p.$('npHost').value, p.$('npPort').value], ['proxy.example.com', '3128']);
  assert.equal(p.$('npNoProxy').value, noProxyBefore, 'a PAC answer has no bypass list: the field stays');
  assert.equal(p.$('npStatus').textContent, "From your system's PAC file (wpad.example.com).");
  assert.equal(p.calls.some((c) => c.method === 'PUT'), false, 'detect only fills the form');
  assert.equal(p.$('npConnectS').placeholder, '60');
  assert.equal(p.$('npIdleS').placeholder, '300');
});
