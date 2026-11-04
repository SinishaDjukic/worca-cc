// test/ask-api-proxy-cards.test.mjs
// The corporate proxy card over the cards route (ui/server.mjs, WORCA_MOCK): Apply of a settings card and of the
// enable card saves through the PUT /api/proxy/settings path (proxyHost.saveSettings and its UNTESTED gate: an
// untested upstream is tested first); an agent under isolation cannot apply; the event turn says what happened.
// HOME is pinned to a temp dir: settings.json (networkProxy) lives under HOME, never WORCA_HOME.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { startFakeUpstream } from './helpers/fake-upstream-proxy.mjs';

import { useTempHome } from './helpers/temp-home.mjs';
import { _resetForTests as closeDbForTests } from '../src/core/db.mjs';

useTempHome(after);

const PROXY_ENV = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'NO_PROXY', 'no_proxy', 'WORCA_EGRESS_PROXY_URL'];
let homeDir; let osHome; let mod; let store; let srv; let base; let testing; let networkProxySettings; let networkProxyEnabled; let setNetworkProxy;
const prevEnv = {};
const JSONH = { 'Content-Type': 'application/json' };
const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(body) });
const get = async (p) => (await fetch(`${base}${p}`)).json();
const snapshot = async (id) => get(`/api/ask/threads/${id}`);
async function waitFor(pred, ms = 10000) {
  const t0 = Date.now();
  for (;;) {
    const v = await pred();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}
async function withAgent(fn) {
  process.env.WORCA_AGENT_USER = 'worca-agent';
  process.env.WORCA_AGENT_HOME = join(osHome, 'agent');
  try { return await fn(); } finally { delete process.env.WORCA_AGENT_USER; delete process.env.WORCA_AGENT_HOME; }
}

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-askproxy-'));
  osHome = await mkdtemp(join(tmpdir(), 'worca-cc-askproxy-os-'));   // settings.json lives under the OS home
  for (const k of ['WORCA_HOME', 'HOME', 'USERPROFILE', 'WORCA_MOCK', 'WORCA_AGENT_USER', 'WORCA_AGENT_HOME', ...PROXY_ENV]) prevEnv[k] = process.env[k];
  for (const k of PROXY_ENV) delete process.env[k];
  delete process.env.WORCA_AGENT_USER; delete process.env.WORCA_AGENT_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.HOME = osHome; process.env.USERPROFILE = osHome;
  process.env.WORCA_MOCK = '1';
  mod = await import('../ui/server.mjs');
  testing = mod._testing;
  store = await import('../src/core/ask/store.mjs');
  ({ networkProxySettings, networkProxyEnabled, setNetworkProxy } = await import('../src/core/settings.mjs'));
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  testing?.setEgress(null);
  for (const [, job] of mod._testing.askJobs) { try { job.turn?.stop?.(); } catch { /* reap */ } }
  if (srv) {
    await Promise.race([
      new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }),
      new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); }),
    ]);
  }
  for (const [k, v] of Object.entries(prevEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  closeDbForTests();
  for (const d of [homeDir, osHome]) await rm(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
});

/** A thread with one assistant message holding a proposed proxy card. */
async function seedCard(card) {
  const thread = (await (await post('/api/ask/threads', {})).json()).thread;
  await post(`/api/ask/threads/${thread.id}/messages`, { text: 'hello', model: 'claude-opus-5-5', effort: 'high' });
  await waitFor(async () => (await snapshot(thread.id)).messages.some((m) => m.role === 'assistant' && m.status === 'done'));
  const cardId = `card_${Math.random().toString(16).slice(2, 10).padEnd(8, '0')}`;
  store.appendMessage(thread.id, { role: 'assistant', text: '', status: 'done', blocks: [{ kind: 'card', id: cardId, state: 'proposed', card }] });
  return { threadId: thread.id, cardId };
}
const SETTINGS_CARD = { type: 'proxy', kind: 'settings', patch: { upstream: 'proxy2.acme.test:3128' },
  changes: [{ field: 'upstream', label: 'Proxy', before: 'none (…)', after: 'proxy2.acme.test:3128' }], summary: 'Proxy: proxy2.acme.test:3128', upstreamChanged: true, restartNote: 'New connections use it now.', note: '' };
const ENABLE_CARD = { type: 'proxy', kind: 'enable', patch: { enabled: true }, changes: [{ field: 'enabled', label: 'Network proxy', before: 'Off', after: 'On' }],
  summary: 'Network proxy: On', restartNote: 'New connections use it now.', note: '' };
const eventRow = async (threadId) => (await snapshot(threadId)).messages.find((m) => m.role === 'user' && /^\[worca event\] proxy card /.test(m.text || ''));
function echoOrigin() {
  return new Promise((resolve) => {
    const s = net.createServer((c) => { c.on('error', () => {}); c.on('data', (d) => c.write(`echo:${d}`)); });
    s.listen(0, '127.0.0.1', () => resolve({ server: s, port: s.address().port }));
  });
}
async function closedPort() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

test('proxy card: Apply with the proxy off saves with no test, an agent cannot apply, the event turn says so', async () => {
  await setNetworkProxy(null);
  const { threadId, cardId } = await seedCard(SETTINGS_CARD);
  await withAgent(async () => {
    const r = await post(`/api/ask/threads/${threadId}/cards/${cardId}`, { state: 'applied' });
    assert.deepEqual([r.status, (await r.json()).code], [403, 'AGENT_CALLER_BLOCKED']);   // G1: the global gate answers first
  });
  const res = await post(`/api/ask/threads/${threadId}/cards/${cardId}`, { state: 'applied' });
  assert.equal(res.status, 200, await res.clone().text());
  const r = { body: await res.json() };
  assert.equal(r.body.block.state, 'applied');
  assert.equal(r.body.block.card.result.detail, 'Saved. New connections use it now.');
  assert.equal(networkProxySettings().upstream, 'http://proxy2.acme.test:3128');
  assert.ok(r.body.turn && (r.body.turn.assistantMessageId || r.body.turn.deferred), 'an event turn was started or queued');
  const ev = await waitFor(() => eventRow(threadId));
  assert.match(ev.text, /^\[worca event\] proxy card \S+ applied; "Proxy: proxy2\.acme\.test:3128"; Saved\. New connections use it now\./);
});

test('proxy card: Keep as is declines and posts the event; nothing is written', async () => {
  const before = networkProxySettings();
  const { threadId, cardId } = await seedCard({ ...SETTINGS_CARD, patch: { upstream: 'proxy3.acme.test:3128' }, summary: 'Proxy: proxy3.acme.test:3128' });
  const r = await post(`/api/ask/threads/${threadId}/cards/${cardId}`, { state: 'declined' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).block.state, 'declined');
  assert.deepEqual(networkProxySettings(), before);
  const ev = await waitFor(() => eventRow(threadId));
  assert.equal(ev.text, '[worca event] proxy card ' + cardId + ' declined; "Proxy: proxy3.acme.test:3128"');
});

test('proxy on: an untested upstream is tested first; a failing test fails the card and saves nothing; a passing one saves', async () => {
  const origin = await echoOrigin();
  const fake = await startFakeUpstream({ scheme: 'none', originPort: origin.port });
  try {
    await setNetworkProxy({ enabled: true, upstream: 'proxy.acme.test:8080' });
    const dead = await closedPort();
    const bad = await seedCard({ ...SETTINGS_CARD, patch: { upstream: `127.0.0.1:${dead}` } });
    const br = await (await post(`/api/ask/threads/${bad.threadId}/cards/${bad.cardId}`, { state: 'applied' })).json();
    assert.equal(br.block.state, 'failed', JSON.stringify(br.block));
    assert.match(br.block.error, /the proxy test did not pass/);
    assert.equal(networkProxySettings().upstream, 'http://proxy.acme.test:8080', 'nothing was saved');

    const good = await seedCard({ ...SETTINGS_CARD, patch: { upstream: `127.0.0.1:${fake.port}` } });
    const gr = await (await post(`/api/ask/threads/${good.threadId}/cards/${good.cardId}`, { state: 'applied' })).json();
    assert.equal(gr.block.state, 'applied', JSON.stringify(gr.block));
    assert.ok(fake.stats.sockets >= 1, 'the test went through the new host');
    assert.equal(gr.block.card.result.detail, 'Saved. New connections use it now.');
    assert.equal(networkProxySettings().upstream, `http://127.0.0.1:${fake.port}`);
  } finally { await setNetworkProxy(null); await fake.close(); origin.server.close(); }
});

test('enable card: turns networkProxy.enabled on through the same save path; a pre-upgrade flag card still applies', async () => {
  await setNetworkProxy(null);
  assert.equal(networkProxyEnabled(), false);
  const f = await seedCard(ENABLE_CARD);
  await withAgent(async () => assert.equal((await post(`/api/ask/threads/${f.threadId}/cards/${f.cardId}`, { state: 'applied' })).status, 403));
  const fr = await (await post(`/api/ask/threads/${f.threadId}/cards/${f.cardId}`, { state: 'applied' })).json();
  assert.equal(fr.block.state, 'applied', JSON.stringify(fr));
  assert.equal(fr.block.card.result.detail, 'Saved. New connections use it now.');
  assert.equal(networkProxyEnabled(), true);
  await setNetworkProxy(null);
  const old = await seedCard({ type: 'proxy', kind: 'flag', set: { corporateProxy: true }, changes: [], summary: 'Corporate proxy (Labs): On', note: '' });
  const or = await (await post(`/api/ask/threads/${old.threadId}/cards/${old.cardId}`, { state: 'applied' })).json();
  assert.equal(or.block.state, 'applied', JSON.stringify(or));
  assert.equal(networkProxyEnabled(), true);
  await setNetworkProxy(null);
});
