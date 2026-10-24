// test/ui-settings-network-proxy.test.mjs — the Settings › Network proxy card
// (ui/public/settings-network-proxy.mjs) mounted on the real index.html markup, with a recording fetchJson.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { applyFlags } from '../ui/public/flags.mjs';
import { mountNetworkProxyCard } from '../ui/public/settings-network-proxy.mjs';
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
function mount(answers = {}, { flag = false } = {}) {
  const dom = new JSDOM(HTML);
  const doc = dom.window.document;
  if (flag) applyFlags({ corporateProxy: true }, doc);
  const calls = [];
  const fetchJson = async (url, { method = 'GET', body } = {}) => {
    calls.push({ method, url, body });
    return answers[`${method} ${url}`] || { ok: true, status: 200, data: STATUS };
  };
  const off = mountNetworkProxyCard({ doc, fetchJson });
  const $ = (id) => doc.getElementById(id);
  const close = () => { off(); applyFlags({ corporateProxy: false }, doc); dom.window.close(); };
  return { dom, doc, calls, $, close };
}

test('flag off: no body and no request; the section carries the flag and level gates', (t) => {
  const p = mount();
  t.after(p.close);
  const card = p.$('network-proxy-settings-card');
  assert.equal(card.dataset.flag, 'corporateProxy');
  assert.equal(card.dataset.minLevel, 'advanced');
  assert.equal(p.$('networkProxyBody').children.length, 0);
  assert.deepEqual(p.calls, []);
});

test('flag on: the fields, a status fetch, and the status line is the payload line as is', async (t) => {
  const p = mount();
  t.after(p.close);
  applyFlags({ corporateProxy: true }, p.doc);
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
  applyFlags({ corporateProxy: false }, p.doc);
  assert.equal(p.$('networkProxyBody').children.length, 0, 'off again: the body is emptied');
});

test('Test posts once and lists one row per host', async (t) => {
  const p = mount({ 'POST /api/proxy/test': { ok: true, status: 200, data: TEST_OK } }, { flag: true });
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

test('a 409 RESTART_NEEDED shows the server sentence and no rows', async (t) => {
  const error = 'the saved proxy 127.0.0.1:9 is not in use yet: restart Worca, then Test';
  const p = mount({ 'POST /api/proxy/test': { ok: false, status: 409, data: { code: 'RESTART_NEEDED', error } } }, { flag: true });
  t.after(p.close);
  await tick();
  p.$('npTest').click();
  await tick(); await tick();
  assert.equal(p.$('npStatus').textContent, error);
  assert.equal(p.$('npTestResults').children.length, 0);
});

test('Log in posts domain, user and password, then clears the password', async (t) => {
  const p = mount({}, { flag: true });
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
  const p = mount({}, { flag: true });
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
  const p = mount({}, { flag: true });
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

test('a payload with restartNeeded shows its line, which says to restart', async (t) => {
  const line = 'no login saved: via p:8080 (no login). Log in with your domain, user name and password. Restart Worca to start the proxy.';
  const p = mount({ 'GET /api/proxy/status': { ok: true, status: 200, data: { ...STATUS, state: 'no-login', login: null, restartNeeded: true, line } } }, { flag: true });
  t.after(p.close);
  await tick();
  assert.match(p.$('npStatus').textContent, /Restart Worca/);
  assert.equal(p.$('npStatus').dataset.state, 'no-login');
});

test('app.js mounts the card', () => {
  const app = readFileSync(new URL('../ui/public/app.js', import.meta.url), 'utf8');
  assert.ok(app.includes('mountNetworkProxyCard('));
});

test('Local proxy port: filled from settings, Save sends fixedPort, an empty field sends null', async (t) => {
  const p = mount({ 'GET /api/proxy/status': { ok: true, status: 200, data: { ...STATUS, settings: { ...STATUS.settings, fixedPort: 3128 } } } }, { flag: true });
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
  const p = mount({}, { flag: true });
  t.after(p.close);
  await tick();
  p.$('npAuth').value = 'digest';
  p.$('npAuth').dispatchEvent(new p.dom.window.Event('change'));
  assert.equal(p.$('npAuth').value, 'digest', 'Digest is an option');
  assert.equal(p.$('npLogin').disabled, true);
  assert.equal(p.$('npBasicNote').hidden, false);
  assert.match(p.$('npBasicNote').textContent, /Digest cannot use a saved login/);
});
